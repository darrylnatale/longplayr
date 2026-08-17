import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { drainJobs, enqueueMissingTracklists, queueDepth } from '@/services/catalogue/jobs';
import { tracklistCoverage } from '@/services/catalogue/tracklist';

/**
 * Tracklist recovery. **Not a test** — a utility run explicitly.
 *
 *   npm run db:backfill:tracklists                      # queue only
 *   BACKFILL_DRAIN=true npm run db:backfill:tracklists  # queue and fetch
 *   BACKFILL_LIMIT=10 npm run db:backfill:tracklists    # bound the sweep
 *
 * Recovers albums whose representative-release request failed during ingestion
 * and was silently discarded. On staging that is 44 of 335 albums, which have
 * no tracks and no record that a tracklist was ever attempted.
 *
 * Unlike artwork, this spends the MusicBrainz budget: one request per release,
 * serialised at one per second by the shared limiter. 44 albums is under a
 * minute. Draining is opt-in for exactly that reason.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function format(label: string, c: Awaited<ReturnType<typeof tracklistCoverage>>) {
  return [
    `  ${label}`,
    `    found                      ${c.found}`,
    `    absent (no tracks upstream)${c.absent}`,
    `    failed (service error)     ${c.failed}`,
    `    pending (not attempted)    ${c.pending}`,
    `    representative releases    ${c.total}`,
    `    observed coverage          ${c.observedCoveragePercent}%  (found / attempted)`,
  ].join('\n');
}

describe('backfill missing tracklists', () => {
  it(
    'queues every representative release still owed a tracklist',
    { timeout: 60 * 60 * 1000 },
    async () => {
      const before = await tracklistCoverage(admin);
      console.info(`\n${format('Before', before)}\n`);

      const limit = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : undefined;
      const { candidates, queued } = await enqueueMissingTracklists({ admin, limit });

      console.info(
        `  Candidates (pending or failed)  ${candidates}\n` +
          `  Newly queued                    ${queued}\n` +
          `  Already queued                  ${candidates - queued}\n`,
      );

      if (process.env.BACKFILL_DRAIN !== 'true') {
        console.info(
          '  Queued only. The daily cron will drain these.\n' +
            '  Re-run with BACKFILL_DRAIN=true to fetch them now.\n',
        );
        console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
        return;
      }

      let round = 0;
      for (;;) {
        const summary = await drainJobs(25, admin);
        if (summary.claimed === 0) break;
        round += 1;
        console.info(
          `  drain ${round}: claimed ${summary.claimed}, succeeded ${summary.succeeded}, ` +
            `failed ${summary.failed}, exhausted ${summary.exhausted}`,
        );
      }

      const after = await tracklistCoverage(admin);
      console.info(`\n${format('After', after)}\n`);
      console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
    },
  );
});
