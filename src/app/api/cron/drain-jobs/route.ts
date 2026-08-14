import { NextResponse, type NextRequest } from 'next/server';

import { drainJobs, queueDepth } from '@/services/catalogue/jobs';

/**
 * Drains the ingestion queue.
 *
 * Invoked on a schedule in deployed environments. Kept small on purpose: it
 * claims a batch, runs it, and reports. Everything interesting lives in the
 * service layer.
 *
 * Batch size is bounded by the MusicBrainz rate limit rather than by execution
 * speed — ten jobs is roughly ten seconds of wall time, comfortably inside a
 * serverless timeout while making steady progress.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_BATCH_SIZE = 10;

/**
 * Vercel signs cron requests with CRON_SECRET. Without it this endpoint would
 * let anyone drive our MusicBrainz budget.
 */
function isAuthorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  // No secret configured: allow only outside production, so local development
  // works while a misconfigured deployment fails closed rather than open.
  if (!secret) return process.env.NODE_ENV !== 'production';

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const batchSize = Number(request.nextUrl.searchParams.get('batch') ?? DEFAULT_BATCH_SIZE);

  try {
    const summary = await drainJobs(
      Number.isFinite(batchSize) && batchSize > 0 ? Math.min(batchSize, 50) : DEFAULT_BATCH_SIZE,
    );
    return NextResponse.json({ ...summary, depth: await queueDepth() });
  } catch (error) {
    // Ingestion failing silently is the most likely way this system breaks
    // without anyone noticing, so surface it rather than returning 200.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
