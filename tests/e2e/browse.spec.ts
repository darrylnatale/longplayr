import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test } from '@playwright/test';

/**
 * Browse, and the discovery chart that now feeds its Popular section.
 *
 * **This file is new because Browse has never had end-to-end coverage at all.**
 * Its Popular section was a placeholder ranked by the external signal, and on the
 * fixture catalogue — seven albums, none carrying a `popularity_score` — that
 * placeholder rendered nothing, so there was never anything to assert. Changing
 * where Popular's data comes from without any browser-level cover would have been
 * a regression claim with no evidence behind it.
 *
 * **What is provable here, and what deliberately is not.** The seam from
 * `refresh_popular_this_week()` through `getPopularAlbums` to the rendered grid is
 * only provable in a browser, so it is proved here. §8.3's floor of 20 is **not**:
 * the external fill can only offer albums with a `popularity_score`, the fixture
 * catalogue has none, and inventing scores purely to make a count observable would
 * be fabricating fixtures to satisfy a test. The floor is a pure rule and is
 * proved directly in `src/services/discovery/chart.test.ts`.
 *
 * Accounts are deleted afterwards, which cascades to the profile and from there to
 * `collection_entries`. **The chart is cleared explicitly**, because it is a
 * replace-all snapshot with no owner to cascade from and would otherwise leak into
 * whatever spec runs next.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';

const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-brw-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ebrw_${id}`.slice(0, 30),
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

/** Clears the snapshot. Never cascades from anything, so it is cleared by hand. */
async function clearChart(admin: SupabaseClient) {
  await admin.from('discovery_chart_entries').delete().neq('chart', 'nothing-matches-this');
}

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

test('Browse renders with an empty chart, and Recently added carries the catalogue', async ({
  page,
}) => {
  // The pre-slice behaviour, and the state the deployed app is in until the first
  // scheduled refresh: no chart rows, no external scores, so Popular has nothing
  // to show and hides itself. **Recently added applies no such filter** and is
  // what proves the page is alive rather than merely not erroring.
  const admin = adminClient();
  await clearChart(admin);

  await page.goto('/albums');

  await expect(page.getByRole('heading', { name: 'Recently added' })).toBeVisible(NAV);
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: /In Rainbows/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Popular', exact: true })).toHaveCount(0);
});

test('an album with collection activity leads Popular after a refresh', async ({ page }) => {
  // The whole seam, end to end: a collection entry, the refresh function, the
  // service read, the rendered grid. Nothing here touches `albums.popularity_score`
  // and the album carries none, which is the point — an album no external source
  // has heard of now reaches Browse.
  const admin = adminClient();
  await clearChart(admin);

  const user = uniqueUser();
  createdEmails.push(user.email);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const id = created.user!.id;
  const { error: profileError } = await admin.from('profiles').insert({ id, handle: user.handle });
  if (profileError) throw profileError;

  const { data: album } = await admin
    .from('albums')
    .select('id, popularity_score')
    .eq('mbid', IN_RAINBOWS)
    .single();
  if (!album) throw new Error('fixture catalogue is not seeded — run npm run db:seed:fixtures');
  expect(album.popularity_score).toBeNull();

  const { error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: id, album_id: album.id });
  if (entryError) throw entryError;

  const { data: written, error: refreshError } = await admin.rpc('refresh_popular_this_week');
  if (refreshError) throw refreshError;
  expect(written).toBe(1);

  await page.goto('/albums');

  const popular = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Popular', exact: true }),
  });

  await expect(popular).toBeVisible(NAV);
  await expect(popular.getByRole('link', { name: /In Rainbows/ }).first()).toBeVisible();
});

/**
 * Artist links from a grid caption (`product-spec.md` §6, *Reaching an artist
 * from a credit*).
 *
 * **This is the surface the entry actually complained about.** Before this,
 * reaching an artist meant opening one of their albums first and clicking
 * through from there — the credit under a cover was dead text. The assertion
 * that matters is the navigation, not the markup, which is why it clicks.
 */
test('a credit under a cover reaches the artist page', async ({ page }) => {
  await page.goto('/albums');

  const recent = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Recently added' }),
  });
  await expect(recent).toBeVisible(NAV);

  // Radiohead rather than a collaboration: one artist, one link, no ambiguity
  // about which of them the click resolves to.
  await recent.getByRole('link', { name: 'Radiohead', exact: true }).first().click();

  await expect(page).toHaveURL(/\/artists\//, NAV);
  await expect(page.getByRole('heading', { name: 'Radiohead' }).first()).toBeVisible();

  // And having arrived, the credit is suppressed on that artist's own page:
  // printing "Radiohead" under every Radiohead album is noise. This is the
  // identity comparison, not the old string one — `product-spec.md` §6.
  const discography = page.getByRole('main');
  await expect(discography.getByRole('link', { name: 'In Rainbows' }).first()).toBeVisible();
  await expect(discography.getByRole('link', { name: 'Radiohead', exact: true })).toHaveCount(0);
});

