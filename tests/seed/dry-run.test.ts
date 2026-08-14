import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { dryRunSeed } from '@/services/catalogue/seed';
import type { PopularityRange } from '@/services/discovery/popularity';

/**
 * Seed dry run. **Not a test** — a reporting utility.
 *
 *   npm run db:seed:dryrun
 *
 * Costs one ListenBrainz request and **zero** MusicBrainz requests, and writes
 * nothing to the catalogue. Its purpose is to make the selection inspectable
 * before any data is committed.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe('seed dry run', () => {
  it('reports what a seed would select', { timeout: 120_000 }, async () => {
    const report = await dryRunSeed({
      admin,
      limit: process.env.SEED_LIMIT ? Number(process.env.SEED_LIMIT) : undefined,
      range: process.env.SEED_RANGE as PopularityRange | undefined,
      maxPerArtist:
        process.env.SEED_MAX_PER_ARTIST === 'none'
          ? null
          : process.env.SEED_MAX_PER_ARTIST
            ? Number(process.env.SEED_MAX_PER_ARTIST)
            : undefined,
    });

    writeFileSync('seed-dry-run.json', JSON.stringify(report, null, 2));
  });
});
