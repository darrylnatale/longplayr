import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { ARTWORK_BUCKET, ARTWORK_SIZES, artworkPath } from '@/services/catalogue/artwork';
import { allFixtures } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Not a test: a seeding utility run explicitly via `npm run db:seed:fixtures`.
 * Populates the local catalogue from fixtures so pages can be inspected
 * without any network access.
 */
const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * A 1×1 JPEG, so a fixture marked `found` really has bytes behind it.
 *
 * **`found` must not be a lie.** `AlbumCover` renders an `<Image>` from storage
 * for that status, so setting it without uploading anything would leave every
 * cover broken — and this seed exists so pages can be inspected without network
 * access. Real dimensions do not matter; existence does.
 */
const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/**
 * Artwork state the fixture catalogue models.
 *
 * **This became load-bearing on 2026-09-16.** `product-spec.md` §6 filters
 * "Recently added" to albums that have a cover, so a catalogue where nothing
 * has been fetched renders **an empty section on both Home and Browse** — which
 * is exactly what a freshly seeded database used to be.
 *
 * **One album is deliberately left `absent`**, so the cover-art prompt and the
 * operator worklist (`architecture.md` §17b) are observable by default rather
 * than by hand-editing rows before every check.
 *
 * **Which album that is, is not arbitrary.** It must be one no end-to-end
 * assertion expects to find in "Recently added", since `absent` now removes it
 * from that section. `messyReleaseGroup` also carries a representative release,
 * so the prompt it enables actually has somewhere to point.
 */
const ABSENT_FIXTURE = 'messyReleaseGroup';

describe('seed fixtures', () => {
  it(
    'ingests every fixture',
    // **Not the default 5s, because this is a utility rather than a test.**
    // Seeding does roughly thirty round trips — eight ingests, fourteen storage
    // uploads and eight status updates — and the artwork state added on
    // 2026-09-16 pushed it against a budget written when it only ingested.
    // It passed repeatedly and then began timing out under load, which is the
    // signature of sitting just under a ceiling rather than of a defect.
    // `backfill-artwork.test.ts` already carries a per-test timeout for the
    // same reason; this follows it at a smaller figure, since nothing here
    // leaves the machine.
    { timeout: 5 * 60 * 1000 },
    async () => {
      for (const [name, fixture] of Object.entries(allFixtures)) {
        const result = await ingestReleaseGroupPayload(fixture, admin);

        const status = name === ABSENT_FIXTURE ? 'absent' : 'found';

        if (status === 'found') {
          for (const size of ARTWORK_SIZES) {
            const { error } = await admin.storage
              .from(ARTWORK_BUCKET)
              .upload(artworkPath(fixture.id, size), ONE_PIXEL_JPEG, {
                contentType: 'image/jpeg',
                upsert: true,
              });
            if (error) throw error;
          }
        }

        const { error: statusError } = await admin
          .from('albums')
          .update({ artwork_status: status, artwork_updated_at: new Date().toISOString() })
          .eq('mbid', fixture.id);
        if (statusError) throw statusError;

        console.info(`${name}: ${result.status}, artwork ${status}`);
      }
    },
  );
});
