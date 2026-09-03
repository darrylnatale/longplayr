import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import { countRows, COUNT_ONLY } from '../count';

import { err, ok, type Result } from '../result';
import { getCurrentProfile, getCurrentUser } from '../profiles';
import { findHeldAlbum, ingestReleaseGroup, reconcileCredits } from './ingest';
import { enqueueJob } from './jobs';
import { INTERACTIVE_JOB_PRIORITY } from './queue';
import { searchReleaseGroups, type MbReleaseGroup } from './musicbrainz';
import { classify } from './scope';

/**
 * Self-service catalogue additions.
 *
 * When a record is missing, users add it themselves rather than waiting for an
 * admin: the data comes from MusicBrainz, so there is no editorial judgement
 * for a human to exercise. The real risks are out-of-scope records and bulk
 * junk, which a scope filter and a rate limit handle better than a queue.
 */

/**
 * A service-role client.
 *
 * Injectable on `remainingAllowance` for one reason only: the fail-open this
 * module used to have is unreachable in a test unless the count can be made to
 * fail, and the alternative was mutating a schema. Same shape and same default
 * as `jobs.ts`, which established the pattern. **Not a dependency-injection
 * convention** — nothing else here takes a client.
 */
type Admin = SupabaseClient<Database>;

export const RATE_LIMIT_PER_HOUR = 30;
export const RATE_LIMIT_PER_DAY = 100;

export type AddError =
  | 'unauthenticated'
  | 'onboarding_required'
  | 'out_of_scope'
  | 'rate_limited'
  | 'already_present'
  | 'upstream_unavailable';

export type UpstreamCandidate = {
  mbid: string;
  title: string;
  credit: string;
  year: string | null;
  primaryType: string | null;
};

function renderCredit(group: MbReleaseGroup): string {
  return (
    (group['artist-credit'] ?? [])
      .map((credit) => `${credit.name}${credit.joinphrase ?? ''}`)
      .join('')
      .trim() || 'Unknown Artist'
  );
}

/**
 * Searches MusicBrainz for records we do not hold.
 *
 * Returns an empty list rather than throwing when MusicBrainz is unreachable —
 * including when the contact guard is blocking calls. A missing fallback should
 * quietly leave local results as they are, not break the search page.
 */
export async function searchUpstream(query: string, limit = 10): Promise<UpstreamCandidate[]> {
  let result: Awaited<ReturnType<typeof searchReleaseGroups>>;
  try {
    result = await searchReleaseGroups(query, limit * 2);
  } catch {
    return [];
  }

  const admin = createAdminClient();

  const inScope = (result['release-groups'] ?? []).filter((group) => classify(group).inScope);
  if (inScope.length === 0) return [];

  // Hide anything we already hold; it is in the local results above.
  const { data: existing } = await admin
    .from('albums')
    .select('mbid')
    .in(
      'mbid',
      inScope.map((g) => g.id),
    );

  const held = new Set((existing ?? []).map((row) => row.mbid));

  return inScope
    .filter((group) => !held.has(group.id))
    .slice(0, limit)
    .map((group) => ({
      mbid: group.id,
      title: group.title,
      credit: renderCredit(group),
      year: group['first-release-date']?.slice(0, 4) ?? null,
      primaryType: group['primary-type'] ?? null,
    }));
}

/** Remaining additions allowed for a user in each window. */
export async function remainingAllowance(
  userId: string,
  admin: Admin = createAdminClient(),
): Promise<{ hour: number; day: number }> {
  const now = Date.now();

  const [hour, day] = await Promise.all(
    (
      [
        [3_600_000, 'catalogue_additions.hour_window'],
        [86_400_000, 'catalogue_additions.day_window'],
      ] as const
    ).map(([windowMs, label]) =>
      countRows(
        admin
          .from('catalogue_additions')
          .select('id', COUNT_ONLY)
          .eq('user_id', userId)
          .gte('created_at', new Date(now - windowMs).toISOString()),
        label,
      ),
    ),
  );

  return {
    hour: Math.max(0, RATE_LIMIT_PER_HOUR - hour),
    day: Math.max(0, RATE_LIMIT_PER_DAY - day),
  };
}

