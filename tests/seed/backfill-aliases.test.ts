import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { aliasCoverage } from '@/services/catalogue/aliases';
import { drainJobs, enqueueMissingArtistAliases, queueDepth } from '@/services/catalogue/jobs';

/**
 * Artist alias backfill. **Not a test** - a utility run explicitly.
 *
 *   npm run db:backfill:aliases                      # queue only
 *   BACKFILL_DRAIN=true npm run db:backfill:aliases  # queue and fetch
 *   BACKFILL_LIMIT=10 npm run db:backfill:aliases    # bound the sweep
 *
 * Fetches MusicBrainz aliases for artists that have never had one answered, so
 * that search reaches an artist by a former name, a transliteration or a
 * curated misspelling - F-019, `architecture.md` section 10.5.
 *
 * **One request per artist**, which is what makes this affordable: the whole of
 * an artist's discography becomes more findable for a single call against the
 * 1 req/sec budget. Draining is opt-in all the same, because the budget is
 * shared with ingestion and a large catalogue is a long serial run - roughly
 * one artist per second, so a thousand artists is about seventeen minutes.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function format(label: string, c: Awaited<ReturnType<typeof aliasCoverage>>) {
  return [
    `  ${label}`,
    `    stored (has aliases)        ${c.stored}`,
    `    absent (none upstream)      ${c.absent}`,
    `    failed (service error)      ${c.failed}`,
    `    pending (not attempted)     ${c.pending}`,
    `    artists                     ${c.total}`,
    `    alias rows                  ${c.aliasRows}`,
    `    observed coverage           ${c.observedCoveragePercent}%  (stored / attempted)`,
  ].join('\n');
}

describe('backfill artist aliases', () => {
  it('queues every artist still owed an alias fetch', { timeout: 60 * 60 * 1000 }, async () => {
    const before = await aliasCoverage(admin);
    console.info(`\n${format('Before', before)}\n`);

    const limit = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : undefined;
    const { candidates, queued } = await enqueueMissingArtistAliases({ admin, limit });

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

    const after = await aliasCoverage(admin);
    console.info(`\n${format('After', after)}\n`);
    console.info(`  Queue depth: ${JSON.stringify(await queueDepth(admin))}\n`);
  });
});
