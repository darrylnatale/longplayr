import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  dryRunCuratedTranche,
  formatCuratedTrancheReport,
} from '@/services/catalogue/curated-tranche';

/**
 * Curated tranche dry run. **Not a test** — a reporting utility.
 *
 *   npm run db:seed:curated:dryrun
 *
 * Costs one MusicBrainz request per hundred release groups per curated artist
 * and writes **nothing** to the catalogue. Its purpose is to make the tranche
 * inspectable before any row is committed, the same guarantee the popularity
 * seed's dry run provides.
 *
 * Requires a genuine MUSICBRAINZ_CONTACT — the client refuses to run with a
 * placeholder, deliberately.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe('curated tranche dry run', () => {
  it('reports what the tranche would take', { timeout: 30 * 60 * 1000 }, async () => {
    const report = await dryRunCuratedTranche({ admin });

    writeFileSync('curated-tranche-dry-run.json', JSON.stringify(report, null, 2));
    console.log(`\n${formatCuratedTrancheReport(report)}\n`);
  });
});
