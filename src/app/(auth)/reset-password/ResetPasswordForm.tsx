'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, INPUT, SUBMIT } from '@/components/Field';
import { PASSWORD_HINT } from '@/services/auth/password-policy';

import { resetPassword } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={SUBMIT}>
      {pending ? 'Saving…' : 'Set new password'}
    </button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPassword, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <p role="alert" className="text-sm text-danger-text">
          {state.error}
        </p>
      )}

      <Field
        id="password"
        label="New password"
        hint={PASSWORD_HINT}
        error={state.fieldErrors?.password}
      >
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          className={INPUT}
        />
      </Field>

      {/*
       * Typed twice for the same reason signup does it: a password typed once
       * and mistyped is a lockout — and on this form that is the exact failure
       * the whole flow exists to repair.
       */}
      <Field
        id="confirmPassword"
        label="Confirm new password"
        error={state.fieldErrors?.confirmPassword}
      >
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className={INPUT}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
