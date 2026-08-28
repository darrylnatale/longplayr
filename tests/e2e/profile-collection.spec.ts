import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
 * **The collection renders artwork plus a minimal state line** — score, like
 * and `×N` — and no captions (`design-reference.md` §11.9). Both halves of that
 * are asserted here: the markers appear, and the title and credit do not.
 *
 * **Two limits are not exercised end to end.** The overview previews 12 and the
 * destination pages at 60, and the local fixture catalogue holds seven albums,
 * so no account reachable from here can exceed either bound. The windowing is
 * covered at the query level in `tests/integration/collection-list.test.ts`;
 * what this file can and does assert is the behaviour at the small end — the
 * count staying plain text, pagination not rendering, and a page past the end
 * being a 404.
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

test('artwork carries a state line, and never a caption', async ({ page }) => {
  const user = await signUp(page);

  await rate(page, WATCH_THE_THRONE, '8.5');

  await page.goto(`/albums/${IN_RAINBOWS}`);
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liked' })).toBeVisible(ACTION);

  // Two relistens, so this tile shows ×2.
  await page.goto(`/albums/${UNKNOWN_PLEASURES}`);
  await page.getByRole('button', { name: 'Relisten', exact: true }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);
  await page.getByRole('button', { name: /Relisten/ }).click();
  await expect(page.getByText('×2')).toBeVisible(ACTION);

  await page.goto(`/${user.handle}`);

  // The state each album carries, on its own tile and no other.
  await expect(tileFor(page, 'Watch the Throne')).toContainText('8.5');
  await expect(tileFor(page, 'In Rainbows')).toContainText('Liked.');
  await expect(tileFor(page, 'Unknown Pleasures')).toContainText('×2');

  await expect(tileFor(page, 'In Rainbows')).not.toContainText('8.5');
  await expect(tileFor(page, 'Watch the Throne')).not.toContainText('Liked.');
  await expect(tileFor(page, 'Watch the Throne')).not.toContainText('×2');

  // No captions. The credit is the giveaway: a title can coincide with other
  // copy on the page, an artist credit cannot.
  await expect(page.getByText('Radiohead')).toBeHidden();
  await expect(page.getByText('Jay-Z & Kanye West')).toBeHidden();
  await expect(page.getByText('Joy Division')).toBeHidden();
});

test('a relisten count of one is not drawn', async ({ page }) => {
  // ×1 is noise: an entry is not itself a relisten, so the marker only earns
  // its place above one. The fixture profile leans on this too.
  const user = await signUp(page);

  await page.goto(`/albums/${IN_RAINBOWS}`);
  await page.getByRole('button', { name: 'Relisten', exact: true }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  await page.goto(`/${user.handle}`);

  await expect(tileFor(page, 'In Rainbows')).toBeVisible();
  await expect(page.getByText('×1')).toBeHidden();
});

test('a score of 0.0 is drawn as a score, not as unrated', async ({ page }) => {
  // The lowest score in the product is falsy, and every plausible shortcut in
  // the mapping turns it into "never rated".
  const user = await signUp(page);

  await rate(page, IN_RAINBOWS, '0.0');
  await page.goto(`/${user.handle}`);

  await expect(tileFor(page, 'In Rainbows')).toContainText('0.0');
});

test('a tile links through to the album page, from both surfaces', async ({ page }) => {
  // The grid was a dead end: `CollectionTile` carried no link at all, where
  // `AlbumGrid` wraps every cell in one — so albums were reachable from the
  // artist page and Browse but not from the two surfaces where someone looks
  // at their own collection.
  const user = await signUp(page);
  await collect(page, IN_RAINBOWS);

  await page.goto(`/${user.handle}`);
  await tileFor(page, 'In Rainbows').getByRole('link').click();
  await expect(page).toHaveURL(`/albums/${IN_RAINBOWS}`, NAV);

  // The destination renders the same grid, so it needs its own assertion
  // rather than inheriting one.
  await page.goto(`/${user.handle}/collection`);
  await tileFor(page, 'In Rainbows').getByRole('link').click();
  await expect(page).toHaveURL(`/albums/${IN_RAINBOWS}`, NAV);
});

test('an album with no state draws no line at all', async ({ page }) => {
  const user = await signUp(page);

  await collect(page, IN_RAINBOWS);
  await page.goto(`/${user.handle}`);

  const tile = tileFor(page, 'In Rainbows');
  await expect(tile).toBeVisible();
  // Nothing but the cover: no score, no heart, no marker, and no reserved row.
  await expect(tile.locator('p')).toHaveCount(0);
});

test('the count does not link when the overview already shows everything', async ({ page }) => {
  // Seven fixture albums is under the preview limit, so the destination would
  // show exactly the same covers. An affordance that promises more and delivers
  // the same thing is worse than no affordance.
  const user = await signUp(page);

  await collect(page, IN_RAINBOWS);
  await collect(page, WATCH_THE_THRONE);

  await page.goto(`/${user.handle}`);

  await expect(page.getByText('2 albums')).toBeVisible();
  await expect(page.getByRole('link', { name: /2 albums/ })).toHaveCount(0);
});

test('the collection destination renders, and matches the profile count', async ({ page }) => {
  const user = await signUp(page);

  await rate(page, WATCH_THE_THRONE, '9.1');
  await collect(page, IN_RAINBOWS);

  // Reachable directly, whether or not the overview linked to it.
  await page.goto(`/${user.handle}/collection`);

  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible();
  await expect(page.getByText('2 albums')).toBeVisible();
  await expect(tileFor(page, 'Watch the Throne')).toContainText('9.1');
  await expect(tileFor(page, 'In Rainbows')).toBeVisible();

  // The identity strip names the owner and leads back to the overview.
  await page
    .getByRole('link', { name: new RegExp(user.handle) })
    .first()
    .click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);
});