/**
 * Adds one release group to the catalogue on a user's behalf.
 *
 * Fetched inline rather than queued: this is the fast path, and making someone
 * wait behind a seeding backlog for the one record they asked for would be the
 * wrong trade. Artwork is queued separately, since it is not needed to render
 * the page they are about to visit.
 */
export async function addAlbumFromUpstream(
  mbid: string,
): Promise<Result<{ mbid: string }, AddError>> {
  const user = await getCurrentUser();
  if (!user) return err('unauthenticated', 'You need to be signed in to add a record.');

  // A profile is required, and not for presentation.
  //
  // catalogue_additions.user_id is a foreign key to `profiles`, not to
  // auth.users. An authenticated user who has not finished onboarding has no
  // profile row, so the audit insert violates that key — and because its error
  // was discarded, the album was still written, the artwork job still queued,
  // and nothing recorded who did it. remainingAllowance counts exactly those
  // rows, so such a user was also not rate limited at all.
  //
  // Refusing here closes both holes at the source: no addition can be made by
  // anyone the audit table is structurally unable to reference.
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before adding to the catalogue.');
  }

  const allowance = await remainingAllowance(user.id);
  if (allowance.hour <= 0 || allowance.day <= 0) {
    return err(
      'rate_limited',
      `You have reached the limit of ${RATE_LIMIT_PER_HOUR} additions an hour, ${RATE_LIMIT_PER_DAY} a day.`,
    );
  }

  const admin = createAdminClient();

  const held = await findHeldAlbum(admin, mbid);
  if (held) {
    // Held is not the same as complete. An interrupted ingest can leave an
    // album row whose credits were never written, and the check this replaced
    // could not tell the difference — so the album stayed unreachable from its
    // own artist page, permanently.
    //
    // **Still no upstream request, which is the whole point of this branch.**
    // The repair reads the stored payload, so an add of an album we already
    // hold stays as cheap as it was — this path runs while a reader waits.
    //
    // The outcome is deliberately not surfaced to the user. Nothing was added,
    // which is what they asked about; a repair that did or did not happen to a
    // record they already had is not their business, and inventing an error for
    // it would report a failure where the request succeeded.
    if (!held.hasCredits) await reconcileCredits(admin, held.id, mbid);
    return ok({ mbid });
  }

  let result: Awaited<ReturnType<typeof ingestReleaseGroup>>;
  try {
    result = await ingestReleaseGroup(mbid, admin);
  } catch (error) {
    return err(
      'upstream_unavailable',
      error instanceof Error ? error.message : 'MusicBrainz is unavailable right now.',
    );
  }

  if (result.status === 'out_of_scope') {
    return err('out_of_scope', `longplayr does not catalogue this: ${result.reason}.`);
  }

  // The audit row is the invariant: an addition that reaches the catalogue must
  // never exist without one, because it answers "who added what" and it is what
  // the rate limit counts.
  //
  // Checked, unlike before. With the profile guard above a foreign-key
  // violation should now be impossible, so a failure here is genuinely
  // unexpected — and per src/services/result.ts, unexpected failures throw
  // rather than being folded into a Result the UI would render as a polite
  // message. Silently swallowing it is what created the hole.
  const { error: auditError } = await admin
    .from('catalogue_additions')
    .insert({ user_id: profile.id, album_mbid: mbid });
  if (auditError) throw auditError;

  // Elevated priority: someone is looking at this record now, and it is the
  // one job in the queue with a person attached to it. The server action drains
  // a small batch immediately afterwards through `after()`, so in practice the
  // cover lands seconds after the add rather than on the next daily cron.
  await enqueueJob('fetch_artwork', mbid, { admin, priority: INTERACTIVE_JOB_PRIORITY });

  return ok({ mbid });
}
