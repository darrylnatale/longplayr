'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, INPUT, SUBMIT } from '@/components/Field';

import { requestReset } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={SUBMIT}>
      {pending ? 'Sending…' : 'Send reset link'}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestReset, {});

  if (state.sent) {
    return (
      <p className="text-sm leading-relaxed text-text-muted">
        If that address has an account, a reset link is on its way. It expires shortly, so use it
        soon — and check your spam folder if it does not appear.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field id="email" label="Email" error={state.fieldError}>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={INPUT}
        />
      </Field>
      <SubmitButton />
    </form>
  );
}
