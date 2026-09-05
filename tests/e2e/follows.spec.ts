import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Following and unfollowing, from a profile.
 *
 * **Both accounts are built through the API; the subject then signs in through
 * the real login form.** A follow needs two people, and only one of them is the
 * subject of any assertion here — the second exists to be followed and to own a
 * profile page. Building either through the UI would spend the slowest
 * operation in the suite on a fixture, which is exactly the cost
 * `architecture.md` §12 records as avoidable. Signup itself is asserted as a
 * subject in `auth.spec.ts`.
 *
 * **The toggle cycles in both directions rather than asserting one
 * transition.** The like and favourite controls have both shipped stale-state
 * bugs that every integration test passed through, because the surrounding
 * subtree did not change. A follow button is the same shape: the profile it
 * sits on is identical either way, and only the control's own state moves.
 *
 * **No block coverage.** Blocking is a Phase 6 feature and does not exist.
 *
 * Accounts are cleaned up afterwards. Deleting the auth user cascades to the
 * profile and from there to `follows`, in both directions — the same cascade
 * account deletion relies on.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const NAV = { timeout: 15_000 };
const ACTION = { timeout: 30_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-fw-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2efw_${id}`.slice(0, 30),
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

/**
 * A second account, built through the API.
 *
 * **It asserts its own postconditions.** An API fixture that silently wrote
 * nothing would leave the tests below comparing an empty profile to an empty
 * profile and passing — the exact vacuity `architecture.md` §12 records from the
 * first fixture conversion.
 */
async function createAccount(displayName?: string) {
  const user = uniqueUser();
  createdEmails.push(user.email);

  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user!.id, handle: user.handle, display_name: displayName ?? null });
  if (profileError) throw profileError;

  const { data: written } = await admin
    .from('profiles')
    .select('id, handle')
    .eq('id', data.user!.id)
    .single();
  expect(written?.handle).toBe(user.handle);

  return { ...user, id: data.user!.id };
}

/**
 * Signs an existing user in through the real login form.
 *
 * Copied from `profile-collection.spec.ts` rather than extracted, so the two
 * files stay recognisably the same. The parameter is structural because this
 * file has no `ApiUser` type and does not need one.
 */
async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/', NAV);
}

/** The toggle, found by its accessible name in either state. */
const followButton = (page: Page) => page.getByRole('button', { name: /^Follow(ing)?$/ });

/**
 * The stat-cluster links.
 *
 * Two patterns rather than one interpolated regex: the follower count
 * pluralises and the following count does not, so a single `\d+\s+${label}`
 * silently stops matching the moment somebody gains their first follower.
 */
const STAT_PATTERN = {
  following: /\d+\s+following/,
  followers: /\d+\s+followers?/,
} as const;

const statLink = (page: Page, label: 'following' | 'followers') =>
  page.getByRole('link', { name: STAT_PATTERN[label] });

test('follow and unfollow from a profile, and the counts follow', async ({ page }) => {
  const other = await createAccount('Nadia Okonkwo');
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${other.handle}`);

  // Not following: the count reads zero and the control invites.
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(followButton(page)).toHaveText('Follow');
  await expect(page.getByRole('link', { name: '0 followers' })).toBeVisible();

  await followButton(page).click();

  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true', ACTION);
  await expect(followButton(page)).toHaveText('Following');
  await expect(page.getByRole('link', { name: '1 follower' })).toBeVisible(ACTION);

  // The other half of the asymmetric relation, on my own profile.
  await page.goto(`/${me.handle}`);
  await expect(page.getByRole('link', { name: '1 following' })).toBeVisible();
  await expect(page.getByRole('link', { name: '0 followers' })).toBeVisible();

  // Unfollow, and everything reverses.
  await page.goto(`/${other.handle}`);
  await followButton(page).click();

  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false', ACTION);
  await expect(followButton(page)).toHaveText('Follow');
  await expect(page.getByRole('link', { name: '0 followers' })).toBeVisible(ACTION);

  await page.goto(`/${me.handle}`);
  await expect(page.getByRole('link', { name: '0 following' })).toBeVisible();
});

test('following twice in a row settles on one follow', async ({ page }) => {
  const other = await createAccount();
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${other.handle}`);
  await followButton(page).click();
  await expect(followButton(page)).toHaveText('Following', ACTION);

  // Re-submitting the same intent. The desired state is submitted rather than
  // derived, so this must not toggle back off.
  await page.reload();
  await expect(followButton(page)).toHaveText('Following', ACTION);
  await expect(page.getByRole('link', { name: '1 follower' })).toBeVisible();
});

test('the relationship lists hold each side of the follow', async ({ page }) => {
  const other = await createAccount('Nadia Okonkwo');
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${other.handle}`);
  await followButton(page).click();
  await expect(followButton(page)).toHaveText('Following', ACTION);

  // Their followers include me, reached by clicking the count.
  await statLink(page, 'followers').click();
  await expect(page).toHaveURL(`/${other.handle}/followers`, NAV);
  await expect(page.getByRole('heading', { name: 'Followers', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: new RegExp(me.handle) }),
  ).toBeVisible();

  // My following includes them, and the display name is what renders.
  await page.goto(`/${me.handle}`);
  await statLink(page, 'following').click();
  await expect(page).toHaveURL(`/${me.handle}/following`, NAV);
  await expect(page.getByRole('heading', { name: 'Following', level: 1 })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: /Nadia Okonkwo/ })).toBeVisible();

  // Asymmetry, as the reader would see it: my followers list is still empty.
  await page.goto(`/${me.handle}/followers`);
  await expect(page.getByText(/has no followers yet/)).toBeVisible();
});

test('a relationship list is reachable and correct signed out', async ({ page, browser }) => {
  const other = await createAccount();
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${other.handle}`);
  await followButton(page).click();
  await expect(followButton(page)).toHaveText('Following', ACTION);

  const anonContext = await browser.newContext();
  const anonPage = await anonContext.newPage();
  try {
    await anonPage.goto(`/${other.handle}`);

    // Counts are public; the control is not offered.
    await expect(anonPage.getByRole('link', { name: '1 follower' })).toBeVisible();
    await expect(anonPage.getByRole('button', { name: /^Follow(ing)?$/ })).toHaveCount(0);

    await anonPage.goto(`/${other.handle}/followers`);
    await expect(
      anonPage.getByRole('main').getByRole('link', { name: new RegExp(me.handle) }),
    ).toBeVisible();
  } finally {
    // Closed explicitly: an unclosed context leaves the browser to collect it
    // and has cost this suite a hung run before.
    await anonContext.close();
  }
});

test('your own profile offers no follow control', async ({ page }) => {
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${me.handle}`);

  await expect(page.getByRole('main').getByText('You', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Follow(ing)?$/ })).toHaveCount(0);

  // The cluster still renders — an honest zero beside a real album count.
  await expect(page.getByRole('link', { name: '0 following' })).toBeVisible();
  await expect(page.getByRole('link', { name: '0 followers' })).toBeVisible();
});

test('an empty relationship list states the absence rather than showing nothing', async ({
  page,
}) => {
  const me = await createAccount();
  await signIn(page, me);

  await page.goto(`/${me.handle}/following`);
  await expect(page.getByText(/isn’t following anyone yet/)).toBeVisible();

  await page.goto(`/${me.handle}/followers`);
  await expect(page.getByText(/has no followers yet/)).toBeVisible();
});

test('a page past the end of a relationship list is a 404', async ({ page }) => {
  const me = await createAccount();
  await signIn(page, me);

  const response = await page.goto(`/${me.handle}/followers?page=9`);

  expect(response?.status()).toBe(404);
});
