'use server';

import { revalidatePath } from 'next/cache';

import {
  setAccountStatus,
  setListStatus,
  setReviewStatus,
  type UserStatus,
} from '@/services/admin';
import { settleReport } from '@/services/reports';

export type ModerationFormState = { error?: string; message?: string };

/**
 * Changes an account's status from the admin surface.
 *
 * **Returns rather than redirects.** The admin stays on the list and needs to
 * see what happened to the row they acted on — including a refusal, which is a
 * normal outcome here rather than an exception (`src/services/result.ts`).
 */
export async function moderateAccount(
  _prevState: ModerationFormState,
  formData: FormData,
): Promise<ModerationFormState> {
  const status = String(formData.get('status') ?? '') as UserStatus;

  /*
   * **Reasons are only read for a restriction.** Reinstating owes no statement
   * — `moderation_actions`' check constraint says so — and the service supplies
   * its own wording for that case. Passing empty strings here would turn a
   * valid reinstatement into a `statement_required` refusal.
   */
  const result = await setAccountStatus(
    String(formData.get('userId') ?? ''),
    status,
    status === 'active'
      ? undefined
      : {
          ground: String(formData.get('ground') ?? ''),
          statement: String(formData.get('statement') ?? ''),
        },
  );

  if (!result.ok) return { error: result.message };

  // Their content appears on album pages, lists, feeds and search, and every
  // one of those reads is cached. `architecture.md` §16.9.
  revalidatePath('/', 'layout');
  return { message: `${result.data.handle} is now ${result.data.status}.` };
}

/**
 * Settles a report without touching the content.
 *
 * **Dismissing writes no statement**, because nothing was restricted and DSA
 * Art 17 owes nothing. `architecture.md` §16.10g.
 */
export async function settleReportAction(
  _prevState: ModerationFormState,
  formData: FormData,
): Promise<ModerationFormState> {
  const state = String(formData.get('state') ?? '');
  if (state !== 'resolved' && state !== 'dismissed') return { error: 'Unknown action.' };

  const result = await settleReport(String(formData.get('reportId') ?? ''), state);
  if (!result.ok) return { error: result.message };

  revalidatePath('/admin');
  return { message: `Report ${state}.` };
}

/**
 * Removes the reported content and settles the report.
 *
 * **Two calls, and the order matters.** The removal writes the Art 17 statement
 * atomically with the status change (§16.10d); settling the report is a
 * separate fact about the queue. **If the removal fails the report stays open**,
 * which is the right way round — a settled report over live content would mean
 * nobody looks at it again.
 */
export async function moderateContentFromReport(
  _prevState: ModerationFormState,
  formData: FormData,
): Promise<ModerationFormState> {
  const kind = String(formData.get('kind') ?? '');
  const targetId = String(formData.get('targetId') ?? '');
  const reasons = {
    ground: String(formData.get('ground') ?? ''),
    statement: String(formData.get('statement') ?? ''),
  };

  const removal =
    kind === 'review'
      ? await setReviewStatus(targetId, 'removed', reasons)
      : kind === 'list'
        ? await setListStatus(targetId, 'removed', reasons)
        : null;

  if (!removal) return { error: 'That cannot be removed from here.' };
  if (!removal.ok) return { error: removal.message };

  const settled = await settleReport(String(formData.get('reportId') ?? ''), 'resolved');
  if (!settled.ok) return { error: settled.message };

  // The content leaves album pages, lists, feeds and search, all cached.
  revalidatePath('/', 'layout');
  return { message: 'Removed, and the author has been told why.' };
}
