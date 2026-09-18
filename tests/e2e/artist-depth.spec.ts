import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test } from '@playwright/test';
import { artistUrl } from './urls';

/**
 * On-demand artist depth — the trigger, in a browser.
 *
 * **This is the only layer that can prove the trigger.** The page is an async
 * server component whose enqueue happens in `after()`, and the eligibility rule
 * underneath it is already covered by `artist-depth.test.ts`. That the *page*
 * asks — once, at background priority, without waiting — is observable only
 * here.
 *
 * **What is deliberately not proved.** The expansion itself never runs to
 * completion: `MUSICBRAINZ_CONTACT` is a placeholder in this environment, so
 * `assertIdentifiable()` throws inside the drained job and no release group is
 * ever fetched. That is the same condition the search fallback runs under, and
 * it is why every assertion below is about **rows and rendering**, never about
 * job status — which would race against the drain and its retries.
 *
 * `discoverAndIngestArtist` is covered in `curated-recovery.test.ts` and is not
 * exercised here.
 *
 * Albums come from the local fixture catalogue and are never modified.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`, and holding a single release. */
const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';

const NAV = { timeout: 15_000 };

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Every discovery job recorded for one artist, whatever its status. */
async function discoveryJobs(admin: SupabaseClient, mbid: string) {
  const { data } = await admin
    .from('ingestion_jobs')
    .select('id, priority, status, attempts, run_after')
    .eq('kind', 'discover_curated_artist')
    .eq('target_mbid', mbid);
  return data ?? [];
}

async function clearDiscoveryJobs(admin: SupabaseClient) {
  await admin.from('ingestion_jobs').delete().eq('kind', 'discover_curated_artist');
}

/**
 * Makes an outstanding job claimable now.
 *
 * A first view drains its own job, which fails here because
 * `MUSICBRAINZ_CONTACT` is a placeholder, so `markFailed` parks it behind 30
 * seconds of real backoff. That backoff is correct behaviour and untestable
 * in-process without saying "later" out loud.
 */
async function makeClaimable(admin: SupabaseClient, mbid: string) {
  await admin
    .from('ingestion_jobs')
    .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
    .eq('kind', 'discover_curated_artist')
    .eq('target_mbid', mbid);
}

/**
 * The enqueue happens in `after()`, so it lands *after* the response the test
 * already has. Polled rather than slept on, and bounded.
 */
async function waitForJobs(admin: SupabaseClient, mbid: string, expected: number) {
  await expect
    .poll(async () => (await discoveryJobs(admin, mbid)).length, { timeout: 15_000 })
    .toBe(expected);
}

test.beforeEach(async () => {
  await clearDiscoveryJobs(adminClient());
});

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  await clearDiscoveryJobs(adminClient());
});

test('a first view queues exactly one expansion, and says it is doing so', async ({ page }) => {
  const admin = adminClient();

  await page.goto(await artistUrl(RADIOHEAD));

  // The discography is on the page before anything upstream has been asked
  // for — the whole point of enqueueing rather than awaiting.
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);
  await expect(page.getByRole('link', { name: /In Rainbows/ }).first()).toBeVisible();
  await expect(page.getByTestId('discography-pending')).toBeVisible();

  await waitForJobs(admin, RADIOHEAD, 1);

  // Background, not interactive: the claim orders `priority asc`, so this must
  // sit behind a reader's own add or tracklist fetch.
  const [job] = await discoveryJobs(admin, RADIOHEAD);
  expect(job.priority).toBeGreaterThan(10);
});

test('a terminally failed attempt still stops a second one', async ({ page }) => {
  /*
   * **This is the assertion that proves the rule rather than the index.**
   *
   * A view against a *pending* job would pass either way: the partial unique
   * index covers `pending` and `running`, so a page that had lost its
   * eligibility check entirely would still write only one row. `failed` is
   * outside that index, so a second enqueue would succeed — and the only thing
   * that can prevent it is the durable-attempt rule reading job history.
   *
   * **The half about the page saying nothing has inverted, and deliberately.**
   * This used to assert that a terminally failed artist rendered no line at
   * all — which is exactly the defect `product-spec.md` §6 now names a lie by
   * omission, since a truncated discography presented itself as complete. The
   * page now says so. **What has _not_ changed is the enqueue rule**: a page
   * view still must not restart the retry policy, and that is what the row
   * count below protects.
   */
  const admin = adminClient();
  const { error } = await admin.from('ingestion_jobs').insert({
    kind: 'discover_curated_artist',
    target_mbid: RADIOHEAD,
    status: 'failed',
  });
  if (error) throw error;

  await page.goto(await artistUrl(RADIOHEAD));
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);
  // Says the honest thing rather than nothing…
  await expect(page.getByTestId('discography-failed')).toBeVisible(NAV);
  await expect(page.getByTestId('discography-failed')).toContainText('It will be retried');
  // …and does not claim work is in progress.
  await expect(page.getByTestId('discography-pending')).toHaveCount(0);

  // Checked after a window rather than immediately, so an enqueue arriving
  // late through `after()` would still be caught.
  await page.waitForTimeout(2_000);
  expect(await discoveryJobs(admin, RADIOHEAD)).toHaveLength(1);
});

test('a repeat view while one is outstanding queues nothing further', async ({ page }) => {
  // The weaker of the two, and kept because it is the real user path: the
  // first view's row is still outstanding when the second arrives.
  const admin = adminClient();

  await page.goto(await artistUrl(RADIOHEAD));
  await waitForJobs(admin, RADIOHEAD, 1);

  await page.goto(`${await artistUrl(RADIOHEAD)}?sort=oldest`);
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);

  await page.waitForTimeout(2_000);
  expect(await discoveryJobs(admin, RADIOHEAD)).toHaveLength(1);
});

test('a settled artist shows no status line', async ({ page }) => {
  // Written straight to `succeeded` so the page sees a finished attempt without
  // the drain having to succeed — which it cannot here, by design.
  const admin = adminClient();
  const { error } = await admin.from('ingestion_jobs').insert({
    kind: 'discover_curated_artist',
    target_mbid: RADIOHEAD,
    status: 'succeeded',
  });
  if (error) throw error;

  await page.goto(await artistUrl(RADIOHEAD));

  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);
  await expect(page.getByTestId('discography-pending')).toHaveCount(0);

  // And nothing new was queued behind it.
  expect(await discoveryJobs(admin, RADIOHEAD)).toHaveLength(1);
});

test('a later view drains, so refreshing moves an outstanding expansion along', async ({
  page,
}) => {
  const admin = adminClient();

  // First view: the job is created and drained. The drain fails, because the
  // placeholder contact makes `assertIdentifiable()` throw inside the job, so
  // the row lands back on `pending` with one attempt spent.
  await page.goto(await artistUrl(RADIOHEAD));
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);
  await waitForJobs(admin, RADIOHEAD, 1);
  await expect
    .poll(async () => (await discoveryJobs(admin, RADIOHEAD))[0]?.attempts, { timeout: 15_000 })
    .toBe(1);

  await makeClaimable(admin, RADIOHEAD);

  // The property under test. Before this behaviour existed the block was gated
  // on the `start` state, so a reload did nothing whatever and `attempts`
  // stayed at 1 — refreshing could not help by construction.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible(NAV);

  await expect
    .poll(async () => (await discoveryJobs(admin, RADIOHEAD))[0]?.attempts, { timeout: 15_000 })
    .toBe(2);

  // Still one row: the enqueue on a later view is a no-op, not a duplicate.
  expect(await discoveryJobs(admin, RADIOHEAD)).toHaveLength(1);
});
