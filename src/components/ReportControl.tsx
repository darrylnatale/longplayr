'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { reportAction } from '@/app/report/actions';

/**
 * Report a review, a list or an account — DSA Art 16.
 *
 * **Behind a disclosure, deliberately.** Reporting is rare and consequential;
 * a visible control on every review invites misuse and crowds the surface that
 * matters. The same treatment suspension got in `AccountRow` after §98, and for
 * the same reason: ceremony belongs in front of the uncommon action.
 *
 * **Free text appears only for _Something else_.** `product-spec.md` §7 defers
 * comments as the largest moderation liability in the product, so free text is
 * admitted in exactly one place — and the database refuses it anywhere else,
 * which is what actually holds the line (`architecture.md` §16.10f).
 *
 * **It says what will and will not happen.** Filing changes nothing visible,
 * and the reporter is never told the outcome (`product-spec.md` §4.2). Saying
 * so is the honest alternative to a thank-you that implies a process.
 */

const REASONS: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'sexual_or_violent', label: 'Sexual or violent content' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'other', label: 'Something else' },
];

const FIELD =
  'mt-1 block w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? '…' : 'Report'}
    </button>
  );
}

export function ReportControl({
  kind,
  id,
  label = 'Report',
}: {
  kind: 'review' | 'list' | 'account';
  id: string;
  label?: string;
}) {
  const [state, formAction] = useActionState(reportAction, {});

  if (state.filed) {
    return (
      <p role="status" className="text-xs text-text-muted">
        Reported. Nothing changes straight away, and you will not be told the outcome.
      </p>
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-text-muted transition-colors hover:text-text">
        {label}
      </summary>

      <form action={formAction} className="mt-2 flex max-w-sm flex-col gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />

        <label className="text-text-muted">
          Reason
          <select name="reason" required defaultValue="" className={FIELD}>
            <option value="" disabled>
              Choose one
            </option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {/*
         * Always rendered rather than revealed by the select, because toggling
         * it needs client state this control does not otherwise have. The
         * database drops it for every reason but `other`, so an unused value is
         * discarded rather than stored.
         */}
        <label className="text-text-muted">
          Anything else (only used for “Something else”)
          <textarea name="detail" rows={2} maxLength={1000} className={FIELD} />
        </label>

        <span>
          <Submit />
        </span>

        {state.error && (
          <span role="alert" className="text-danger-text">
            {state.error}
          </span>
        )}
      </form>
    </details>
  );
}
