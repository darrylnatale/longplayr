import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test } from '@playwright/test';

/**
 * Phase 2's first user-visible slice, end to end: a real user adds an album to
 * their collection and removes it again, and the card tells the truth at every
 * step.
 *
 * The album comes from the local fixture catalogue (`npm run db:seed:fixtures`)
 * and is never modified — only the user's own collection rows are written, and
 * the account is deleted afterwards so nothing accumulates.
 */

config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

/** Seeded by `npm run db:seed:fixtures`. */
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

const ALBUM_MBID = '0b0e4f1e-1111-4000-8000-000000000001';

function uniqueUser() {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `e2e-col-${id}@example.com`,
    password: 'correct-horse-battery',
    handle: `e2ecol_${id}`.slice(0, 30),
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
      // Hard delete cascades the profile and every collection row with it.
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

test('add an album to the collection, then remove it', async ({ page }) => {
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

  await page.goto(`/albums/${ALBUM_MBID}`);

  const add = page.getByRole('button', { name: 'Add to collection' });
  await expect(add).toBeVisible();
  await expect(page.getByText('In your collection')).toBeHidden();

  await add.click();

  // Collected: the card swaps to the collected state and the add control goes.
  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeHidden();

  // Removal warns before it destroys anything, so it takes two steps.
  await page.getByRole('button', { name: 'Remove from collection' }).click();
  await expect(page.getByText('Remove this album from your collection?')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('In your collection')).toBeHidden();
});

test('a signed-out visitor is invited to sign in rather than shown a control that fails', async ({
  page,
}) => {
  await page.goto(`/albums/${ALBUM_MBID}`);

  await expect(page.getByRole('link', { name: 'Sign in to add' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeHidden();
});

test('rate an album, change the score, then clear it', async ({ page }) => {
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

  // Uncollected to begin with.
  await page.goto(`/albums/${ALBUM_MBID}`);
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();

  // Rating an uncollected album collects it.
  await page.getByRole('button', { name: 'Rate', exact: true }).click();
  await page.getByLabel('Your score').fill('8.5');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Your score')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle('Your score')).toHaveText('8.5');
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeHidden();

  // The album average is computed on read and shown separately from the chip.
  await expect(page.getByTitle('Average score')).toContainText('8.5');

  // Changing the score.
  await page.getByRole('button', { name: 'Change score' }).click();
  await page.getByLabel('Your score').fill('4.0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTitle('Your score')).toHaveText('4.0', { timeout: 30_000 });

  // Clearing returns it to collected-but-unrated, not to zero.
  await page.getByRole('button', { name: 'Change score' }).click();
  await page.getByRole('button', { name: 'Clear score' }).click();

  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle('Your score')).toBeHidden();
  await expect(page.getByText('Not yet rated.')).toBeVisible();
});

test('like an uncollected album, then unlike it', async ({ page }) => {
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

  await page.goto(`/albums/${ALBUM_MBID}`);
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();

  const like = page.getByRole('button', { name: 'Like', exact: true });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();

  // Liking collects the album and marks it liked, in one action.
  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
  const liked = page.getByRole('button', { name: 'Liked', exact: true });
  await expect(liked).toBeVisible();
  await expect(liked).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeHidden();

  // Unliking leaves the album collected — it is not a way out of the collection.
  await liked.click();
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
    { timeout: 30_000 },
  );
  await expect(page.getByText('In your collection')).toBeVisible();
});

test('relisten an uncollected album, then relisten again', async ({ page }) => {
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

  await page.goto(`/albums/${ALBUM_MBID}`);
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();

  // No count is shown at zero.
  await page.getByRole('button', { name: 'Relisten', exact: true }).click();

  // Relistening collects the album and records the first event.
  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Relisten ×1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeHidden();

  // A second relisten is another event, not a toggle.
  await page.getByRole('button', { name: 'Relisten ×1' }).click();
  await expect(page.getByRole('button', { name: 'Relisten ×2' })).toBeVisible({
    timeout: 30_000,
  });

  // Still collected, still unrated — relistening claims nothing about a score.
  await expect(page.getByText('In your collection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rate this album' })).toBeVisible();
});

test('write a review, edit it, then delete it', async ({ page }) => {
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

  await page.goto(`/albums/${ALBUM_MBID}`);
  await expect(page.getByRole('button', { name: 'Add to collection' })).toBeVisible();

  // Writing about an uncollected album collects it.
  await page.getByRole('button', { name: 'Write a review…' }).click();
  const editor = page.getByLabel('Your review');
  await expect(editor).toBeVisible();
  await editor.fill('First thoughts.\n\nA second paragraph.');
  await page.getByRole('button', { name: 'Save review' }).click();

  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit review…' })).toBeVisible();

  // Editing prefills with what is already there, rather than making them retype.
  await page.getByRole('button', { name: 'Edit review…' }).click();
  await expect(page.getByLabel('Your review')).toHaveValue(
    'First thoughts.\n\nA second paragraph.',
  );
  await page.getByLabel('Your review').fill('Revised thoughts entirely.');
  await page.getByRole('button', { name: 'Save review' }).click();

  await expect(page.getByRole('button', { name: 'Edit review…' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Edit review…' }).click();
  await expect(page.getByLabel('Your review')).toHaveValue('Revised thoughts entirely.');

  // Deleting warns first, and leaves the album collected.
  await page.getByRole('button', { name: 'Delete review' }).click();
  await expect(page.getByText('Delete this review?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Write a review…' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('In your collection')).toBeVisible();
});

test('the review editor works at phone width', async ({ page }) => {
  const user = uniqueUser();
  createdEmails.push(user.email);

  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/onboarding', NAV);
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();

  await page.goto(`/albums/${ALBUM_MBID}`);
  await page.getByRole('button', { name: 'Write a review…' }).click();

  const editor = page.getByLabel('Your review');
  await expect(editor).toBeVisible();

  // 16px or larger, otherwise iOS zooms the viewport the moment it is focused.
  const fontSize = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(16);

  // The field must fit the viewport, not overflow it.
  const box = await editor.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);

  await editor.fill('Written on a phone.');
  await page.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByText('In your collection')).toBeVisible({ timeout: 30_000 });
});
