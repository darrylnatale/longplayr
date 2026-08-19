import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test } from '@playwright/test';

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
  await page.getByLabel('Password').fill(user.password);
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
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/', NAV);
  await expect(nav.getByRole('link', { name: user.handle })).toBeVisible();
});

test('a profile is publicly visible when signed out', async ({ page, context }) => {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
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
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/onboarding', NAV);

  await page.getByLabel('Handle').fill('settings');
  await page.getByRole('button', { name: 'Claim handle' }).click();

  // Scoped by id: Next renders its own role="alert" route announcer.
  await expect(page.locator('#handle-error')).toContainText('not available');
  await expect(page).toHaveURL('/onboarding', NAV);
});
