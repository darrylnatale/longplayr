import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { config } from 'dotenv';
import { albumUrl } from './urls';

/**
 * Progressive hydration on the album page.
 *
 * An album created from a browse response holds no tracklist until its full
 * detail is fetched. The page must say so explicitly rather than rendering the
 * "no tracklist available for this release" copy, which asserts a fact about
 * the release that has not been established.
 *
 * **Does not add a fixture.** `collection-sort.spec.ts` documents that the
 * local fixture catalogue holds seven albums, so this flips an existing one to
 * `pending` and restores it afterwards rather than changing that number.
 */

// Playwright loads no env of its own; every spec needing the admin client
// loads it the same way.
config({ path: '.env.test.local', quiet: true });
config({ path: '.env.local', quiet: true });

const IN_RAINBOWS = '0b0e4f1e-1111-4000-8000-000000000001';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

test('a pending album says its tracklist is still being fetched', async ({ page }) => {
  const db = admin();

  const { data: before } = await db
    .from('albums')
    .select('hydration_status, representative_release_id')
    .eq('mbid', IN_RAINBOWS)
    .single();
  test.skip(!before, 'fixture catalogue not seeded');

  // Detach the representative release as well: a pending album created from
  // browse has none, and leaving it attached would render real tracks.
  await db
    .from('albums')
    .update({ hydration_status: 'pending', representative_release_id: null })
    .eq('mbid', IN_RAINBOWS);

  try {
    await page.goto(await albumUrl(IN_RAINBOWS));

    await expect(page.getByTestId('tracklist-pending')).toBeVisible();
    await expect(page.getByText('No tracklist available for this release.')).toHaveCount(0);
  } finally {
    await db
      .from('albums')
      .update({
        hydration_status: before!.hydration_status,
        representative_release_id: before!.representative_release_id,
      })
      .eq('mbid', IN_RAINBOWS);
  }
});

test('a fetched album renders its tracklist normally', async ({ page }) => {
  const db = admin();
  const { data } = await db
    .from('albums')
    .select('hydration_status')
    .eq('mbid', IN_RAINBOWS)
    .single();
  test.skip(!data, 'fixture catalogue not seeded');
  expect(data!.hydration_status).toBe('fetched');

  await page.goto(await albumUrl(IN_RAINBOWS));

  await expect(page.getByTestId('tracklist-pending')).toHaveCount(0);
});
