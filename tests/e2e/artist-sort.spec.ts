import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { albumUrl, artistUrl } from './urls';

/**
 * Discography sorting on the artist page.
 *
 * **The ordering itself is not asserted here, and cannot be.** Every artist in
 * the local fixture catalogue holds exactly one album — `db:seed:fixtures`
 * ingests eight fixtures producing seven albums, and the only artist pair is
 * Watch the Throne appearing under both of its credits. Multi-album ordering is
 * therefore unobservable in a browser without manufacturing catalogue records,
 * which is excluded. It is proven instead where it actually lives: the
 * comparator is exported and pure, and `discography-sort.test.ts` covers both
 * directions, undated releases staying last in each, partial dates and the
 * empty case.
 *
 * What this file owns is everything else the browser can see — the URL
 * contract, the fallback, the control's visibility rule, and that sorting is a
 * read which mutates nothing.
 *
 * Albums come from the local fixture catalogue and are never modified.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. Each holds a single release. */
const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-as-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2eas_${id}`.slice(0, 30),
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

/** Everything the user holds for one album, read from the rows. */
async function stateFor(handle: string, mbid: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const { data: album } = await admin.from('albums').select('id').eq('mbid', mbid).single();

  const { data: entry } = await admin
    .from('collection_entries')
    .select('id, rating, liked, relisten_count, listened_on')
    .eq('user_id', profile!.id)
    .eq('album_id', album!.id)
    .maybeSingle();

  const reviews = entry
    ? await admin
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry.id)
    : { count: 0 };

  const favourites = await admin
    .from('favourite_albums')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  const wishes = await admin
    .from('want_to_listen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);

  return {
    entry,
    reviews: reviews.count ?? 0,
    favourites: favourites.count ?? 0,
    wishes: wishes.count ?? 0,
  };
}

test('the artist page renders its discography', async ({ page }) => {
  await page.goto(await artistUrl(RADIOHEAD));

  await expect(page.getByRole('heading', { name: 'Radiohead', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible();
  await expect(page.getByRole('link', { name: /In Rainbows/ })).toBeVisible();
  // Captions are on for this grid, and the year is half the point.
  await expect(page.getByText('2007')).toBeVisible();
});

test('a single-release discography is offered no sort control', async ({ page }) => {
  // Sorting one album is meaningless, so the control is withheld rather than
  // rendered inert. Every fixture artist holds exactly one release, which is
  // also why ordering itself is proven in the unit tests rather than here.
  await page.goto(await artistUrl(RADIOHEAD));

  await expect(page.getByRole('link', { name: 'Oldest' })).toHaveCount(0);
  await expect(page.getByText('Newest')).toHaveCount(0);
});

test('?sort=oldest is a valid address and renders the discography', async ({ page }) => {
  const response = await page.goto(`${await artistUrl(RADIOHEAD)}?sort=oldest`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Radiohead', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /In Rainbows/ })).toBeVisible();
  // The address survives — the sort is server-rendered state, not client state.
  await expect(page).toHaveURL(`${await artistUrl(RADIOHEAD)}?sort=oldest`);
});

test('an unrecognised sort falls back to the default rather than erroring', async ({ page }) => {
  for (const value of ['banana', '', 'NEWEST', 'oldest%20', '1']) {
    const response = await page.goto(`${await artistUrl(RADIOHEAD)}?sort=${value}`);

    expect(response?.status(), `?sort=${value} should render`).toBe(200);
    await expect(page.getByRole('link', { name: /In Rainbows/ })).toBeVisible();
  }
});

test('a repeated sort parameter does not break the page', async ({ page }) => {
  // `searchParams` hands back an array when a key repeats; the parser takes the
  // first rather than stringifying the array into nonsense.
  const response = await page.goto(`${await artistUrl(RADIOHEAD)}?sort=oldest&sort=newest`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('link', { name: /In Rainbows/ })).toBeVisible();
});

test('sorting mutates no collection state', async ({ page }) => {
  // The whole surface is a read. This holds every relation the album card owns
  // and proves each one is untouched by visiting the artist page under a sort.
  const user = await signUp(page);

  await page.goto(await albumUrl(IN_RAINBOWS));
  await page.getByRole('button', { name: 'Rate', exact: true }).click();
  await page.getByLabel('Your score').fill('8.1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText('8.1', ACTION);

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  await page.getByRole('button', { name: /^Favourited?$/ }).click();
  await expect(page.getByRole('button', { name: 'Favourited' })).toBeVisible(ACTION);

  await page.getByRole('button', { name: 'Want to listen' }).click();
  await expect(page.getByRole('button', { name: 'On your list' })).toBeVisible(ACTION);

  const before = await stateFor(user.handle, IN_RAINBOWS);
  expect(before.entry).not.toBeNull();

  // Visit the artist page under both sorts and an invalid one.
  for (const query of ['', '?sort=oldest', '?sort=newest', '?sort=nonsense']) {
    await page.goto(`/artists/${RADIOHEAD}${query}`);
    await expect(page.getByRole('heading', { name: 'Discography' })).toBeVisible();
  }

  const after = await stateFor(user.handle, IN_RAINBOWS);

  // Rating, like, relisten count, listened_on, review, favourite and wish —
  // every one of them exactly as it was.
  expect(after).toEqual(before);
});

test('the album page is unchanged after sorting', async ({ page }) => {
  const user = await signUp(page);

  await page.goto(await albumUrl(IN_RAINBOWS));
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  await page.goto(`${await artistUrl(RADIOHEAD)}?sort=oldest`);
  await page.goto(await albumUrl(IN_RAINBOWS));

  // Still collected, and still unrated — the sort read nothing into it.
  await expect(page.getByText('In your collection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to collection' })).toHaveCount(0);
  expect((await stateFor(user.handle, IN_RAINBOWS)).entry!.rating).toBeNull();
});
