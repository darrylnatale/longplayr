import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { artworkCoverage } from '@/services/catalogue/artwork';
import { drainJobs, enqueueMissingArtwork, queueDepth } from '@/services/catalogue/jobs';

/**
 * Artwork recovery. **Not a test** — a utility run explicitly.
 *
 *   npm run db:backfill:artwork                    # queue only, drain by cron
 *   BACKFILL_DRAIN=true npm run db:backfill:artwork  # queue and drain now
 *   BACKFILL_LIMIT=10 npm run db:backfill:artwork    # bound the sweep
 *
 * Exists because of a specific gap. The first staging seed predates the
 * four-state artwork model: its Cover Art Archive failures threw before any
 * status was written, so 36 albums sit at `artwork_status = 'pending'` —
 * indistinguishable from never attempted — with no job queued and nothing
 * scheduled to notice them. Coverage reads 100% because the corrected metric
 * counts `found / (found + absent + failed)` and none of the 36 are in those
 * states.
 *
 * Queue-only is the default deliberately. Draining is the step that makes live
 * Cover Art Archive requests and writes rows, so it should be asked for rather
 * than assumed.
 *
 * Cover Art Archive imposes no rate limit, so draining here is bounded by
 * bandwidth, not by the MusicBrainz budget. That is why this can finish in
 * minutes what the daily cron would take days to work through.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function formatCoverage(label: string, c: Awaited<ReturnType<typeof artworkCoverage>>) {
  return [
    `  ${label}`,
    `    found                      ${c.found}`,
    `    absent (confirmed no art)  ${c.absent}`,
    `    failed (service error)     ${c.failed}`,
    `    pending (not attempted)    ${c.pending}`,
    `    total                      ${c.total}`,
    `    observed coverage          ${c.observedCoveragePercent}%  (found / attempted)`,
  ].join('\n');
}

describe('backfill missing artwork', () => {
  it(
    'queues every album still lacking a cover, and optionally drains',
    { timeout: 60 * 60 * 1000 },
    async () => {
      const before = await artworkCoverage(admin);
      console.info(`\n${formatCoverage('Before', before)}\n`);

      const limit = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : undefined;
      const { candidates, queued } = await enqueueMissingArtwork({ admin, limit });

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

      // Drained in batches so progress is visible and a mid-run failure leaves
      // the queue in a state the next run can pick up rather than restarting.
      let round = 0;
      for (;;) {
        const summary = await drainJobs(25, admin);
        if (summary.claimed === 0) break;
        round += 1;
        console.info(
          `  drain ${round}: claimed ${summary.claimed}, ` +
            `succeeded ${summary.succeeded}, failed ${summary.failed}, ` +
            `exhausted ${summary.exhausted}`,
        );
        // A job that failed goes back to pending behind a 30s backoff, so it
        // will not be claimed again by the next iteration. Stopping when a
        // round claims nothing is what ends the loop.
      }

      const after = await artworkCoverage(admin);
      console.info(`\n${formatCoverage('After', after)}\n`);
      console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
    },
  );
});