test('a collaboration credits both artists, and each is its own link', async ({ page }) => {
  // The case that carries the cost recorded in `product-spec.md` §6: the caption
  // renders canonical names from `album_artists` rather than the as-released
  // `display_credit`, so this asserts the *joined* rendering deliberately.
  await page.goto('/albums');

  const recent = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Recently added' }),
  });
  await expect(recent).toBeVisible(NAV);

  await expect(recent.getByRole('link', { name: 'JAY-Z', exact: true }).first()).toBeVisible();
  await expect(recent.getByRole('link', { name: 'Kanye West', exact: true }).first()).toBeVisible();
});

test('a Various Artists credit is named but is not a link', async ({ page }) => {
  // A pseudo-artist is printed and not linked. Dropping it would leave a
  // compilation credited to nobody; linking it would point many tiles at one
  // page and sit adjacent to an open question about depth.
  await page.goto('/albums');

  const recent = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Recently added' }),
  });
  await expect(recent).toBeVisible(NAV);

  await expect(recent.getByText('Various Artists').first()).toBeVisible();
  await expect(recent.getByRole('link', { name: 'Various Artists', exact: true })).toHaveCount(0);
});

/**
 * Hiding what you already hold — F-042, `architecture.md` §16.13.
 *
 * **This layer is the only one that can prove it.** `getCatalogueAlbums` builds
 * a cookie-bound client and cannot be called without a request scope, which is
 * why no integration test reaches it. The anti-join itself was verified against
 * a running PostgREST — 4 of 7 with `Content-Range: 0-0/4` — and what remains
 * to prove is that the parameter reaches the query and survives the controls.
 *
 * **The negative case is the one that would be missed.** A toggle rendered for
 * everybody would satisfy the positive assertion alone, and this is the first
 * control on a catalogue surface that depends on who is reading.
 */
test('a signed-in reader can hide the albums they already have', async ({ page }) => {
  const admin = adminClient();
  const user = uniqueUser();
  createdEmails.push(user.email);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (createError) throw createError;
  const id = created.user!.id;
  const { error: profileError } = await admin.from('profiles').insert({ id, handle: user.handle });
  if (profileError) throw profileError;

  // Hold exactly one fixture album, so the count must drop by exactly one.
  const { data: album } = await admin
    .from('albums')
    .select('id, title')
    .eq('mbid', IN_RAINBOWS)
    .single();
  if (!album) throw new Error('fixture catalogue is not seeded — run npm run db:seed:fixtures');
  const { error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: id, album_id: album.id });
  if (entryError) throw entryError;

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);

  await page.goto('/albums/all');
  await expect(page.getByRole('link', { name: album.title })).toBeVisible(NAV);

  await page.getByRole('link', { name: 'Hide albums I already have' }).click();

  // **The held album is gone, and the heading says what it is now counting.**
  await expect(page).toHaveURL('/albums/all?mine=hide', NAV);
  await expect(page.getByText('you have not added')).toBeVisible();
  await expect(page.getByRole('link', { name: album.title })).toHaveCount(0);

  // **The filter survives a sort**, which is the assertion most likely to break
  // later: changing sort resets the page but must not reset the filter.
  await page.getByRole('link', { name: 'Title', exact: true }).click();
  await expect(page).toHaveURL(/mine=hide/, NAV);
  await expect(page.getByRole('link', { name: album.title })).toHaveCount(0);

  // And it can be turned off again.
  await page.getByRole('link', { name: 'Show everything' }).click();
  await expect(page.getByRole('link', { name: album.title })).toBeVisible(NAV);
});

test('a signed-out visitor is offered no personal filter', async ({ page }) => {
  // Browse is public and identical for everyone by default — the control is
  // not rendered at all rather than rendered disabled. §16.13.
  await page.goto('/albums/all');
  await expect(page.getByRole('heading', { name: 'All albums' })).toBeVisible(NAV);
  await expect(page.getByText('Hide albums I already have')).toHaveCount(0);
  await expect(page.getByText('in the catalogue')).toBeVisible();
});
