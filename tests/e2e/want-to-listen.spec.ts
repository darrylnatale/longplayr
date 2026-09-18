import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { albumUrl } from './urls';

/**
 * Want to Listen, from the album action card.
 *
 * **The independence claim is the thing under test**, and it is not visible to
 * an integration test: wanting an album must not collect it, unwanting must not
 * remove it, and neither may disturb a rating, a like or a favourite. Every
 * assertion here runs through the rendered card, with the database checked only
 * where the page cannot show the answer.
 *
 * **The full toggle cycle runs in the browser deliberately.** The same
 * disclosure-state bug has shipped three times — the rating control, the review
 * editor, and the shape the favourite toggle was keyed against — and every time
 * the integration suite stayed green. Wanting is the worst case for it again:
 * the card's kind does not change when an uncollected album is wanted, so React
 * keeps the whole subtree across the mutation.
 *
 * Accounts are deleted afterwards, which cascades to the profile and from there
 * to `want_to_listen` and `collection_entries`. Albums come from the local
 * fixture catalogue (`npm run db:seed:fixtures`) and are never modified.
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
    email: `e2e-w2l-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ew2l_${id}`.slice(0, 30),
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
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  return user;
}

/** The toggle, found by its accessible name in either state. */
const wantButton = (page: Page) =>
  page.getByRole('button', { name: /^(Want to listen|On your list)$/ });
const favouriteButton = (page: Page) => page.getByRole('button', { name: /^Favourited?$/ });

async function counts(handle: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const entries = await admin
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  const wishes = await admin
    .from('want_to_listen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  return { entries: entries.count ?? 0, wishes: wishes.count ?? 0 };
}

test('want an uncollected album, and it stays uncollected', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'false');

  await wantButton(page).click();

  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(wantButton(page)).toHaveText('On your list');

  // Wanting is not collecting. The card has not changed kind, and the database
  // agrees.
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
  await expect(page.getByText('In your collection')).toBeHidden();
  expect(await counts(user.handle)).toEqual({ entries: 0, wishes: 1 });
});

test('the toggle survives a full cycle, and a reload', async ({ page }) => {
  // The regression this file exists for, run as the prescribed sequence:
  // false, add, true, remove, false, reload, verify.
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  const button = wantButton(page);
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true', ACTION);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false', ACTION);
  await expect(button).toHaveText('Want to listen');

  await page.reload();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'false');

  // Back on again, so the second direction is exercised on the same rendered
  // control, then confirmed by a reload rather than by the optimistic view.
  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  await page.reload();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(wantButton(page)).toHaveText('On your list');

  // Collection membership never moved throughout.
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
  expect(await counts(user.handle)).toEqual({ entries: 0, wishes: 1 });
});

test('want a collected album without disturbing anything about it', async ({ page }) => {
  const user = await signUp(page);

  await page.goto(await albumUrl(WATCH_THE_THRONE));
  await page.getByRole('button', { name: 'Rate', exact: true }).click();
  await page.getByLabel('Your score').fill('8.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText('8.5', ACTION);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  // Offered on a collected album — resolved 2026-08-20 — and it coexists.
  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  await expect(page.getByTitle('Your score')).toHaveText('8.5');
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
  expect(await counts(user.handle)).toEqual({ entries: 1, wishes: 1 });

  // And unwanting leaves the collection entry exactly where it was.
  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'false', ACTION);

  await expect(page.getByTitle('Your score')).toHaveText('8.5');
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
  expect(await counts(user.handle)).toEqual({ entries: 1, wishes: 0 });
});

test('adding to the collection clears the wish, one way only', async ({ page }) => {
  // The locked one-way rule, seen from the interface. Wanting first, then
  // collecting, must leave the album collected and off the list — and the
  // control must reflect that without a manual refresh.
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  expect(await counts(user.handle)).toEqual({ entries: 0, wishes: 1 });

  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  // Collected, and the wish is gone — from the database and from the card.
  expect(await counts(user.handle)).toEqual({ entries: 1, wishes: 0 });
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(wantButton(page)).toHaveText('Want to listen');
});

test('Want to Listen and Favourite do not move each other', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'false');

  await favouriteButton(page).click();
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  // Favouriting did not disturb the wish.
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true');

  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'false', ACTION);
  // Unwanting did not disturb the favourite.
  await expect(favouriteButton(page)).toHaveAttribute('aria-pressed', 'true');

  // Neither relation collected the album.
  expect(await counts(user.handle)).toEqual({ entries: 0, wishes: 0 });
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();
});

test('liking does not disturb the wish, though it does collect', async ({ page }) => {
  // Like collects, so this is the one pairing where the wish legitimately
  // disappears — through the clearing rule on entry creation, not because Like
  // touched the wishlist.
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  // Collected by the like, and the wish cleared as a consequence of the entry
  // being created.
  expect(await counts(user.handle)).toEqual({ entries: 1, wishes: 0 });

  // Wanting it again afterwards is legal: the relations are independent, and
  // the rule does not run in this direction.
  await wantButton(page).click();
  await expect(wantButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  expect(await counts(user.handle)).toEqual({ entries: 1, wishes: 1 });
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible();
});

test('a signed-out visitor is offered no Want to Listen control', async ({ page }) => {
  await page.goto(await albumUrl(IN_RAINBOWS));

  await expect(page.getByRole('link', { name: 'Sign in to add' })).toBeVisible();
  await expect(wantButton(page)).toHaveCount(0);
});
