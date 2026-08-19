import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * The collection read path, end to end: a real user collects real albums and
 * they appear on their public profile with the right markers.
 *
 * Everything here is deliberately asserted through the rendered page rather
 * than the database, because the failures this surface is exposed to — an
 * album on the wrong profile, an ordering that quietly follows `listened_on` —
 * are invisible to a test that reads the rows back.
 *
 * **The profile renders Compact, which is artwork only.** Score, like and
 * relisten markers therefore cannot be asserted here: no product surface shows
 * them, because the density control was deliberately deferred. Their
 * correctness is covered where it currently lives — the mapping in
 * `src/services/collection/collection-list.test.ts`, and the rows themselves in
 * `tests/integration/collection-list.test.ts`. This file asserts what the
 * profile actually renders: which albums, in which order, to whom.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified. Only the users' own collection rows are written, and the
 * accounts are deleted afterwards.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. All are coverless, so tiles render the placeholder. */
const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002';
const UNKNOWN_PLEASURES = '0b0e4f1e-1111-4000-8000-000000000006';

/** Navigations that follow a server action, as in the sibling specs. */
const NAV = { timeout: 15_000 };
/** Server actions that revalidate the page before the assertion can settle. */
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-pc-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2epc_${id}`.slice(0, 30),
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
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  return user;
}

/** Plain add, from the album page. */
async function collect(page: Page, mbid: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);
}

/** Rating an uncollected album collects it — the implicit path. */
async function rate(page: Page, mbid: string, score: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByRole('button', { name: 'Rate', exact: true }).click();
  await page.getByLabel('Your score').fill(score);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText(score, ACTION);
}

/** The tile for one album, located by the placeholder cover's accessible name. */
function tileFor(page: Page, title: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('img', { name: new RegExp(title, 'i') }) });
}

test('a collection appears on the profile, newest addition first', async ({ page }) => {
  const user = await signUp(page);

  // The profile starts with the real empty state, not a zeroed scaffold.
  await expect(page.getByText('Your collection is empty.')).toBeVisible();

  // Added oldest to newest, so the expected order is the reverse.
  await collect(page, IN_RAINBOWS);
  await collect(page, WATCH_THE_THRONE);
  await collect(page, UNKNOWN_PLEASURES);

  await page.goto(`/${user.handle}`);

  await expect(page.getByText('Your collection is empty.')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.getByText('3 albums')).toBeVisible();

  // Ordering is `added_at` descending — the most recently added album leads.
  // Compact mode is bare artwork, so the covers' accessible names are the
  // order.
  const covers = page.getByRole('listitem').getByRole('img');
  await expect(covers).toHaveCount(3);
  await expect(covers.nth(0)).toHaveAccessibleName(/Unknown Pleasures/);
  await expect(covers.nth(1)).toHaveAccessibleName(/Watch the Throne/);
  await expect(covers.nth(2)).toHaveAccessibleName(/In Rainbows/);
});

test('the profile renders artwork only, with no density control', async ({ page }) => {
  // Locks the deferral. Compact is the locked default on this surface and the
  // density switch was deliberately not built, so a collection carrying every
  // marker must still render as a bare wall of covers. If a future change
  // introduces a control or flips the default, this fails rather than silently
  // shipping a product decision that was explicitly postponed.
  //
  // The markers themselves are correct in the data — see the service unit tests
  // and the integration suite. What is asserted here is that this surface does
  // not draw them yet.
  const user = await signUp(page);

  await rate(page, WATCH_THE_THRONE, '8.5');

  await page.goto(`/albums/${IN_RAINBOWS}`);
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  await page.goto(`/albums/${UNKNOWN_PLEASURES}`);
  await page.getByRole('button', { name: 'Relisten', exact: true }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  await page.goto(`/${user.handle}`);

  // Every album is there.
  await expect(page.getByRole('listitem').getByRole('img')).toHaveCount(3);
  await expect(page.getByText('3 albums')).toBeVisible();

  // None of their state is drawn, and there is no way to ask for it.
  await expect(page.getByText('8.5')).toBeHidden();
  await expect(page.getByText('Radiohead')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Detailed' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Compact' })).toHaveCount(0);
});

test('a signed-out visitor sees the public collection', async ({ page, context }) => {
  const user = await signUp(page);
  await rate(page, WATCH_THE_THRONE, '7.2');

  // Everything user-generated is public, verified from a session with no
  // cookies at all rather than by signing out.
  await context.clearCookies();
  await page.goto(`/${user.handle}`);

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.getByText('1 album')).toBeVisible();
  await expect(tileFor(page, 'Watch the Throne')).toBeVisible();

  // A visitor sees the collection, and is told it is not theirs.
  await expect(page.getByText('Your collection is empty.')).toBeHidden();
});

test('one user’s collection never appears on another user’s profile', async ({ page, browser }) => {
  // Both users hold the *same* album, which is the case a query missing its
  // user_id filter would render identically for both. Nothing here is private
  // — everything user-generated is public — so the claim is that each profile
  // shows its own owner's albums, not that anything is hidden from anyone.
  //
  // Per-marker isolation is asserted in the integration suite, which can see
  // the scores this surface does not draw.
  const first = await signUp(page);
  await rate(page, IN_RAINBOWS, '9.6');

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const second = await signUp(secondPage);
  await rate(secondPage, IN_RAINBOWS, '1.2');
  await collect(secondPage, UNKNOWN_PLEASURES);

  // The second user holds two albums, one of them shared with the first.
  await secondPage.goto(`/${second.handle}`);
  await expect(secondPage.getByText('2 albums')).toBeVisible();
  await expect(tileFor(secondPage, 'In Rainbows')).toBeVisible();
  await expect(tileFor(secondPage, 'Unknown Pleasures')).toBeVisible();

  // The first user's profile is unchanged by any of it, and does not acquire
  // the album only the second user added.
  await page.goto(`/${first.handle}`);
  await expect(page.getByText('1 album')).toBeVisible();
  await expect(tileFor(page, 'In Rainbows')).toBeVisible();
  await expect(tileFor(page, 'Unknown Pleasures')).toHaveCount(0);

  // Viewing someone else's empty-handed profile is a different sentence than
  // viewing your own.
  const third = await signUp(await (await browser.newContext()).newPage());
  await page.goto(`/${third.handle}`);
  await expect(page.getByText(`${third.handle} hasn’t added any albums yet.`)).toBeVisible();
  await expect(page.getByText('Your collection is empty.')).toBeHidden();

  await secondContext.close();
});
