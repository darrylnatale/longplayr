import { expect, test } from '@playwright/test';

/**
 * Phase 0 definition of done, as an executable check:
 * a new user signs up, picks a handle, signs out, signs back in, and their
 * profile renders at /<handle>.
 */

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2e_${id}`.slice(0, 30),
  };
}

test('sign up, choose a handle, sign out, sign back in', async ({ page }) => {
  const user = uniqueUser();

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL('/onboarding');

  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();

  await expect(page).toHaveURL(`/${user.handle}`);
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

  await expect(page).toHaveURL('/');
  await expect(nav.getByRole('link', { name: user.handle })).toBeVisible();
});

test('a profile is publicly visible when signed out', async ({ page, context }) => {
  const user = uniqueUser();

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`);

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

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/onboarding');

  await page.getByLabel('Handle').fill('settings');
  await page.getByRole('button', { name: 'Claim handle' }).click();

  // Scoped by id: Next renders its own role="alert" route announcer.
  await expect(page.locator('#handle-error')).toContainText('not available');
  await expect(page).toHaveURL('/onboarding');
});
