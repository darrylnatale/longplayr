import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { albumUrl } from './urls';

/**
 * The optional listen date on Add to Collection.
 *
 * The date is behind a disclosure and is optional, so the two things worth
 * proving in a browser are that **the path without it is unchanged** and that
 * **the path with it reaches the database intact**. Neither is visible to an
 * integration test: the date only becomes a date at the form boundary, and the
 * disclosure is the part a user actually meets.
 *
 * `listened_on` is never rendered — profiles and collections display no dates,
 * by decision — so persistence is confirmed against the row rather than the
 * page. That is deliberate rather than a gap: there is nowhere for it to show.
 *
 * Albums come from the local fixture catalogue (`npm run db:seed:fixtures`) and
 * are never modified. Accounts are deleted afterwards, which cascades to every
 * user-authored row.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';
const WATCH_THE_THRONE = '0b0e4f1e-1111-4000-8000-000000000002';
const ACID_RAP = '0b0e4f1e-1111-4000-8000-000000000004';

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-lo-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2elo_${id}`.slice(0, 30),
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

const disclosure = (page: Page) =>
  page.getByRole('button', { name: /^Add (with a listen date…|without a date)$/ });
const dateField = (page: Page) => page.getByLabel('Listened on');

/** The stored row — `listened_on` is never rendered, so this is where it is checked. */
async function entryFor(handle: string, mbid: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const { data: album } = await admin.from('albums').select('id').eq('mbid', mbid).single();
  const { data } = await admin
    .from('collection_entries')
    .select('listened_on, added_at')
    .eq('user_id', profile!.id)
    .eq('album_id', album!.id)
    .maybeSingle();
  return data;
}

async function wishCount(handle: string) {
  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('handle', handle).single();
  const { count } = await admin
    .from('want_to_listen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile!.id);
  return count ?? 0;
}

test('adding without a date behaves exactly as before', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  // The date is not in the way: one click still collects.
  await expect(dateField(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  const entry = await entryFor(user.handle, IN_RAINBOWS);
  expect(entry!.listened_on).toBeNull();
  expect(entry!.added_at).toBeTruthy();
});

test('a supplied date persists, and survives a reload', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await disclosure(page).click();
  await expect(dateField(page)).toBeVisible();
  await dateField(page).fill('2026-08-14');
  await page.getByRole('button', { name: 'Add to collection' }).click();

  await expect(page.getByText('In your collection')).toBeVisible(ACTION);
  expect((await entryFor(user.handle, IN_RAINBOWS))!.listened_on).toBe('2026-08-14');

  // Collected state survives, and the date is not re-rendered or re-submitted.
  await page.reload();
  await expect(page.getByText('In your collection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to collection' })).toHaveCount(0);
  expect((await entryFor(user.handle, IN_RAINBOWS))!.listened_on).toBe('2026-08-14');
});

test('a date backdated by decades persists, and does not move added_at', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(WATCH_THE_THRONE));

  await disclosure(page).click();
  await dateField(page).fill('1997-05-21');
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  const entry = await entryFor(user.handle, WATCH_THE_THRONE);
  expect(entry!.listened_on).toBe('1997-05-21');
  // Added now, listened in 1997 — the separation the two columns exist for.
  expect(new Date(entry!.added_at).getUTCFullYear()).toBeGreaterThan(2020);
});

test('the disclosure can be dismissed, and then no date is sent', async ({ page }) => {
  // Closing unmounts the field, so a date typed and then dismissed is not
  // submitted — the intended reading of "add without a date".
  const user = await signUp(page);
  await page.goto(await albumUrl(ACID_RAP));

  await disclosure(page).click();
  await dateField(page).fill('2001-01-01');
  await disclosure(page).click();
  await expect(dateField(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  expect((await entryFor(user.handle, ACID_RAP))!.listened_on).toBeNull();
});

test('adding a wanted album with a date collects it and clears the wish', async ({ page }) => {
  // The single sanctioned path still owns the clearing rule: the date rides
  // along with it rather than routing around it.
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await page.getByRole('button', { name: 'Want to listen' }).click();
  await expect(page.getByRole('button', { name: 'On your list' })).toBeVisible(ACTION);
  expect(await wishCount(user.handle)).toBe(1);

  await disclosure(page).click();
  await dateField(page).fill('2019-11-02');
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  expect((await entryFor(user.handle, IN_RAINBOWS))!.listened_on).toBe('2019-11-02');
  expect(await wishCount(user.handle)).toBe(0);
  await expect(page.getByRole('button', { name: 'Want to listen' })).toBeVisible();
});

test('a collected album offers no date input', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(IN_RAINBOWS));

  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  // Add is gone, so its disclosure and field go with it.
  await expect(page.getByRole('button', { name: 'Add to collection' })).toHaveCount(0);
  await expect(disclosure(page)).toHaveCount(0);
  await expect(dateField(page)).toHaveCount(0);

  // And the same holds once rated. A collected-but-unrated album offers
  // "Rate this album"; "Change score" only appears once there is one.
  await page.getByRole('button', { name: 'Rate this album' }).click();
  await page.getByLabel('Your score').fill('7.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText('7.5', ACTION);

  await expect(disclosure(page)).toHaveCount(0);
  await expect(dateField(page)).toHaveCount(0);
  expect((await entryFor(user.handle, IN_RAINBOWS))!.listened_on).toBeNull();
});

test('the date field is reachable and operable from the keyboard', async ({ page }) => {
  const user = await signUp(page);
  await page.goto(await albumUrl(ACID_RAP));

  // The disclosure is a real button: it takes focus and responds to Enter.
  await disclosure(page).focus();
  await expect(disclosure(page)).toBeFocused();
  await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');

  await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'true');
  // Focus lands on the field, so a keyboard user is not left hunting for it.
  await expect(dateField(page)).toBeFocused();

  // The value is set with `fill` rather than keystrokes: a native date input is
  // a segmented widget, and headless Chromium accepts no typed digits into it
  // at all — `keyboard.type` leaves the value empty in either order. That is a
  // harness limitation rather than a product one, and asserting around it would
  // be testing the browser's date widget instead of this card.
  await dateField(page).fill('2015-06-30');
  await page.getByRole('button', { name: 'Add to collection' }).click();
  await expect(page.getByText('In your collection')).toBeVisible(ACTION);

  expect((await entryFor(user.handle, ACID_RAP))!.listened_on).toBe('2015-06-30');
});
