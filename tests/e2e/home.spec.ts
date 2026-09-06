import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * The home page's discovery section — Phase 5 slice 3.
 *
 * **This is the only layer that can prove the slice.** The page is an async
 * server component whose composition depends on session and profile presence,
 * the repository has no component-test precedent at all — there is not a single
 * `.test.tsx` in it — and the service and SQL underneath are unchanged and
 * already covered by `tests/integration/discovery-chart.test.ts`. So the
 * acceptance behaviour lives here, in a browser, or nowhere.
 *
 * **The ordering test is the one that earns its place.** Home and Browse pass
 * different caller limits — twelve and twenty-four — into the same
 * `getPopularAlbums`, and those limits produce different internal read depths.
 * That the two still yield the same albums in the same order is a property of
 * the floor-versus-limit separation rather than an obvious consequence of it,
 * and comparing the two rendered pages is the only place it can be observed
 * end to end.
 *
 * **What deliberately is not proved here.** The twelve-item cap never binds: the
 * fixture catalogue holds seven albums, so a fully populated chart is seven.
 * Manufacturing more fixtures to make a number visible would be fabricating
 * fixtures to satisfy a test. The cap's mechanism is covered by the unit tests
 * in `src/services/discovery/chart.test.ts`, and that Home passes twelve rather
 * than some other number is verified by inspection.
 *
 * Accounts are deleted afterwards, which cascades to the profile and from there
 * to `collection_entries`. **The chart is cleared explicitly**, because it is a
 * replace-all snapshot with no owner to cascade from.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-home-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ehome_${id}`.slice(0, 30),
  };
}

type Account = { id: string; email: string; password: string; handle: string };

const createdEmails: string[] = [];
const createdUserIds: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Creates an auth user, with a profile only when asked for one. */
async function createAccount(admin: SupabaseClient, withProfile = true): Promise<Account> {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  if (withProfile) {
    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id, handle: user.handle });
    if (profileError) throw profileError;
  }

  return { id, ...user };
}

/** The established sign-in path: an API-created user through the real form. */
async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);
}

/** The snapshot never cascades from anything, so it is cleared by hand. */
async function clearChart(admin: SupabaseClient) {
  await admin.from('discovery_chart_entries').delete().neq('chart', 'nothing-matches-this');
}

/** Removes this file's collection entries so counts never accumulate across tests. */
async function clearEntries(admin: SupabaseClient) {
  if (createdUserIds.length === 0) return;
  await admin.from('collection_entries').delete().in('user_id', createdUserIds);
}

/**
 * Builds a chart with a deliberate, unambiguous order.
 *
 * **The counts run against the catalogue's own order deliberately.** Albums are
 * selected by `mbid` and the qualifying users are assigned in reverse, so the
 * album ranked first is the one an implementation ordering by identifier would
 * put last. Without that inversion the test could not tell distinct-user ranking
 * from `mbid` ranking, because the two would agree.
 *
 * Returns the expected album hrefs in rank order.
 */
async function seedRankedChart(admin: SupabaseClient): Promise<string[]> {
  const { data: albums, error } = await admin.from('albums').select('id, mbid').order('mbid');
  if (error) throw error;
  if (!albums || albums.length < 4) {
    throw new Error('fixture catalogue is not seeded — run npm run db:seed:fixtures');
  }

  const [one, two, three] = await Promise.all([
    createAccount(admin),
    createAccount(admin),
    createAccount(admin),
  ]);

  const chosen = albums.slice(0, 4);
  const ids = chosen.map((album) => album.id as string);
  const entries: { user_id: string; album_id: string }[] = [
    { user_id: one.id, album_id: ids[3] },
    { user_id: two.id, album_id: ids[3] },
    { user_id: three.id, album_id: ids[3] },
    { user_id: one.id, album_id: ids[2] },
    { user_id: two.id, album_id: ids[2] },
    { user_id: one.id, album_id: ids[1] },
    { user_id: one.id, album_id: ids[0] },
  ];

  const { error: entryError } = await admin.from('collection_entries').insert(entries);
  if (entryError) throw entryError;

  const { data: written, error: refreshError } = await admin.rpc('refresh_popular_this_week');
  if (refreshError) throw refreshError;
  expect(written).toBe(4);

  // Ranked order: three qualifying users, then two, then the two singles in
  // whatever order the `album_id` tiebreak settles — which is why only the
  // leading pair is asserted against this.
  const href = (index: number) => `/albums/${chosen[index].mbid as string}`;
  return [href(3), href(2), href(1), href(0)];
}

/** The discovery section on the home page. */
const homeSection = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Popular this week' }) });

/** Browse's Popular section, matched on its own exact heading. */
const browseSection = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Popular', exact: true }) });

/**
 * The album links in a section, in DOM order.
 *
 * `a[href^="/albums/"]` matches the tiles and not the onward "Browse the
 * catalogue" link, whose href is `/albums` with no trailing segment.
 */
const albumHrefs = (section: ReturnType<typeof homeSection>) =>
  section
    .locator('a[href^="/albums/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

test.beforeEach(async () => {
  const admin = adminClient();
  await clearChart(admin);
  await clearEntries(admin);
});

test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const admin = adminClient();
  await clearChart(admin);

  if (createdEmails.length === 0) return;
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (user.email && createdEmails.includes(user.email)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

test('a signed-out visitor sees the discovery section and can reach the catalogue', async ({
  page,
}) => {
  const admin = adminClient();
  await seedRankedChart(admin);

  await page.goto('/');

  const section = homeSection(page);
  await expect(section).toBeVisible(NAV);
  expect((await albumHrefs(section)).length).toBeGreaterThan(0);

  // **Arrival, not link presence.** A route that renders and does not travel is
  // the defect the notifications and sign-out cycles repaired elsewhere.
  await section.getByRole('link', { name: 'Browse the catalogue' }).click();
  await expect(page).toHaveURL('/albums', NAV);
});

test('a signed-in user with a profile sees the same discovery section', async ({ page }) => {
  const admin = adminClient();
  await seedRankedChart(admin);

  const account = await createAccount(admin);
  await signIn(page, account);

  await page.goto('/');

  const section = homeSection(page);
  await expect(section).toBeVisible(NAV);
  expect((await albumHrefs(section)).length).toBeGreaterThan(0);
});

test('a signed-in user without a profile is asked for a handle and sees no discovery', async ({
  page,
}) => {
  // The chart is populated first, so an absent section is the gate working
  // rather than there being nothing to show.
  const admin = adminClient();
  await seedRankedChart(admin);

  const account = await createAccount(admin, false);
  await signIn(page, account);

  await page.goto('/');

  await expect(page.getByText('Your account needs a handle')).toBeVisible(NAV);
  await expect(page.getByRole('link', { name: 'Choose a handle' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Popular this week' })).toHaveCount(0);
});

test('an empty Popular result renders no section at all, and the rest of the page stands', async ({
  page,
}) => {
  const admin = adminClient();
  await clearChart(admin);

  // The fallback has nothing to offer either: the fixture catalogue carries no
  // external popularity score. Asserted rather than assumed, because the whole
  // test depends on it.
  const { count } = await admin
    .from('albums')
    .select('id', { count: 'exact', head: true })
    .not('popularity_score', 'is', null);
  expect(count).toBe(0);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Popular this week' })).toHaveCount(0);
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Keep a record of what you listen to.' }),
  ).toBeVisible(NAV);
  await expect(page.getByRole('link', { name: 'Create account' }).first()).toBeVisible();
});

test('Home shows the leading part of Browse’s Popular, in the same order', async ({ page }) => {
  // Home passes twelve and Browse twenty-four, which give different internal
  // read depths. That both still resolve to the same ordered albums is the
  // property under test, and it is only observable across two rendered pages.
  const admin = adminClient();
  const expected = await seedRankedChart(admin);

  await page.goto('/');
  const home = await albumHrefs(homeSection(page));

  await page.goto('/albums');
  const browse = await albumHrefs(browseSection(page));

  expect(home.length).toBeGreaterThan(1);
  expect(browse.length).toBeGreaterThanOrEqual(home.length);
  expect(home).toEqual(browse.slice(0, home.length));

  // The leading two positions are decided by distinct-user counts rather than by
  // the album_id tiebreak, so asserting them pins that the chart's own ranking
  // survives the round trip to the page rather than merely that both pages agree
  // with each other.
  expect(home.slice(0, 2)).toEqual(expected.slice(0, 2));
});
