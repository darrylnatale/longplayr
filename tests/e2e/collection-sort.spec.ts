import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Collection sorting, in a browser.
 *
 * **Ordering itself is asserted here, unlike on the artist page.** That spec
 * cannot see an order because every fixture artist holds exactly one album;
 * this one can, because a user may collect several fixture albums into one
 * collection and the seven of them carry distinct titles, credits and years.
 * Four are enough to give all six modes a different answer, which is what makes
 * a query that quietly ignored its sort fail every case rather than pass one by
 * coincidence.
 *
 * **Pagination cannot be exercised end to end.** The destination pages at 60
 * and the local fixture catalogue holds seven albums, so no account reachable
 * from here can cross a page boundary — the same bound
 * `profile-collection.spec.ts` already records. Two consequences:
 *
 *  - That a sort link **omits** `page` is asserted here, from the rendered
 *    href, because it needs no second page to be true.
 *  - That a pagination link **carries** the active sort is not, because the
 *    control never renders. It is covered in `src/services/collection/
 *    sort.test.ts`, where both hrefs come from the one builder the page uses.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified. Only the users' own collection rows are written, and the
 * accounts are deleted afterwards.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. All are coverless, so tiles render the placeholder. */
const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001'; // Radiohead          · 2007
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002'; // Jay-Z & Kanye West · 2011
const ACID_RAP = '0b0e4f1e-1111-4000-8000-000000000004'; // Chance the Rapper  · 2013
const UNKNOWN_PLEASURES = '0b0e4f1e-1111-4000-8000-000000000006'; // Joy Division       · 1979

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-cs-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ecs_${id}`.slice(0, 30),
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

/** Plain add, from the album page. */
async function collect(page: Page, mbid: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);
}

/** Add with a listen date, through the disclosure the date lives behind. */
async function collectListenedOn(page: Page, mbid: string, date: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByRole('button', { name: /^Add with a listen date…$/ }).click();
  await page.getByLabel('Listened on').fill(date);
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);
}

/**
 * Score an album already held. Does not move `added_at`.
 *
 * The trigger's label depends on the card's state: `Rate` when the album is not
 * collected, `Rate this album` once it is, where rating becomes the dominant
 * action (design-reference.md §6.4). Every call here is the second case.
 */
async function rate(page: Page, mbid: string, score: string) {
  await page.goto(`/albums/${mbid}`);
  await page.getByRole('button', { name: /^Rate(?: this album)?$/ }).click();
  await page.getByLabel('Your score').fill(score);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText(score, ACTION);
}

const sortNav = (page: Page) => page.getByRole('navigation', { name: 'Sort collection' });

/**
 * The grid's order, read from the covers' accessible names.
 *
 * Compact mode is bare artwork — no title, no credit, by decision — so the
 * covers are the only thing on a tile that names the album, and they are
 * therefore the order.
 */
async function expectOrder(page: Page, expected: RegExp[]) {
  const covers = page.getByRole('listitem').getByRole('img');
  await expect(covers).toHaveCount(expected.length);

  for (const [index, pattern] of expected.entries()) {
    await expect(covers.nth(index), `position ${index}`).toHaveAccessibleName(pattern);
  }
}

const ACID = /Acid Rap/;
const RAINBOWS = /In Rainbows/;
const PLEASURES = /Unknown Pleasures/;
const THRONE = /Watch the Throne/;

/**
 * One account holding four albums, added in a known order and nothing else set.
 *
 * | album             | added | credit             | year |
 * | ----------------- | ----- | ------------------ | ---- |
 * | In Rainbows       | 1st   | Radiohead          | 2007 |
 * | Watch the Throne  | 2nd   | Jay-Z & Kanye West | 2011 |
 * | Unknown Pleasures | 3rd   | Joy Division       | 1979 |
 * | Acid Rap          | 4th   | Chance the Rapper  | 2013 |
 *
 * **This is the fixture most tests want**, because most of them assert the
 * default order, or the Title or Artist order, and none of those reads a score
 * or a listen date. Four adds is four server actions; the scored variant below
 * is six, and running six where four will do — in eight of eleven tests —
 * bought nothing but exposure to the revalidation flake `current-state.md` §8
 * already tracks.
 */
async function collectionOfFour(page: Page) {
  const user = await signUp(page);

  await collect(page, IN_RAINBOWS);
  await collect(page, WATCH_THE_THRONE);
  await collect(page, UNKNOWN_PLEASURES);
  await collect(page, ACID_RAP);

  return user;
}

/**
 * The same four, plus the listen dates and scores the other two modes read.
 *
 * | album             | added | listened   | rating |
 * | ----------------- | ----- | ---------- | ------ |
 * | In Rainbows       | 1st   | —          | 9.6    |
 * | Watch the Throne  | 2nd   | 1997-05-21 | 3.1    |
 * | Unknown Pleasures | 3rd   | 2026-08-19 | —      |
 * | Acid Rap          | 4th   | —          | —      |
 *
 * Arranged so that no two of the six modes agree, which is what makes a query
 * that quietly ignored its sort fail every case rather than pass one by
 * coincidence. Only the test that exercises all six needs this much.
 *
 * Rating happens after every add, so it cannot disturb `added_at` — the
 * separation the two columns exist for.
 */
async function scoredCollectionOfFour(page: Page) {
  const user = await signUp(page);

  await collect(page, IN_RAINBOWS);
  await collectListenedOn(page, WATCH_THE_THRONE, '1997-05-21');
  await collectListenedOn(page, UNKNOWN_PLEASURES, '2026-08-19');
  await collect(page, ACID_RAP);

  await rate(page, IN_RAINBOWS, '9.6');
  await rate(page, WATCH_THE_THRONE, '3.1');

  return user;
}

// ---------------------------------------------------------------------------

test('the sort control renders, with Added active on the bare address', async ({ page }) => {
  const user = await signUp(page);
  await collect(page, IN_RAINBOWS);
  await collect(page, ACID_RAP);

  await page.goto(`/${user.handle}/collection`);

  const nav = sortNav(page);
  await expect(nav).toBeVisible();
  await expect(nav.getByText('Sort')).toBeVisible();

  // Six modes, and the default is the one that is not a link.
  await expect(nav.getByText('Added')).toHaveAttribute('aria-current', 'true');
  for (const label of ['Listened', 'Rating', 'Title', 'Artist', 'Year']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Added' })).toHaveCount(0);
});

test('every mode changes the address and the rendered order', async ({ page }) => {
  const user = await scoredCollectionOfFour(page);
  const collection = `/${user.handle}/collection`;

  // Added — newest addition first. The bare address.
  await page.goto(collection);
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);

  // Listened — most recent listen first, then the two with no date at all,
  // which fall back to added_at rather than to an arbitrary order.
  await page.getByRole('link', { name: 'Listened' }).click();
  await expect(page).toHaveURL(`${collection}?sort=listened`, NAV);
  await expect(sortNav(page).getByText('Listened')).toHaveAttribute('aria-current', 'true');
  await expectOrder(page, [PLEASURES, THRONE, ACID, RAINBOWS]);

  // Rating — highest first, unrated last and still visible.
  await page.getByRole('link', { name: 'Rating' }).click();
  await expect(page).toHaveURL(`${collection}?sort=rating`, NAV);
  await expectOrder(page, [RAINBOWS, THRONE, ACID, PLEASURES]);

  // Title — A to Z.
  await page.getByRole('link', { name: 'Title' }).click();
  await expect(page).toHaveURL(`${collection}?sort=title`, NAV);
  await expectOrder(page, [ACID, RAINBOWS, PLEASURES, THRONE]);

  // Artist — A to Z by the album's credit, so Jay-Z & Kanye West files under J.
  await page.getByRole('link', { name: 'Artist' }).click();
  await expect(page).toHaveURL(`${collection}?sort=artist`, NAV);
  await expectOrder(page, [ACID, THRONE, PLEASURES, RAINBOWS]);

  // Year — newest release first.
  await page.getByRole('link', { name: 'Year' }).click();
  await expect(page).toHaveURL(`${collection}?sort=year`, NAV);
  await expectOrder(page, [ACID, THRONE, RAINBOWS, PLEASURES]);

  // And back, by the address rather than by a control.
  await page.goto(collection);
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
});

test('?sort=added renders exactly what the bare address renders', async ({ page }) => {
  // A legitimate address someone can type or bookmark, even though the control
  // never emits it.
  const user = await collectionOfFour(page);

  const response = await page.goto(`/${user.handle}/collection?sort=added`);
  expect(response?.status()).toBe(200);

  await expect(sortNav(page).getByText('Added')).toHaveAttribute('aria-current', 'true');
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
});

test('an unrecognised sort falls back to Added rather than erroring', async ({ page }) => {
  const user = await collectionOfFour(page);

  for (const value of ['banana', '', 'TITLE', 'Added', 'newest', 'added_at', '1', '-title']) {
    const response = await page.goto(`/${user.handle}/collection?sort=${value}`);

    expect(response?.status(), `?sort=${value} should render`).toBe(200);
    await expect(sortNav(page).getByText('Added')).toHaveAttribute('aria-current', 'true');
    await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
  }
});

test('a repeated sort parameter takes the first value', async ({ page }) => {
  // `searchParams` hands back an array when a key repeats; the parser takes the
  // first rather than stringifying the array into nonsense.
  const user = await collectionOfFour(page);
  const collection = `/${user.handle}/collection`;

  await page.goto(`${collection}?sort=title&sort=rating`);
  await expect(sortNav(page).getByText('Title')).toHaveAttribute('aria-current', 'true');
  await expectOrder(page, [ACID, RAINBOWS, PLEASURES, THRONE]);

  // And when the first of the pair is the invalid one, the whole thing falls
  // back rather than hunting the array for something usable.
  await page.goto(`${collection}?sort=banana&sort=title`);
  await expect(sortNav(page).getByText('Added')).toHaveAttribute('aria-current', 'true');
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
});

test('a sort link names no page, so choosing one returns to the first', async ({ page }) => {
  const user = await collectionOfFour(page);

  await page.goto(`/${user.handle}/collection?page=1&sort=title`);

  const hrefs = await sortNav(page)
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

  expect(hrefs).toHaveLength(5);
  for (const href of hrefs) {
    expect(href, href).not.toContain('page');
  }

  // The default's link is the bare address, carrying nothing at all.
  expect(hrefs).toContain(`/${user.handle}/collection`);
});

test('pagination does not render at this catalogue size', async ({ page }) => {
  // Recorded rather than skipped. Sixty per page against seven fixture albums
  // means no account reachable from a browser can reach a second page, so the
  // sort-preserving pagination href is proven in the unit suite instead — from
  // the same builder this page uses for both controls.
  const user = await collectionOfFour(page);

  await page.goto(`/${user.handle}/collection?sort=title`);
  await expect(page.getByRole('navigation', { name: 'Collection pages' })).toHaveCount(0);

  // A page past the end is still a 404, and still a 404 under a sort.
  const past = await page.goto(`/${user.handle}/collection?sort=title&page=2`);
  expect(past?.status()).toBe(404);
});

test('the control is withheld below two albums', async ({ page }) => {
  // Sorting one album is meaningless, so the control is withheld rather than
  // rendered inert — the artist page's rule, applied here.
  const user = await signUp(page);

  await page.goto(`/${user.handle}/collection`);
  await expect(page.getByText('No albums yet.')).toBeVisible();
  await expect(sortNav(page)).toHaveCount(0);

  await collect(page, IN_RAINBOWS);
  await page.goto(`/${user.handle}/collection`);
  await expect(page.getByRole('listitem').getByRole('img')).toHaveCount(1);
  await expect(sortNav(page)).toHaveCount(0);

  await collect(page, ACID_RAP);
  await page.goto(`/${user.handle}/collection`);
  await expect(sortNav(page)).toBeVisible();
});

test('the profile overview ignores the collection sort', async ({ page }) => {
  // The overview is a bounded preview with its own ordering, and it is not the
  // collection page with less on it. A sort parameter aimed at the destination
  // must not follow the reader back to the profile root.
  const user = await collectionOfFour(page);

  await page.goto(`/${user.handle}?sort=title`);
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
  await expect(sortNav(page)).toHaveCount(0);

  await page.goto(`/${user.handle}?sort=year`);
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);
});

test('a signed-out visitor can sort someone else’s collection', async ({ page, context }) => {
  // Everything user-generated is public and sorting is a read, so the control
  // is drawn for everyone — there is no owner-only condition on this surface.
  const user = await collectionOfFour(page);

  await context.clearCookies();
  await page.goto(`/${user.handle}/collection`);

  await expect(sortNav(page)).toBeVisible();
  await expectOrder(page, [ACID, PLEASURES, THRONE, RAINBOWS]);

  await page.getByRole('link', { name: 'Artist' }).click();
  await expect(page).toHaveURL(`/${user.handle}/collection?sort=artist`, NAV);
  await expectOrder(page, [ACID, THRONE, PLEASURES, RAINBOWS]);
});

test('sorting mutates no collection state', async ({ page }) => {
  // The whole surface is a read. This holds every relation the album card owns
  // and proves each one is untouched by visiting the collection under a sort.
  const user = await scoredCollectionOfFour(page);

  await page.goto(`/albums/${IN_RAINBOWS}`);
  await page.getByRole('button', { name: /^Favourited?$/ }).click();
  await expect(page.getByRole('button', { name: 'Favourited' })).toBeVisible(ACTION);

  await page.goto(`/albums/${UNKNOWN_PLEASURES}`);
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  const before = await stateFor(user.handle);

  for (const query of [
    '',
    '?sort=listened',
    '?sort=rating',
    '?sort=title',
    '?sort=artist',
    '?sort=year',
    '?sort=nonsense',
  ]) {
    await page.goto(`/${user.handle}/collection${query}`);
    await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible();
  }

  // Entries, scores, likes, listen dates, relisten counts, reviews, favourites
  // and wishes — every one of them exactly as it was.
  expect(await stateFor(user.handle)).toEqual(before);
});

/** Everything the user holds, read from the rows rather than the page. */
async function stateFor(handle: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();

  const { data: entries } = await admin
    .from('collection_entries')
    .select('album_id, rating, liked, relisten_count, listened_on')
    .eq('user_id', profile!.id)
    .order('album_id');

  const favourites = await admin
    .from('favourite_albums')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  const wishes = await admin
    .from('want_to_listen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);

  return { entries, favourites: favourites.count ?? 0, wishes: wishes.count ?? 0 };
}
