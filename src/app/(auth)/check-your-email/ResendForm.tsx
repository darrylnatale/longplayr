'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { resendConfirmationEmail, type ResendState } from '../actions';

/**
 * Resend control on the confirmation page. `architecture.md` §6.
 *
 * **It confirms sending for any well-formed address, including one with no
 * account.** That is the decision, not a bug: a differing response would tell
 * an attacker which addresses are registered, and an email address is not
 * public in longplayr even though a handle is.
 *
 * **The copy says "if that address has an account"** so the message is true in
 * both cases rather than merely uninformative in one.
 */

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Sending…' : 'Send it again'}
    </button>
  );
}

export function ResendForm({ address }: { address: string | null }) {
  const [state, formAction] = useActionState<ResendState, FormData>(resendConfirmationEmail, {});

  if (state.sent) {
    return (
      <p className="text-sm text-text-muted" data-testid="resend-sent">
        Sent. If that address has an account, another link is on its way — it can take a minute or
        two.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {address ? (
        <input type="hidden" name="email" value={address} />
      ) : (
        <label className="text-sm text-text-secondary">
          Your email address
          <input
            type="email"
            name="email"
            required
            className="mt-1 block w-full rounded-sm border border-border bg-transparent px-3 py-2 text-base text-text"
          />
        </label>
      )}

      <p className="text-sm text-text-muted">
        Didn&rsquo;t get it? <ResendButton />
      </p>

      {state.error && (
        <p className="text-sm text-danger-text" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