test('pagination is absent on a single page, and a page past the end 404s', async ({ page }) => {
  const user = await signUp(page);
  await collect(page, IN_RAINBOWS);

  await page.goto(`/${user.handle}/collection`);
  // One page of results needs no navigation; "Page 1 of 1" is furniture.
  await expect(page.getByRole('navigation', { name: 'Collection pages' })).toHaveCount(0);

  // Garbage resolves to the first page rather than erroring.
  await page.goto(`/${user.handle}/collection?page=not-a-number`);
  await expect(tileFor(page, 'In Rainbows')).toBeVisible();

  await page.goto(`/${user.handle}/collection?page=0`);
  await expect(tileFor(page, 'In Rainbows')).toBeVisible();

  // A page that does not exist is a 404 rather than a silent clamp.
  const past = await page.goto(`/${user.handle}/collection?page=2`);
  expect(past?.status()).toBe(404);
});

test('an empty collection has its own destination state', async ({ page }) => {
  const user = await signUp(page);

  await page.goto(`/${user.handle}/collection`);

  await expect(page.getByText('No albums yet.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Collection pages' })).toHaveCount(0);
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

/**
 * Admin-side setup for the cross-user isolation test below.
 *
 * **Why only that test.** It is the slowest in the suite — three signups across
 * three browser contexts, plus three collection mutations, all through the UI —
 * and none of that is what it asserts. Its subject is what each profile
 * *renders*, and that one user's albums never appear on another's. Signup is
 * asserted as a subject in `auth.spec.ts`; adding and rating in
 * `collection.spec.ts`. The other eleven tests in this file are well inside
 * their budget and are deliberately left driving the UI.
 *
 * **Entries go through `ensure_collection_entry`**, the same RPC the server
 * action calls (`src/services/collection/index.ts`). That function owns the
 * Want to Listen clearing rule and is documented as the single path by which an
 * entry comes to exist, so raw inserts would build a state the product cannot
 * produce. Rating an uncollected album creates the entry first, exactly as the
 * implicit-collection rule does in the UI.
 *
 * **The service-role key never leaves this Node process.** It is not passed to
 * `page.evaluate` or into any browser context.
 */
function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type ApiUser = { email: string; password: string; handle: string; id: string };

async function createUserViaApi(admin: SupabaseClient): Promise<ApiUser> {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user.id, handle: user.handle });
  if (profileError) throw profileError;

  return { ...user, id: data.user.id };
}

