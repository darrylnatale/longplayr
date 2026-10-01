'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { QueuedReport } from '@/services/reports';

import { moderateContentFromReport, settleReportAction } from './actions';

/**
 * One open report, with the two things an administrator can do about it.
 *
 * **Dismiss and Remove are separate actions, not one control with a toggle.**
 * Settling a report records that the notice was dealt with; removing the
 * content writes the Art 17 statement the author reads. **An administrator may
 * do either without the other** — dismiss a baseless notice, or remove content
 * nobody reported — which is why `moderation_actions.report_id` is nullable
 * (`architecture.md` §16.10g).
 *
 * **Removing asks for the statement here.** It is the same requirement
 * `AccountRow` carries: the database refuses a restriction without one, so the
 * form asks rather than letting the write fail.
 */

const REASON_LABEL: Record<QueuedReport['reason'], string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or hate',
  sexual_or_violent: 'Sexual or violent content',
  illegal: 'Illegal content',
  other: 'Something else',
};

const BUTTON =
  'rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50';

const DESTRUCTIVE =
  'rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50';

const FIELD =
  'mt-1 block w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none';

function Submit({ label, destructive }: { label: string; destructive?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={destructive ? DESTRUCTIVE : BUTTON}>
      {pending ? '…' : label}
    </button>
  );
}

export function ReportRow({ report }: { report: QueuedReport }) {
  const [settleState, settleAction] = useActionState(settleReportAction, {});
  const [removeState, removeAction] = useActionState(moderateContentFromReport, {});

  const removable = report.target.kind !== 'account';
  const message = settleState.message ?? removeState.message;
  const error = settleState.error ?? removeState.error;

  /*
   * **The confirmation is a flash, not a state, and that is deliberate.** Both
   * actions revalidate, so the queue re-renders without this row and the
   * message unmounts with it. **The row disappearing is the real feedback** —
   * the message only covers the moment before the refresh lands.
   *
   * An error is different: it means the row is still there and still needs
   * dealing with, so it renders in place rather than replacing the row.
   */
  if (message) {
    return (
      <li className="border-b border-border py-3 text-xs text-text-muted" role="status">
        {message}
      </li>
    );
  }

  return (
    <li className="border-b border-border py-4">
      <p className="text-sm text-text">
        <span className="uppercase tracking-widest text-accent">{report.target.kind}</span>{' '}
        <span className="text-text-muted">by</span>{' '}
        <Link href={`/${report.target.authorHandle}`} className="hover:underline">
          @{report.target.authorHandle}
        </Link>
      </p>

      {/*
       * The preview is what makes a queue usable rather than a list of
       * identifiers — `development-plan.md` Phase 6 asks for it by name. Capped
       * in the service at 300 characters so one long review cannot push the
       * rest of the queue off the screen.
       */}
      <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
        {report.target.preview}
      </p>

      <p className="mt-2 text-xs text-text-muted">
        {REASON_LABEL[report.reason]} · reported by @{report.reporterHandle}
      </p>

      {report.detail && (
        <p className="mt-1 max-w-prose text-xs italic text-text-muted">“{report.detail}”</p>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <form action={settleAction}>
          <input type="hidden" name="reportId" value={report.id} />
          <input type="hidden" name="state" value="dismissed" />
          <Submit label="Dismiss" />
        </form>

        {removable && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-danger-text">
              Remove…
            </summary>
            <form action={removeAction} className="mt-2 flex w-72 flex-col gap-2">
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="kind" value={report.target.kind} />
              <input type="hidden" name="targetId" value={report.target.id} />
              <label className="text-xs text-text-muted">
                Ground
                <input name="ground" required className={FIELD} />
              </label>
              <label className="text-xs text-text-muted">
                What the author is told
                <textarea name="statement" required rows={3} className={FIELD} />
              </label>
              <span>
                <Submit label="Remove" destructive />
              </span>
            </form>
          </details>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger-text">
          {error}
        </p>
      )}
    </li>
  );
}
