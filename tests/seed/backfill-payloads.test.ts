import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { drainJobs, enqueueMissingPayloads, queueDepth } from '@/services/catalogue/jobs';

/**
 * Upstream payload recovery. **Not a test** — a utility run explicitly.
 *
 *   npm run db:backfill:payloads                     # queue only
 *   BACKFILL_DRAIN=true npm run db:backfill:payloads # queue and drain now
 *   BACKFILL_LIMIT=25 npm run db:backfill:payloads   # bound the sweep
 *
 * Payload capture was added after the catalogue existed, so albums ingested
 * before it have columns but no stored response. This queues a re-ingest for
 * each of them; the re-ingest upserts on MBID, so nothing is duplicated,
 * `albums.id` never moves, and every collection entry, rating and review is
 * untouched.
 *
 * **Unlike the artwork backfill, this one is rate-limited by MusicBrainz.**
 * Each album costs two serialised requests — the release group, then the
 * representative release — so roughly one album every two seconds. Three
 * hundred albums is around ten minutes. That is why it lives here rather than
 * being left to the daily cron, which runs once and is capped at sixty seconds.
 *
 * Requires a genuine MUSICBRAINZ_CONTACT. The client refuses to run with a
 * placeholder, which is why this cannot be exercised locally.
 *
 * Queue-only is the default deliberately, matching the artwork backfill:
 * draining makes live requests and writes rows, so it is asked for rather than
 * assumed.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function coverage() {
  const albums = await admin.from('albums').select('mbid', { count: 'exact', head: true });
  const held = await admin
    .from('upstream_payloads')
    .select('source_id', { count: 'exact', head: true })
    .eq('source', 'musicbrainz')
    .eq('kind', 'release_group');

  const total = albums.count ?? 0;
  const stored = held.count ?? 0;
  return { total, stored, missing: Math.max(0, total - stored) };
}

describe('backfill missing upstream payloads', () => {
  it(
    'queues a re-ingest for every album with no stored response, and optionally drains',
    { timeout: 60 * 60 * 1000 },
    async () => {
      const before = await coverage();
      console.info(
        `\n  Before\n    albums            ${before.total}\n` +
          `    payloads stored   ${before.stored}\n` +
          `    missing           ${before.missing}\n`,
      );

      const limit = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : undefined;
      const { candidates, queued } = await enqueueMissingPayloads({ admin, limit });

      console.info(
        `  Candidates (no payload)  ${candidates}\n` +
          `  Newly queued             ${queued}\n` +
          `  Already queued           ${candidates - queued}\n`,
      );

      if (process.env.BACKFILL_DRAIN !== 'true') {
        console.info(
          '  Queued only. Re-run with BACKFILL_DRAIN=true to fetch them now.\n' +
            '  Expect roughly two seconds per album — the MusicBrainz rate limit\n' +
            '  is the floor, not the code.\n',
        );
        console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
        return;
      }

      // Batched so progress is visible and a mid-run failure leaves the queue
      // in a state the next run picks up rather than restarting.
      let round = 0;
      for (;;) {
        const summary = await drainJobs(10, admin);
        if (summary.claimed === 0) break;
        round += 1;
        console.info(
          `  drain ${round}: claimed ${summary.claimed}, ` +
            `succeeded ${summary.succeeded}, failed ${summary.failed}, ` +
            `exhausted ${summary.exhausted}`,
        );
      }

      const after = await coverage();
      console.info(
        `\n  After\n    albums            ${after.total}\n` +
          `    payloads stored   ${after.stored}\n` +
          `    missing           ${after.missing}\n`,
      );
      console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
    },
  );
});