async function albumIdFor(admin: SupabaseClient, mbid: string): Promise<string> {
  const { data, error } = await admin.from('albums').select('id').eq('mbid', mbid).single();
  if (error) throw error;
  return data.id as string;
}

async function collectViaApi(admin: SupabaseClient, userId: string, mbid: string) {
  const { error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: await albumIdFor(admin, mbid),
    p_listened_on: null,
  });
  if (error) throw error;
}

/** Rating an uncollected album collects it first, as the UI's implicit add does. */
async function rateViaApi(admin: SupabaseClient, userId: string, mbid: string, rating: number) {
  const albumId = await albumIdFor(admin, mbid);
  const { error: rpcError } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
    p_listened_on: null,
  });
  if (rpcError) throw rpcError;

  const { error } = await admin
    .from('collection_entries')
    .update({ rating })
    .eq('user_id', userId)
    .eq('album_id', albumId);
  if (error) throw error;
}

/**
 * Proves the fixture actually built what the test assumes.
 *
 * **Not ceremony.** The UI helpers this replaces verified themselves for free —
 * every `collect` waited on "In your collection", every `rate` on the score
 * appearing — so a setup that silently did nothing could never reach the test
 * body. Writing rows through the API buys speed and loses exactly that. In the
 * `collection-sort` pilot a fixture that created nothing left the test passing,
 * because it compared an empty state to an empty state.
 *
 * Ordered by `added_at`, which is strictly increasing because the writes above
 * are sequential and awaited. Ordering by a nullable column such as `rating`
 * has no tiebreaker and is not stable.
 */
async function expectEntries(
  admin: SupabaseClient,
  userId: string,
  expected: { mbid: string; rating: number | null }[],
) {
  const { data, error } = await admin
    .from('collection_entries')
    .select('rating, albums(mbid)')
    .eq('user_id', userId)
    .order('added_at', { ascending: true });
  if (error) throw error;

  expect(
    (data ?? []).map((row) => ({
      mbid: (row.albums as unknown as { mbid: string }).mbid,
      rating: row.rating,
    })),
  ).toEqual(expected);
}

/** Signs an existing user in through the real login form. */
async function signIn(page: Page, user: ApiUser) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);
}

test('one user’s collection never appears on another user’s profile', async ({ page, browser }) => {
  // Both users hold the *same* album, which is the case a query missing its
  // user_id filter would render identically for both. Nothing here is private
  // — everything user-generated is public — so the claim is that each profile
  // shows its own owner's albums, not that anything is hidden from anyone.
  //
  // Per-marker isolation is asserted in the integration suite, which can see
  // the scores this surface does not draw.
  const admin = adminClient();

  const first = await createUserViaApi(admin);
  await rateViaApi(admin, first.id, IN_RAINBOWS, 9.6);
  await expectEntries(admin, first.id, [{ mbid: IN_RAINBOWS, rating: 9.6 }]);
  await signIn(page, first);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const second = await createUserViaApi(admin);
  await rateViaApi(admin, second.id, IN_RAINBOWS, 1.2);
  await collectViaApi(admin, second.id, UNKNOWN_PLEASURES);
  await expectEntries(admin, second.id, [
    { mbid: IN_RAINBOWS, rating: 1.2 },
    { mbid: UNKNOWN_PLEASURES, rating: null },
  ]);
  await signIn(secondPage, second);

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
  const thirdContext = await browser.newContext();
  const thirdPage = await thirdContext.newPage();
  const third = await createUserViaApi(admin);
  await expectEntries(admin, third.id, []);
  // Signed in through the real form so this context holds a genuine session,
  // as it did when it was created by a UI signup. Nothing is asserted from
  // `thirdPage`: the third user exists to be *viewed* by the first, and the
  // context is retained rather than removed because dropping it would change
  // the shape of the test rather than its setup.
  await signIn(thirdPage, third);

  await page.goto(`/${third.handle}`);
  await expect(page.getByText(`${third.handle} hasn’t added any albums yet.`)).toBeVisible();
  await expect(page.getByText('Your collection is empty.')).toBeHidden();

  // Closed explicitly. An unclosed context left the browser to collect it
  // mid-run, which surfaced as "session closed" in whichever test happened to
  // be executing rather than in the one that leaked it.
  await thirdContext.close();
  await secondContext.close();
});
