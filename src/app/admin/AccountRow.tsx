'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { ModeratableAccount } from '@/services/admin';

import { moderateAccount } from './actions';

/**
 * One account, with the action that applies to it.
 *
 * **No confirmation step.** Suspension is reversible, and this product reserves
 * confirmation for irreversible actions — `EditListForm`'s disclosure treatment
 * says so, and account deletion's handle-typing is the other end of that scale.
 * Ceremony in front of a reversible action teaches people to click through it.
 */

const BUTTON =
  'rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50';

const FIELD =
  'mt-1 block w-full rounded-sm border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none';

const DESTRUCTIVE =
  'rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50';

function Submit({ label, destructive }: { label: string; destructive?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={destructive ? DESTRUCTIVE : BUTTON}>
      {pending ? '…' : label}
    </button>
  );
}

export function AccountRow({ account }: { account: ModeratableAccount }) {
  const [state, formAction] = useActionState(moderateAccount, {});
  const active = account.status === 'active';

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border py-3">
      <span className="min-w-0 flex-1">
        <span className="text-text">{account.handle}</span>
        {account.displayName && (
          <span className="ml-2 text-sm text-text-muted">{account.displayName}</span>
        )}
        {account.isAdmin && (
          <span className="ml-2 text-xs uppercase tracking-widest text-accent">admin</span>
        )}
      </span>

      <span className="tabular text-xs text-text-muted">{account.status}</span>

      {/*
       * An admin's own row, and any other admin's, carries no control at all
       * rather than a disabled one. The service refuses both regardless — this
       * only keeps the surface honest about what it offers.
       */}
      {/*
       * **Suspending now asks why, and reinstating still does not.** The person
       * is told what this says — DSA Art 17, `architecture.md` §16.10 — so the
       * field is required rather than optional, and the database refuses a
       * restriction without it whatever this form sends.
       *
       * **The disclosure is the point, not decoration.** The earlier version was
       * a bare button, which is right for a reversible action but wrong for one
       * that writes a statement somebody reads. Reinstating keeps the bare
       * button, because it owes nothing and undoes rather than does.
       */}
      {!account.isAdmin &&
        (active ? (
          <details className="w-full">
            <summary className="cursor-pointer text-xs font-medium text-danger-text">
              Suspend…
            </summary>
            <form action={formAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="userId" value={account.id} />
              <input type="hidden" name="status" value="suspended" />
              <label className="text-xs text-text-muted">
                Ground
                <input
                  name="ground"
                  required
                  placeholder="what rule this breaches"
                  className={FIELD}
                />
              </label>
              <label className="text-xs text-text-muted">
                What they are told
                <textarea
                  name="statement"
                  required
                  rows={3}
                  placeholder="They read this. Say what happened and why."
                  className={FIELD}
                />
              </label>
              <span>
                <Submit label="Suspend" destructive />
              </span>
            </form>
          </details>
        ) : (
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="userId" value={account.id} />
            <input type="hidden" name="status" value="active" />
            <Submit label="Reinstate" />
          </form>
        ))}

      {state.error && (
        <span role="alert" className="w-full text-xs text-danger-text">
          {state.error}
        </span>
      )}
      {state.message && <span className="w-full text-xs text-text-muted">{state.message}</span>}
    </li>
  );
}
