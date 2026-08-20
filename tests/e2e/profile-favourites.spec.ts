import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Favourites on the public profile overview, end to end.
 *
 * **Favourites are created directly here, not through the album card.** The
 * card can now pin and unpin — that path is covered in `favourites.spec.ts` —
 * but it always writes position 1, then 2, then 3, which cannot produce the
 * arrangements this file is about. Writing the rows directly is what lets a
 * test assert an order the interface has no way to ask for yet, since ordering
 * management is unbuilt.
 *
 * The pins are written the way the service writes them — a row in
 * `favourite_albums` at the given position, and **no collection entry** — so
 * what the page renders is what a real pin would produce.
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
const UNKNOWN_PLEASURES = '0b0e4f1e-1111-4000-8000-000000000006';

const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-fav-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2efav_${id}`.slice(0, 30),
  };
}

const createdEmails: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
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

/**
 * Pins albums for a handle, in the given order, exactly as `addFavourite` does:
 * lowest free position, and nothing written to `collection_entries`.
 */
async function pinFavourites(handle: string, mbids: string[]) {
  const admin = adminClient();

  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();

  let position = 1;
  for (const mbid of mbids) {
    const { data: album } = await admin.from('albums').select('id').eq('mbid', mbid).single();
    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: profile!.id, album_id: album!.id, position });
    if (error) throw error;
    position += 1;
  }
}

/** How many collection entries a handle holds — used to prove pinning collected nothing. */
async function collectionSize(handle: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const { count } = await admin
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  return count ?? 0;
}

/** The favourites row, scoped by its own heading rather than by position on the page. */
function favouritesRow(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Favourites' }) });
}

test('favourites appear on the public profile, in the owner’s order', async ({ page }) => {
  const user = await signUp(page);
  await pinFavourites(user.handle, [UNKNOWN_PLEASURES, IN_RAINBOWS, WATCH_THE_THRONE]);

  await page.goto(`/${user.handle}`);

  const row = favouritesRow(page);
  await expect(row).toBeVisible();

  const covers = row.getByRole('img');
  await expect(covers).toHaveCount(3);

  // Position 1 first — not catalogue order, and not the collection's
  // most-recently-added order.
  await expect(covers.nth(0)).toHaveAccessibleName(/Unknown Pleasures/);
  await expect(covers.nth(1)).toHaveAccessibleName(/In Rainbows/);
  await expect(covers.nth(2)).toHaveAccessibleName(/Watch the Throne/);
});

test('an album can be a favourite without ever being collected', async ({ page }) => {
  // The decision the whole relation exists to express. If pinning quietly
  // collected, the collection section below would fill up too.
  const user = await signUp(page);
  await pinFavourites(user.handle, [ACID_RAP]);

  expect(await collectionSize(user.handle)).toBe(0);

  await page.goto(`/${user.handle}`);

  await expect(favouritesRow(page).getByRole('img')).toHaveCount(1);
  // The collection is still empty, and says so.
  await expect(page.getByText('Your collection is empty.')).toBeVisible();
});

test('favourites are artwork only — no titles, no credits, no scores', async ({ page }) => {
  const user = await signUp(page);
  await pinFavourites(user.handle, [IN_RAINBOWS]);

  await page.goto(`/${user.handle}`);

  const row = favouritesRow(page);
  await expect(row.getByRole('img')).toHaveCount(1);
  // A credit is the giveaway: a title can coincide with other copy, an artist
  // credit cannot.
  await expect(row.getByText('Radiohead')).toHaveCount(0);
  await expect(row.locator('p')).toHaveCount(0);
});

test('a profile with no favourites shows no Favourites section at all', async ({ page }) => {
  // Absence is the absence of anything — no heading, no empty panel, no
  // "0 favourites". Asserted for the owner's own view, which is where a prompt
  // would most plausibly have been added.
  const user = await signUp(page);

  await page.goto(`/${user.handle}`);

  await expect(page.getByRole('heading', { name: 'Favourites' })).toHaveCount(0);
  await expect(page.getByText(/favourite/i)).toHaveCount(0);
  // The collection section is still there, so this is not an empty page.
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
});

test('favourites are public, and do not leak between profiles', async ({ page, context }) => {
  const owner = await signUp(page);
  await pinFavourites(owner.handle, [IN_RAINBOWS, WATCH_THE_THRONE]);

  const otherContext = await context.browser()!.newContext();
  const otherPage = await otherContext.newPage();
  const other = await signUp(otherPage);
  await pinFavourites(other.handle, [ACID_RAP]);

  // Signed out entirely — everything user-generated is public.
  await context.clearCookies();
  await page.goto(`/${owner.handle}`);

  const row = favouritesRow(page);
  await expect(row.getByRole('img')).toHaveCount(2);
  await expect(row.getByRole('img').nth(0)).toHaveAccessibleName(/In Rainbows/);
  await expect(row.getByRole('img', { name: /Acid Rap/ })).toHaveCount(0);

  // And the other profile carries only its own pin.
  await otherPage.goto(`/${other.handle}`);
  const otherRow = favouritesRow(otherPage);
  await expect(otherRow.getByRole('img')).toHaveCount(1);
  await expect(otherRow.getByRole('img').nth(0)).toHaveAccessibleName(/Acid Rap/);

  await otherContext.close();
});

test('a favourite links through to its album', async ({ page }) => {
  const user = await signUp(page);
  await pinFavourites(user.handle, [IN_RAINBOWS]);

  await page.goto(`/${user.handle}`);
  await favouritesRow(page).getByRole('link').first().click();

  await expect(page).toHaveURL(`/albums/${IN_RAINBOWS}`, NAV);
});
