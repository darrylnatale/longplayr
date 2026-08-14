import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
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

describe('seed fixtures', () => {
  it('ingests every fixture', async () => {
    for (const [name, fixture] of Object.entries(allFixtures)) {
      const result = await ingestReleaseGroupPayload(fixture, admin);
      console.info(`${name}: ${result.status}`);
    }
  });
});
