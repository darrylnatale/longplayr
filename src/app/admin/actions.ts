'use server';

import { revalidatePath } from 'next/cache';

import { setAccountStatus, type UserStatus } from '@/services/admin';

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
