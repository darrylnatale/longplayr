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

  await expect(page).toHaveURL('/onboarding');
  await page.getByLabel('Handle').fill(user.handle);
  await page.getByRole('button', { name: 'Claim handle' }).click();
  await expect(page).toHaveURL(`/${user.handle}`);

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
