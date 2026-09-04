import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Lists, end to end. Phase 4, slice 1.
 *
 * **Lists are built through the interface here, not written directly.** Unlike
 * `profile-favourites.spec.ts`, every arrangement this file asserts is one a
 * user can actually produce — creating, adding from an album page, reordering
 * and removing are all controls that exist. Writing rows directly would skip the
 * surfaces this slice is mostly about.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. */
const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002';
const ACID_RAP = '0b0e4f1e-1111-4000-8000-000000000004';

const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-list-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2elist_${id}`.slice(0, 30),
  };
}

const createdEmails: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || createdEmails.length === 0) return;

  const admin = adminClient();
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

/** Creates a list through the owner's own lists destination. */
async function createList(page: Page, handle: string, title: string, ranked = false) {
  await page.goto(`/${handle}/lists`);
  await page.getByLabel('Title').fill(title);
  if (ranked) await page.getByLabel(/^Ranked/).check();
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible(NAV);
}

/** Adds an album to a named list from that album's page. */
async function addAlbum(page: Page, mbid: string, listTitle: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByLabel('Add to a list').selectOption({ label: listTitle });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

async function openList(page: Page, handle: string, title: string) {
  await page.goto(`/${handle}/lists`);
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/, NAV);
}

test('a profile with no lists shows no Lists section at all', async ({ page }) => {
  const user = await signUp(page);

  await page.goto(`/${user.handle}`);

  // The no-empty-scaffold rule: an empty section on every profile is an untrue
  // claim about the person, so nothing is rendered rather than a placeholder.
  await expect(page.getByRole('heading', { name: 'Lists' })).toHaveCount(0);
});

test('a list can be created, appears on the profile, and is publicly readable', async ({
  page,
  browser,
}) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Long drive records');

  await page.goto(`/${user.handle}`);
  await expect(page.getByRole('link', { name: 'Long drive records' })).toBeVisible();

  // Everything user-generated is public, so a signed-out visitor sees the same
  // list at the same address.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`/${user.handle}/lists`);
  await expect(anonPage.getByRole('link', { name: /Long drive records/ })).toBeVisible(NAV);
  await anon.close();
});

test('albums are added from an album page and removed from the list page', async ({ page }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Additions');

  await addAlbum(page, IN_RAINBOWS, 'Additions');
  await addAlbum(page, WATCH_THE_THRONE, 'Additions');

  await openList(page, user.handle, 'Additions');
  await expect(page.getByRole('link', { name: /In Rainbows/ }).first()).toBeVisible();

  await page.getByRole('button', { name: /^Remove In Rainbows$/ }).click();
  await expect(page.getByRole('button', { name: /^Remove In Rainbows$/ })).toHaveCount(0, NAV);

  // The other album survives: removing one entry is not removing the list.
  await expect(page.getByRole('button', { name: /^Remove Watch the Throne$/ })).toBeVisible();
});

test('the same album cannot be added to one list twice', async ({ page }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Duplicates');

  await addAlbum(page, ACID_RAP, 'Duplicates');
  await addAlbum(page, ACID_RAP, 'Duplicates');

  // An ordinary thing to try, so it is a message rather than an error page.
  //
  // Located by its text rather than by `role=alert`: Next's route announcer is
  // also an alert, so the role alone matches two elements.
  await expect(page.getByText('That album is already in the list.')).toBeVisible(NAV);

  await openList(page, user.handle, 'Duplicates');
  await expect(page.getByRole('button', { name: /^Remove Acid Rap$/ })).toHaveCount(1);
});

test('a ranked list renders numbered and reorders through its controls', async ({ page }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Ranked picks', true);

  await addAlbum(page, IN_RAINBOWS, 'Ranked picks');
  await addAlbum(page, WATCH_THE_THRONE, 'Ranked picks');

  await openList(page, user.handle, 'Ranked picks');

  // Numbered when ranked — an ordered list, not a grid.
  const items = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Remove/ }) });
  await expect(items.first()).toContainText('In Rainbows');

  // Move the second album to the front.
  await page.getByRole('button', { name: /^Move Watch the Throne up$/ }).click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Remove/ }) })
      .first(),
  ).toContainText('Watch the Throne', NAV);
});

test('unranking keeps the order, and re-ranking restores it exactly', async ({ page }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Transitions', true);

  await addAlbum(page, IN_RAINBOWS, 'Transitions');
  await addAlbum(page, WATCH_THE_THRONE, 'Transitions');

  await openList(page, user.handle, 'Transitions');

  // Curate an order that no fallback sort would reproduce.
  await page.getByRole('button', { name: /^Move Watch the Throne up$/ }).click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Remove/ }) })
      .first(),
  ).toContainText('Watch the Throne', NAV);

  const url = page.url();

  // Turn ranking off, then on again.
  await page.getByText('Edit this list').click();
  await page.getByLabel(/^Ranked/).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /^Move Watch the Throne up$/ })).toHaveCount(
    0,
    NAV,
  );

  await page.goto(url);
  await page.getByText('Edit this list').click();
  await page.getByLabel(/^Ranked/).check();
  await page.getByRole('button', { name: 'Save changes' }).click();

  // The curated order survived the round trip.
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Remove/ }) })
      .first(),
  ).toContainText('Watch the Throne', NAV);
});

test('a visitor sees the list but none of the owner controls', async ({ page, browser }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Read only', true);
  await addAlbum(page, IN_RAINBOWS, 'Read only');

  await openList(page, user.handle, 'Read only');
  const url = page.url();

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(url);

  await expect(anonPage.getByText('Read only').first()).toBeVisible(NAV);
  await expect(anonPage.getByRole('link', { name: /In Rainbows/ }).first()).toBeVisible();

  // Read-only for everyone but the owner.
  await expect(anonPage.getByText('Edit this list')).toHaveCount(0);
  await expect(anonPage.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(anonPage.getByRole('button', { name: /^Move/ })).toHaveCount(0);

  await anon.close();
});

test('a list can be deleted, and the profile section goes with it', async ({ page }) => {
  const user = await signUp(page);
  await createList(page, user.handle, 'Temporary');

  await openList(page, user.handle, 'Temporary');
  await page.getByText('Edit this list').click();
  await page.getByRole('button', { name: 'Delete list permanently' }).click();

  await expect(page).toHaveURL(`/${user.handle}/lists`, NAV);
  await expect(page.getByRole('link', { name: /Temporary/ })).toHaveCount(0);

  // Back to no Lists section at all, since the rule is about having none.
  await page.goto(`/${user.handle}`);
  await expect(page.getByRole('heading', { name: 'Lists' })).toHaveCount(0);
});
