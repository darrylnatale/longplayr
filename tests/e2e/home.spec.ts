import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { albumUrl } from './urls';

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
  await page.getByLabel('Password', { exact: true }).fill(account.password);
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
  const href = (index: number) => albumUrl(chosen[index].mbid as string);
  return Promise.all([href(3), href(2), href(1), href(0)]);
}

/** The discovery section on the home page. */
/**
 * Home's discovery section.
 *
 * **It matches `Recently added`, not `Popular this week`, since
 * `design-reference.md` §11.11.** Home leads with what Browse leads with, and
 * Browse no longer leads with the chart — its internal chart held 7 rows against
 * a limit of 24, so that section was mostly external popularity fill.
 */
const homeSection = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recently added' }) });

/** Browse's lead section, matched on its own heading. */
const browseSection = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recently added' }) });

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
  // **Asserted against the heading the page actually renders.** This read
  // `Popular this week` until 2026-09-13, which after §11.11 is a heading no
  // condition produces — so the case passed without testing the gate.
  await expect(page.getByRole('heading', { name: 'Recently added' })).toHaveCount(0);
  await expect(page.locator('a[href^="/albums/"]')).toHaveCount(0);
});

test('the pitch stands on its own, and the empty-section gate is no longer reachable here', async ({
  page,
}) => {
  const admin = adminClient();
  await clearChart(admin);

  await page.goto('/');

  /*
   * **What this case can still establish**, and it is less than its previous
   * version claimed. Home read the chart until 2026-09-13; clearing the chart
   * emptied it, and the gate `albums.length > 0` was observable. Home now reads
   * `getRecentAlbums`, so **clearing the chart changes nothing about it** and the
   * fixture catalogue is never empty.
   *
   * **The gate is still correct and is now unreachable from this suite** — it
   * fires only on a catalogue with no albums at all, which is a fresh
   * deployment. Emptying the catalogue here would strand every later spec in the
   * run, since the suite shares one database at `workers: 1`.
   *
   * So this asserts the half that survives: the pitch and its call to action
   * stand alongside the section rather than being displaced by it. **Coverage of
   * the empty-section gate is lost and recorded as lost rather than implied.**
   */
  await expect(
    page.getByRole('heading', { name: 'Keep a record of what you listen to.' }),
  ).toBeVisible(NAV);
  await expect(page.getByRole('link', { name: 'Create account' }).first()).toBeVisible();
  await expect(homeSection(page)).toBeVisible();
});

test('Home shows the leading part of Browse’s lead section, in the same order', async ({
  page,
}) => {
  /*
   * Home passes twelve and Browse twenty-four against the same query, and that
   * both resolve to the same ordered albums is the property under test — only
   * observable across two rendered pages.
   *
   * **The chart-ranking assertion this case used to carry is gone, deliberately.**
   * It pinned that `refresh_popular_this_week()`'s distinct-user ordering
   * survived to the page, which was right while Home read the chart. Home now
   * reads Recently added, so asserting the chart's ranking here would be
   * asserting something this page no longer displays. **That coverage moves
   * nowhere and is recorded as dropped** — `browse.spec.ts` still covers the
   * chart's ordering on the surface that renders it.
   */
  await page.goto('/');
  const home = await albumHrefs(homeSection(page));

  await page.goto('/albums');
  const browse = await albumHrefs(browseSection(page));

  expect(home.length).toBeGreaterThan(1);
  expect(browse.length).toBeGreaterThanOrEqual(home.length);
  expect(home).toEqual(browse.slice(0, home.length));
});
