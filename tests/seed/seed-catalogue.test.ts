import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { formatSeedReport, seedCatalogue } from '@/services/catalogue/seed';
import type { PopularityRange } from '@/services/discovery/popularity';

/**
 * Real-data catalogue seed. **Not a test** — a utility run explicitly.
 *
 *   npm run db:seed:catalogue        # uses the approved strategy
 *   SEED_LIMIT=50 npm run db:seed:catalogue   # override only to test
 *
 * Makes live calls to ListenBrainz, MusicBrainz and Cover Art Archive, so it
 * requires a genuine MUSICBRAINZ_CONTACT. The client refuses to run with a
 * placeholder, which is deliberate: an unidentified client risks getting
 * longplayr blocked for every user at once.
 *
 * Expect roughly one second per album — the MusicBrainz rate limit is the
 * floor, not the code.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe('seed catalogue from ListenBrainz', () => {
  it(
    'ingests popular release groups and writes a report',
    { timeout: 60 * 60 * 1000 },
    async () => {
      // No defaults here. seedCatalogue owns the approved strategy — all-time,
      // 500 candidates, 2 per artist — and duplicating those values in the
      // runner is exactly how a run silently used the wrong ones.
      const report = await seedCatalogue({
        limit: process.env.SEED_LIMIT ? Number(process.env.SEED_LIMIT) : undefined,
        range: (process.env.SEED_RANGE as PopularityRange | undefined) ?? undefined,
        maxPerArtist:
          process.env.SEED_MAX_PER_ARTIST === 'none'
            ? null
            : process.env.SEED_MAX_PER_ARTIST
              ? Number(process.env.SEED_MAX_PER_ARTIST)
              : undefined,
        admin,
        includeArtwork: process.env.SEED_ARTWORK !== 'false',
        onProgress: (done, total, label) => {
          if (done % 10 === 0 || done === total) {
            console.info(`[${done}/${total}] ${label}`);
          }
        },
      });

      const text = formatSeedReport(report);
      writeFileSync('seed-report.txt', text);
      writeFileSync('seed-report.json', JSON.stringify(report, null, 2));
      console.info(`\n${text}`);
    },
  );
});
