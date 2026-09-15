import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * The search surface, end to end. **The first coverage this page has had.**
 *
 * ## What this file cannot prove, and why
 *
 * Three things, all environmental rather than oversights. They are recorded
 * here so nobody later reads a green run as proof of something it never
 * touched:
 *
 * 1. **The MusicBrainz panel never renders here.** Locally
 *    `MUSICBRAINZ_CONTACT` is a placeholder, `assertIdentifiable()` throws
 *    before any fetch, and `searchUpstream` catches and returns an empty list.
 *    The panel is therefore unreachable in an end-to-end run, and so is the
 *    primary effect of the slice this file accompanies.
 * 2. **Streaming timing is unobservable.** With no upstream latency there is
 *    nothing to not-wait-for, and `page.goto` resolves on `load`, which awaits
 *    the whole stream regardless.
 * 3. **The five-local-result condition is unreachable.** The fixture catalogue
 *    holds seven albums and the measured maximum for any query is **three**, so
 *    the defect — a fallback suppressed by a flood of loose local matches —
 *    cannot be reproduced without manufacturing catalogue records, which is
 *    excluded.
 *
 * The decision rule is proven instead in `src/app/search/fallback.ts`, whose
 * signature accepts no result count at all. **The panel and the streaming
 * behaviour are verifiable only by hand on staging**, where the contact value
 * is genuine and the catalogue is large enough to crowd a query.
 *
 * What this file does own is the observable contract: local results and the
 * local empty state are rendered, the signed-out branch explains the missing
 * fallback rather than showing a thin page, and nothing errors.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified. Only the user's own account is created, and it is deleted
 * afterwards.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. */
const A_HELD_ALBUM = 'In Rainbows';
const A_HELD_CREDIT = 'Radiohead';
/** Matches nothing in the catalogue, and nothing upstream either, locally. */
const MATCHES_NOTHING = 'zzzqqxnothingmatchesthis';

const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-se-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ese_${id}`.slice(0, 30),
  };
}

const createdEmails: string[] = [];

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || createdEmails.length === 0) return;

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.email && createdEmails.includes(user.email)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

async function signUp(page: Page) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  return user;
}

const search = (page: Page, q: string) => page.goto(`/search?q=${encodeURIComponent(q)}`);
const upstreamPanel = (page: Page) => page.getByRole('heading', { name: 'Not in longplayr yet' });
const signInHint = (page: Page) => page.getByText(/to search MusicBrainz/);

test('the empty search page invites a query', async ({ page }) => {
  const response = await page.goto('/search');

  expect(response?.status()).toBe(200);
  await expect(page.getByText('Search for a record.')).toBeVisible();
  await expect(upstreamPanel(page)).toHaveCount(0);
});

test('a signed-out visitor sees catalogue results and is told the fallback needs a session', async ({
  page,
}) => {
  // The `fallbackUnavailable` branch. It previously carried the same
  // local-result-count gate as the panel, so a visitor whose query matched
  // enough albums was told nothing at all. It is now unconditional for a
  // signed-out query, which is observable here even though the panel is not.
  const response = await search(page, A_HELD_ALBUM);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
  await expect(page.getByText(A_HELD_CREDIT).first()).toBeVisible();

  await expect(signInHint(page)).toBeVisible();
  await expect(upstreamPanel(page)).toHaveCount(0);
});

test('a signed-out visitor with no matches is told how to look further', async ({ page }) => {
  const response = await search(page, MATCHES_NOTHING);

  expect(response?.status()).toBe(200);
  await expect(page.getByText(/Nothing in the catalogue matches/)).toBeVisible();
  await expect(
    page.getByText(
      'Sign in to search MusicBrainz and add records that are not in the catalogue yet.',
    ),
  ).toBeVisible();
});

test('a signed-in search renders catalogue results and completes', async ({ page }) => {
  // The page must finish rather than hang once the upstream request is behind a
  // streaming boundary. Locally that request resolves to nothing immediately,
  // so this proves completion and the absence of an empty panel — not the
  // panel's contents, which are unreachable here.
  await signUp(page);

  const response = await search(page, A_HELD_ALBUM);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Albums' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(A_HELD_ALBUM) }).first()).toBeVisible();

  // No session prompt, because there is a session.
  await expect(signInHint(page)).toHaveCount(0);
  // No empty panel: the absence of the section is the answer when MusicBrainz
  // returns nothing eligible.
  await expect(upstreamPanel(page)).toHaveCount(0);
});

test('a signed-in search with no local matches states that immediately', async ({ page }) => {
  // The local empty state must not wait on MusicBrainz. Its timing cannot be
  // observed here (see the file docstring), but its independence from the
  // upstream result can: the message names the catalogue specifically, and it
  // renders alongside a fallback that found nothing.
  await signUp(page);

  const response = await search(page, MATCHES_NOTHING);

  expect(response?.status()).toBe(200);
  await expect(page.getByText(/Nothing in the catalogue matches/)).toBeVisible();
  // The signed-out prompt must not appear for a signed-in reader.
  await expect(
    page.getByText(
      'Sign in to search MusicBrainz and add records that are not in the catalogue yet.',
    ),
  ).toHaveCount(0);
  // Once upstream resolves to nothing, the advice arrives from the streamed
  // component rather than from the empty state.
  await expect(
    page.getByText('Try a different spelling, or search for the artist instead.'),
  ).toBeVisible();
});

test('searching mutates nothing', async ({ page }) => {
  // The whole surface is a read, and the streaming change must not alter that.
  const user = await signUp(page);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const before = await admin.from('albums').select('mbid', { count: 'exact', head: true });

  for (const q of [A_HELD_ALBUM, MATCHES_NOTHING, '   ', 'radiohead']) {
    await search(page, q);
  }

  const after = await admin.from('albums').select('mbid', { count: 'exact', head: true });
  expect(after.count).toBe(before.count);

  const additions = await admin
    .from('catalogue_additions')
    .select('id', { count: 'exact', head: true });
  expect(additions.count).toBe(0);

  expect(user.handle).toBeTruthy();
});

/**
 * Artist links on a search result (`product-spec.md` §6).
 *
 * **Search was the last surface printing a plain-text credit**, deliberately
 * deferred for one cycle while the grid work settled. This closes it, and the
 * assertion is the navigation rather than the markup.
 */
test('a credit on a search result reaches the artist page', async ({ page }) => {
  await search(page, A_HELD_ALBUM);

  const albums = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Albums' }),
  });
  await expect(albums).toBeVisible();

  // Scoped to the Albums section on purpose: the page has a separate Artists
  // section that has always rendered artist links, so an unscoped locator would
  // pass whether or not the credit became one.
  await albums.getByRole('link', { name: A_HELD_CREDIT, exact: true }).first().click();

  await expect(page).toHaveURL(/\/artists\//);
  await expect(page.getByRole('heading', { name: A_HELD_CREDIT }).first()).toBeVisible();
});

test('the album title and the credit on one row go to different places', async ({ page }) => {
  // The row used to be a single anchor wrapping both. If it were still one, the
  // credit link could not exist at all — an `<a>` inside an `<a>` is invalid.
  await search(page, A_HELD_ALBUM);

  const albums = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Albums' }),
  });

  await expect(
    albums.getByRole('link', { name: new RegExp(A_HELD_ALBUM) }).first(),
  ).toHaveAttribute('href', /\/albums\//);
  await expect(
    albums.getByRole('link', { name: A_HELD_CREDIT, exact: true }).first(),
  ).toHaveAttribute('href', /\/artists\//);
});
