'use server';

import { fileReport, type ReportReason, type ReportTarget } from '@/services/reports';

export type ReportFormState = { error?: string; filed?: boolean };

/**
 * Files a report from wherever the control is rendered.
 *
 * **Shared by all three targets rather than one action each.** The target kind
 * arrives in the form, is narrowed here, and anything else is refused — which
 * is the same validation a per-target action would do, in one place.
 *
 * **No `revalidatePath`.** Filing a report changes nothing anybody can see: the
 * content stays visible until an administrator acts (`product-spec.md` §4.2),
 * and the reporter is never told the outcome. Revalidating would imply
 * otherwise and would discard caches for no reason.
 */
export async function reportAction(
  _prevState: ReportFormState,
  formData: FormData,
): Promise<ReportFormState> {
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '') as ReportReason;
  const detail = String(formData.get('detail') ?? '');

  if (kind !== 'review' && kind !== 'list' && kind !== 'account') {
    return { error: 'That cannot be reported.' };
  }
  if (!id) return { error: 'That cannot be reported.' };

  const target = { kind, id } as ReportTarget;
  const result = await fileReport(target, reason, detail);

  if (!result.ok) return { error: result.message };
  return { filed: true };
}
