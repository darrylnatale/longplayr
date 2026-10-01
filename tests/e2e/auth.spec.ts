import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 0 definition of done, as an executable check:
 * a new user signs up, picks a handle, signs out, signs back in, and their
 * profile renders at /<handle>.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/**
 * Navigations that follow a server action get a longer budget than Playwright's
 * 5s default.
 *
 * Sign-up, handle claim and sign-in each round-trip to GoTrue and then redirect.
 * On a loaded local dev server that lands around five seconds — measured at 5.7s
 * for the first auth test in isolation — so the default was failing on work that
 * had merely been slow. The test timeout stays at Playwright's 30s default, so a
 * flow that genuinely hangs still fails.
 */
const NAV = { timeout: 15_000 };

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2e_${id}`.slice(0, 30),
  };
}

/**
 * Every account this file signs up, so the run can delete them again.
 *
 * This file used to create three real users per run and clean up none of them,
 * which is why the local `auth.users` grew by three every time the suite ran.
 * `collection.spec.ts` already did this correctly; the pattern is copied from
 * there rather than invented, so the two files stay recognisably the same.
 *
 * The leak was previously recorded against the *integration* suite. It was
 * measured on 2026-08-19 and that attribution was wrong: a full integration
 * run — 241 tests across 14 files — returns `auth.users` to zero. This file
 * was the whole of it.
 */
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
      // Hard delete cascades the profile, which is the behaviour the
      // hard-delete decision depends on anyway.
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

test('sign up, choose a handle, sign out, sign back in', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: user.handle })).toBeVisible();
  // The migrated profile marks your own page with a "You" chip beside the
  // heading, rather than the sentence Phase 0 used.
  // Scoped to main: the mobile tab bar also has a "You" destination, which is
  // in the DOM at every width.
  await expect(page.getByRole('main').getByText('You', { exact: true })).toBeVisible();

  // The site header is a banner landmark, not a navigation one — the only
  // navigation landmark is the mobile tab bar, which carries no account
  // controls. Account state lives in the header at every width.
  const nav = page.getByRole('banner');

  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/', NAV);
  await expect(nav.getByRole('link', { name: user.handle })).toBeVisible();
});

test('a profile is publicly visible when signed out', async ({ page, context }) => {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  // Everything user-generated is public — verify that literally, from a
  // session with no cookies at all.
  await context.clearCookies();
  await page.goto(`/${user.handle}`);
  await expect(page.getByRole('heading', { name: user.handle })).toBeVisible();
  await expect(page.getByText('This is you')).toBeHidden();
});

test('an unknown handle 404s', async ({ page }) => {
  const response = await page.goto('/definitely_not_a_real_handle');
  expect(response?.status()).toBe(404);
});

test('reserved handles are rejected', async ({ page }) => {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/onboarding', NAV);

  await page.getByLabel('Handle').fill('settings');
  await page.getByRole('button', { name: 'Claim handle' }).click();

  // Scoped by id: Next renders its own role="alert" route announcer.
  await expect(page.locator('#handle-error')).toContainText('not available');
  await expect(page).toHaveURL('/onboarding', NAV);
});

/**
 * Signing out on a phone, and why these tests set a viewport.
 *
 * `signOut` was reachable from exactly one place — the header's `hidden md:flex`
 * block — so below 768px a signed-in user could not sign out at all. 390x844
 * follows the precedent in `collection.spec.ts`. The profile control is always
 * addressed through `main`, because the header's own button stays in the DOM at
 * every width and carries the same accessible name.
 */
const PHONE = { width: 390, height: 844 };

/** The profile's own sign-out control, never the header's. */
const profileSignOut = (page: Page) =>
  page.getByRole('main').getByRole('button', { name: 'Sign out' });

test('at phone width the owner signs out from their own profile', async ({ page }) => {
  await page.setViewportSize(PHONE);

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

  // The header route is genuinely gone at this width rather than merely unused,
  // which is what makes the click below load-bearing. Hidden, not absent: the
  // block stays in the DOM and `md:flex` decides whether it is shown.
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign out' })).toBeHidden();

  await profileSignOut(page).click();

  // **Wait for the sign-out redirect to land before navigating again.**
  // `signOut()` ends in `redirect('/')`, so an immediate `page.goto` races it —
  // the mechanism behind the two flaky `list-likes` tests on CI #86, fixed in
  // `3d62bfa`. That fix waited on the header's signed-out state; at this width
  // the header is hidden and cannot be read, but the URL can be, at any width.
  await expect(page).toHaveURL('/', NAV);

  // **The session is gone, proven by the server refusing a protected route** —
  // not by the redirect above, which only shows the action ran, and not by what
  // the page happens to render.
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/login/, NAV);
});

test('at phone width a visitor sees no sign-out control on someone else’s profile', async ({
  page,
  context,
}) => {
  await page.setViewportSize(PHONE);

  const owner = uniqueUser();
  createdEmails.push(owner.email);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByLabel('Confirm password').fill(owner.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Handle').fill(owner.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${owner.handle}`, NAV);

  // A second account, signed in as somebody else. Cookies are cleared rather
  // than signing out, the same way the public-visibility test above does it.
  await context.clearCookies();
  const visitor = uniqueUser();
  createdEmails.push(visitor.email);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(visitor.email);
  await page.getByLabel('Password', { exact: true }).fill(visitor.password);
  await page.getByLabel('Confirm password').fill(visitor.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Handle').fill(visitor.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${visitor.handle}`, NAV);

  await page.goto(`/${owner.handle}`);

  // The profile rendered before anything is asserted absent from it: without
  // this, a 404 or an error page would satisfy the count below.
  await expect(page.getByRole('heading', { name: owner.handle })).toBeVisible();
  await expect(profileSignOut(page)).toHaveCount(0);
});

test('at phone width a signed-out visitor sees no sign-out control', async ({ page, context }) => {
  await page.setViewportSize(PHONE);

  const user = uniqueUser();
  createdEmails.push(user.email);
  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`, NAV);

  await context.clearCookies();
  await page.goto(`/${user.handle}`);

  await expect(page.getByRole('heading', { name: user.handle })).toBeVisible();
  await expect(profileSignOut(page)).toHaveCount(0);
});

/**
 * A rejected attempt keeps the address — `architecture.md` §6.2, F-055.
 *
 * **This can only be tested in a browser**, and that is the point rather than a
 * convenience. The behaviour is a React 19 property: a form action resolving
 * resets an uncontrolled form, and a changed `defaultValue` does not update an
 * input that is already mounted. **Whether the fix works is a question about
 * the runtime, not about the code**, so reading the source cannot answer it and
 * neither can a unit test over the action.
 *
 * **The password assertions are the half that would be missed.** Preserving the
 * address is the visible fix; never preserving a password is the decision, and
 * a change that refilled both would satisfy the first assertion alone.
 */
test('a wrong password keeps the address and clears the password', async ({ page }) => {
  const user = uniqueUser();

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The rejection, so the assertions below are about a failed attempt rather
  // than about a form that was never submitted.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });

  await expect(page.getByLabel('Email')).toHaveValue(user.email);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('a mismatched signup keeps the address and clears both passwords', async ({ page }) => {
  const user = uniqueUser();

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByLabel('Confirm password').fill('correct-horse-batteryy');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByLabel('Email')).toHaveValue(user.email, { timeout: 15_000 });

  // **Both cleared, because a mismatch means at least one is wrong.** Refilling
  // either would hide which — §6.2.
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirm password')).toHaveValue('');
});
