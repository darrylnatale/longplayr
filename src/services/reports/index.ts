import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { getCurrentProfile } from '../profiles';
import { isRateLimited, RATE_LIMITED_MESSAGE } from '../rate-limit';
import { err, ok, type Result } from '../result';

/**
 * Somebody saying something is wrong — DSA Art 16.
 *
 * **Art 16 was already satisfied before this existed**, which is why this slice
 * came second. The address published on `/moderation` is the notice-and-action
 * channel for everybody, including signed-out visitors and authorities, and
 * `architecture.md` §16.10b records that it is what makes in-product reporting
 * signed-in-only lawful rather than a gap. **This adds convenience.**
 *
 * **Filing goes through the request-scoped client**, so the insert policy and
 * the rate-limit trigger both apply to the person's own token. **Reading the
 * queue goes through the service-role client**, because `authenticated` has
 * `select` on nothing at all — §16.10f. The reporter is told nothing about the
 * outcome (`product-spec.md` §4.2), so there is no read for them to make.
 */

export type ReportReason = 'spam' | 'harassment' | 'sexual_or_violent' | 'illegal' | 'other';

export type ReportTarget =
  { kind: 'review'; id: string } | { kind: 'list'; id: string } | { kind: 'account'; id: string };

export type ReportError = 'not_signed_in' | 'already_reported' | 'rate_limited' | 'rejected';

/** Postgres `unique_violation` — the one-open-report-per-target index. */
const UNIQUE_VIOLATION = '23505';
/** Postgres `check_violation` — a malformed combination the schema refuses. */
const CHECK_VIOLATION = '23514';

/**
 * The target, as three explicit shapes rather than one computed key.
 *
 * **A computed key defeats the generated types**, and the cast needed to
 * silence it would silence a wrong column name too. §98 fixed exactly this
 * mistake in `src/services/admin/` and the lesson is applied here rather than
 * relearned: three literals type-check against the schema, one clever lookup
 * does not.
 */
function targetColumns(target: ReportTarget) {
  switch (target.kind) {
    case 'review':
      return { review_id: target.id } as const;
    case 'list':
      return { list_id: target.id } as const;
    case 'account':
      return { subject_user_id: target.id } as const;
  }
}

/**
 * Files one report.
 *
 * **A duplicate is an outcome, not an error.** The partial unique index refuses
 * a second open report about the same thing, and `23505` becomes *you have
 * already reported this* — **which leaks nothing, because the reporter already
 * knows what they did.** §16.10f.
 *
 * **Free text is dropped for every reason but `other`.** The database refuses
 * it anyway (`reports_detail_only_on_other`), so sending it would turn a
 * mis-set form into a check violation the reader cannot act on.
 */
export async function fileReport(
  target: ReportTarget,
  reason: ReportReason,
  detail?: string,
): Promise<Result<{ reason: ReportReason }, ReportError>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('not_signed_in', 'Sign in to report something.');

  const supabase = await createClient();
  const trimmed = detail?.trim();

  const { error } = await supabase.from('reports').insert({
    reporter_id: profile.id,
    ...targetColumns(target),
    reason,
    detail: reason === 'other' && trimmed ? trimmed : null,
  });

  if (!error) return ok({ reason });

  if (error.code === UNIQUE_VIOLATION) {
    return err('already_reported', 'You have already reported this.');
  }
  if (isRateLimited(error)) {
    return err('rate_limited', RATE_LIMITED_MESSAGE);
  }
  if (error.code === CHECK_VIOLATION) {
    // Reaching this means the form sent a combination the schema forbids —
    // reporting yourself, or no target. Not the reader's fault to fix.
    return err('rejected', 'That cannot be reported.');
  }

  throw error;
}

/** One row of the admin queue. */
export type QueuedReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  createdAt: string;
  reporterHandle: string;
  target:
    | { kind: 'review'; id: string; preview: string; authorHandle: string }
    | { kind: 'list'; id: string; preview: string; authorHandle: string }
    | { kind: 'account'; id: string; preview: string; authorHandle: string };
};

/**
 * Open reports, oldest first.
 *
 * **Oldest first rather than newest**, which is the opposite of every other
 * list in the product: a notice that has waited longest is the one most
 * overdue, and a queue sorted newest-first starves its own backlog.
 *
 * **Unpaginated, like `listAccounts`**, and for the same reason — a page
 * control on a list of two would be ceremony. It needs one at the same
 * threshold that list does.
 *
 * Returns an empty list for anybody who is not an admin, rather than throwing:
 * the admin surface answers `notFound()` for a non-admin, and this must not be
 * the thing that reveals the route exists.
 */
export async function listOpenReports(): Promise<QueuedReport[]> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('reports')
    .select(
      `id, reason, detail, created_at, review_id, list_id, subject_user_id,
       reporter:profiles!reports_reporter_id_fkey(handle),
       review:reviews(body, collection_entry:collection_entries(user:profiles(handle))),
       list:lists(title, user:profiles(handle)),
       subject:profiles!reports_subject_user_id_fkey(handle)`,
    )
    .eq('state', 'open')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).flatMap((row): QueuedReport[] => {
    const base = {
      id: row.id,
      reason: row.reason,
      detail: row.detail,
      createdAt: row.created_at,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reporterHandle: (row.reporter as any)?.handle ?? 'unknown',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const review = row.review as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = row.list as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subject = row.subject as any;

    if (row.review_id && review) {
      return [
        {
          ...base,
          target: {
            kind: 'review',
            id: row.review_id,
            preview: String(review.body ?? '').slice(0, 300),
            authorHandle: review.collection_entry?.user?.handle ?? 'unknown',
          },
        },
      ];
    }
    if (row.list_id && list) {
      return [
        {
          ...base,
          target: {
            kind: 'list',
            id: row.list_id,
            preview: String(list.title ?? ''),
            authorHandle: list.user?.handle ?? 'unknown',
          },
        },
      ];
    }
    if (row.subject_user_id && subject) {
      return [
        {
          ...base,
          target: {
            kind: 'account',
            id: row.subject_user_id,
            preview: `@${subject.handle}`,
            authorHandle: subject.handle,
          },
        },
      ];
    }

    // A report whose target vanished between the query and now. Dropped rather
    // than rendered half-empty — the cascade means it will not come back.
    return [];
  });
}

/**
 * Marks a report settled.
 *
 * **It does not act on the content.** Resolving records that the notice was
 * dealt with; removing the content is a separate call through
 * `src/services/admin/`, which is what writes the Art 17 statement. **Keeping
 * them separate is deliberate** — an administrator may dismiss a notice, or act
 * without one, and §16.10g makes the link nullable for exactly that reason.
 */
export async function settleReport(
  reportId: string,
  state: 'resolved' | 'dismissed',
): Promise<Result<{ id: string }, 'not_admin' | 'not_found'>> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return err('not_admin', 'You do not have access to this.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('reports')
    .update({ state, settled_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('state', 'open')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) return err('not_found', 'That report is no longer open.');

  return ok({ id: data.id });
}
