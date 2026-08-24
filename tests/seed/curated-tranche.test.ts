import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  curatedTrancheStatus,
  enqueueCuratedTranche,
  formatTrancheStatus,
} from '@/services/catalogue/curated-tranche';
import { drainJobs } from '@/services/catalogue/jobs';

/**
 * Curated tranche ingestion. **Not a test** — a utility run explicitly.
 *
 *   npm run db:seed:curated
 *
 * Queues one discovery job per unresolved curated artist and drains them.
 * **Additive only**: an album already held is skipped, so a hydrated album can
 * never be reduced to a minimal one. Nothing is deleted.
 *
 * An artist whose discovery exhausts its request retries stays in the queue as
 * a durable, retryable job. Re-running processes only what remains unresolved,
 * and the run reports INCOMPLETE until every curated artist has succeeded.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe('ingest the curated tranche', () => {
  it('queues and drains curated artist discovery', { timeout: 60 * 60 * 1000 }, async () => {
    const queued = await enqueueCuratedTranche({ admin });

    // Bounded: each pass claims a batch, and a pass claiming nothing ends it.
    // Work still behind the queue's backoff is left for the next run or cron.
    for (let pass = 0; pass < 200; pass++) {
      const summary = await drainJobs(10, admin);
      if (summary.claimed === 0) break;
    }

    const status = await curatedTrancheStatus({ admin });
    writeFileSync('curated-tranche-report.json', JSON.stringify({ queued, status }, null, 2));
    console.log(`\n${formatTrancheStatus(status)}\n`);
  });
});
