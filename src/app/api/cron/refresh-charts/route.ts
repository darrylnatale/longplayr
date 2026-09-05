import { NextResponse, type NextRequest } from 'next/server';

import { authoriseCronRequest } from '@/services/catalogue/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Recomputes the discovery charts.
 *
 * Invoked on a schedule in deployed environments. `product-spec.md` §8.3 decides
 * a cached table rather than per-request computation, and the recomputation is
 * one RPC — everything interesting lives in the database function, which is what
 * makes the replacement transactional.
 *
 * **A separate route from the queue drain, deliberately.** The drain's budget is
 * spent on rate-limited MusicBrainz work with fifteen seconds of headroom for an
 * overrunning artwork job; adding unrelated work would spend the headroom that
 * exists for exactly that. More importantly the two must not share a failure
 * domain — a MusicBrainz outage returns 500 from the drain, and taking chart
 * recomputation down with it would be gratuitous. They touch no common table and
 * no common external service.
 *
 * **Daily, against §8.3's hourly intent.** Vercel's Hobby plan caps cron at once
 * per day and a more frequent expression fails at deploy time. That is a platform
 * constraint recorded as a divergence rather than a revision — `architecture.md`
 * §8. Hobby also allows a hundred cron jobs per project, so a second entry costs
 * nothing; and its scheduling precision is +/-59 minutes, so this run and the
 * 04:00 drain can in principle overlap. Harmless: no shared table, no shared
 * budget.
 */

export const dynamic = 'force-dynamic';

/**
 * The platform's execution ceiling for this route.
 *
 * A literal for the same reason the drain's is: route segment config is
 * extracted by static analysis at build time. No budget is derived from it here,
 * because the work is one statement rather than a queue of rate-limited jobs.
 */
export const maxDuration = 60;

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

  try {
    // Service role, because the chart aggregates every user's collection and the
    // function is executable by nothing else.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('refresh_popular_this_week');

    if (error) throw error;

    return NextResponse.json({ chart: 'popular_this_week', rows: data ?? 0 });
  } catch (error) {
    // **Never a silent success.** A chart that stopped refreshing looks exactly
    // like a chart nobody is adding to, so the failure has to be loud. Browse is
    // unaffected either way: the previous snapshot survives a failed refresh, and
    // the fallback covers an empty one.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
