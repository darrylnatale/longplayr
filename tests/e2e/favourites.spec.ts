import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Favouriting and unfavouriting from the album action card.
 *
 * **The full cycle runs in the browser deliberately.** The same disclosure-state
 * bug has shipped twice — the rating control and the review editor both stayed
 * open holding stale state, because the card's kind did not change and React
 * preserved the subtree — and both times every integration test passed while
 * only an end-to-end test caught it. Favouriting is the worst case for that
 * shape: pinning an uncollected album leaves it uncollected, so the card's kind
 * never changes at all. These tests therefore toggle in both directions, twice,
 * rather than asserting a single transition.
 *
 * Accounts and their favourites are cleaned up afterwards. Deleting the auth
 * user cascades to the profile and from there to `favourite_albums`, which is
 * the same cascade account deletion relies on.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002';

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-fv-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2efv_${id}`.slice(0, 30),
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
      // Cascades to the profile, and from there to favourites and collection.
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

/** The toggle, found by its accessible name in either state. */
const favouriteButton = (page: Page) => page.getByRole('button', { name: /^Favourited?$/ });

/** How many collection entries the handle holds — the independence claim. */
async function collectionSize(handle: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const { count } = await admin
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  return count ?? 0;
}

test('favourite an uncollected album, and it stays uncollected', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(`/albums/${IN_RAINBOWS}`);

  // Not collected, not favourited.
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'false');

  await favouriteButton(page).click();

  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(favouriteButton(page)).toHaveText('Favourited');

  // The card has not moved into a collected state, and the database agrees.
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
  await expect(page.getByText('In your collection')).toBeHidden();
  expect(await collectionSize(user.handle)).toBe(0);
});

test('the toggle survives a full cycle in both directions', async ({ page }) => {
  // The regression this file exists for. The card's kind never changes here, so
  // React keeps the subtree across every one of these mutations.
  const user = await signUp(page);
  await page.goto(`/albums/${IN_RAINBOWS}`);

  const button = favouriteButton(page);

  // favourite → unfavourite
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', ACTION);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false', ACTION);
  await expect(button).toHaveText('Favourite');

  // unfavourite → favourite, on the same rendered control
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(button).toHaveText('Favourited');

  // And once more, to catch state that survives one round trip but not two.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false', ACTION);

  // A reload agrees with the last thing the page said.
  await page.reload();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await collectionSize(user.handle)).toBe(0);
});

test('favourite an album already in the collection, leaving its state untouched', async ({
  page,
}) => {
  const user = await signUp(page);

  // Collect and score it first.
  await page.goto(`/albums/${WATCH_THE_THRONE}`);
  await page.getByRole('button', { name: 'Rate', exact: true }).click();
  await page.getByLabel('Your score').fill('8.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText('8.5', ACTION);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  await favouriteButton(page).click();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  // Score and like are exactly where they were, and Like is still its own
  // control rather than having been conflated with the favourite.
  await expect(page.getByTitle('Your score')).toHaveText('8.5');
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
  expect(await collectionSize(user.handle)).toBe(1);

  // Unfavouriting does not remove it from the collection either.
  await favouriteButton(page).click();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'false', ACTION);

  await expect(page.getByTitle('Your score')).toHaveText('8.5');
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
  expect(await collectionSize(user.handle)).toBe(1);
});

test('a favourite made on the album page shows on the profile', async ({ page }) => {
  const user = await signUp(page);

  await page.goto(`/albums/${IN_RAINBOWS}`);
  await favouriteButton(page).click();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  await page.goto(`/${user.handle}`);

  const row = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Favourites' }) });
  await expect(row.getByRole('img')).toHaveCount(1);
  await expect(row.getByRole('img').first()).toHaveAccessibleName(/In Rainbows/);

  // And the collection section is still empty, on the same page.
  await expect(page.getByText('Your collection is empty.')).toBeVisible();
});

test('Like and Favourite are separate controls, not one toggle', async ({ page }) => {
  // They are different relations. If a shortcut ever derived one from the
  // other, this is where it shows.
  const user = await signUp(page);
  await page.goto(`/albums/${IN_RAINBOWS}`);

  await favouriteButton(page).click();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  // Liking is a different act — and on an uncollected album it collects, which
  // favouriting did not.
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toBeVisible();
  expect(await collectionSize(user.handle)).toBe(0);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  // Now collected — by the like, not by the favourite — and still favourited.
  expect(await collectionSize(user.handle)).toBe(1);
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a signed-out visitor is offered no favourite control', async ({ page }) => {
  await page.goto(`/albums/${IN_RAINBOWS}`);

  await expect(page.getByRole('link', { name: 'Sign in to add' })).toBeVisible();
  await expect(favouriteButton(page)).toHaveCount(0);
});
