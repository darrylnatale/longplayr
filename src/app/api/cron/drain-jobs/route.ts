import { NextResponse, type NextRequest } from 'next/server';

import { authoriseCronRequest } from '@/services/catalogue/cron-auth';
import {
  drainJobs,
  enqueueFailedExpansions,
  enqueueMissingArtwork,
  enqueueMissingTracklists,
  queueDepth,
} from '@/services/catalogue/jobs';

/**
 * Drains the ingestion queue.
 *
 * Invoked on a schedule in deployed environments. Kept small on purpose: it
 * claims and runs jobs one at a time until its budget or its cap stops it, then
 * reports. Everything interesting lives in the service layer.
 *
 * **The count is no longer the safety mechanism.** It used to be, on the
 * reasoning that ten jobs is roughly ten seconds of wall time — which modelled
 * a rate-limited job at about a second each. That is right for `fetch_tracklist`
 * and wrong for `fetch_artwork`, which does not touch the MusicBrainz limiter at
 * all and was measured on staging at roughly nine seconds. Ten of those do not
 * fit in sixty, and the overflow was stranded in `running` every night. Safety
 * now comes from `drainJobs` claiming one job at a time, and from the budget
 * below; the count is a secondary cap.
 */

export const dynamic = 'force-dynamic';

/**
 * The platform's execution ceiling for this route.
 *
 * **Deliberately a literal.** Route segment config is extracted by static
 * analysis at build time, and whether an imported constant survives that is not
 * something the bundled Next documentation states either way. The budget below
 * is derived *from* this in the same file, which gives one source of truth
 * without betting on it.
 */
export const maxDuration = 60;

/**
 * Slack between the budget and the ceiling.
 *
 * **Sized for the in-flight job's overrun, not for the work after the drain.**
 * `queueDepth`'s four counts and the JSON response are sub-second. What needs
 * the room is a job started right at the deadline: at the measured ~9-second
 * artwork figure, one starting at 45s finishes near 54s. A 50-second budget
 * would leave about a second, which is a bet on the mean rather than the tail.
 *
 * This is a derived number, not a measured one, and it remains a bet on a tail
 * that cannot be eliminated — a job longer than the headroom still strands.
 */
const DRAIN_HEADROOM_SECONDS = 15;

/** Wall-clock budget for the drain. Never exceeds `maxDuration`, by construction. */
export const DRAIN_BUDGET_MS = (maxDuration - DRAIN_HEADROOM_SECONDS) * 1000;

const DEFAULT_BATCH_SIZE = 10;

export async function GET(request: NextRequest) {
  // Rule lives in the service layer so it can be tested directly — see
  // cron-auth.test.ts. Vercel signs cron requests with CRON_SECRET.
  const auth = authoriseCronRequest({
    authorizationHeader: request.headers.get('authorization'),
    secret: process.env.CRON_SECRET,
    isProduction: process.env.NODE_ENV === 'production',
  });

  if (!auth.authorised) {
    return NextResponse.json({ error: 'Unauthorised', reason: auth.reason }, { status: 401 });
  }

  const batchSize = Number(request.nextUrl.searchParams.get('batch') ?? DEFAULT_BATCH_SIZE);

  try {
    /*
     * **Sweeps first, then the drain.** Three sweeps existed and nothing called
     * any of them, which is not a theoretical gap: five `fetch_artwork` jobs sat
     * `failed` from August until this shipped, recoverable the whole time by a
     * command nobody ran. A sweep nobody calls is how a recovery path silently
     * stops being one.
     *
     * **They run before the drain so newly swept work can be drained in the same
     * invocation**, and they are sub-second database queries — they do not
     * compete meaningfully for the budget below. Measured on deployed data at
     * the time of writing: about nine artwork jobs and one expansion.
     *
     * **Failures are not swallowed.** If a sweep throws, the whole route returns
     * 500, for the same reason the drain does: ingestion failing silently is the
     * most likely way this system breaks without anyone noticing.
     */
    const swept = {
      artwork: await enqueueMissingArtwork(),
      tracklists: await enqueueMissingTracklists(),
      expansions: await enqueueFailedExpansions(),
    };

    const summary = await drainJobs(
      Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 50) : DEFAULT_BATCH_SIZE,
      undefined,
      { budgetMs: DRAIN_BUDGET_MS },
    );
    return NextResponse.json({ ...summary, swept, depth: await queueDepth() });
  } catch (error) {
    // Ingestion failing silently is the most likely way this system breaks
    // without anyone noticing, so surface it rather than returning 200.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
