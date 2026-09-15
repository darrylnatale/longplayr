'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BARE_INPUT, Field, INPUT, INPUT_SHELL, SUBMIT } from '@/components/Field';

import type { AuthFormState } from './actions';

/**
 * Credentials form, shared by sign in and create account.
 *
 * Behaviour is untouched: the same `useActionState` wiring, the same server
 * action contract, the same field and form-level error shapes, the same
 * `autoComplete` switch keyed off the submit label. Only the presentation moved
 * onto the design foundation.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={SUBMIT}>
      {pending ? 'Working…' : label}
    </button>
  );
}

export function AuthForm({
  action,
  submitLabel,
  passwordHint,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  passwordHint?: string;
}) {
  const [state, formAction] = useActionState(action, {});

  const isSignUp = submitLabel === 'Create account';

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field id="email" label="Email" error={state.fieldErrors?.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          className={INPUT}
        />
      </Field>

      <Field id="password" label="Password" hint={passwordHint} error={state.fieldErrors?.password}>
        {/*
         * Wrapped rather than bare so the field keeps one focus ring whatever
         * sits inside it, matching the handle field's prefixed input.
         */}
        <div className={INPUT_SHELL}>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            aria-describedby={
              state.fieldErrors?.password
                ? 'password-error'
                : passwordHint
                  ? 'password-hint'
                  : undefined
            }
            className={`${BARE_INPUT} pl-3`}
          />
        </div>
      </Field>

      {/*
       * **Signup only.** A second password box on a sign-in form is a usability
       * defect, not a safety measure: there is nothing to confirm when the
       * password already exists. `architecture.md` §6.
       */}
      {isSignUp && (
        <Field
          id="confirmPassword"
          label="Confirm password"
          error={state.fieldErrors?.confirmPassword}
        >
          <div className={INPUT_SHELL}>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby={
                state.fieldErrors?.confirmPassword ? 'confirmPassword-error' : undefined
              }
              className={`${BARE_INPUT} pl-3`}
            />
          </div>
        </Field>
      )}

      {/*
       * Form-level failure — a rejected credential rather than a malformed
       * field. Given its own panel so it reads as a state of the form rather
       * than as a note about whichever input happens to sit above it.
       */}
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger-text"
        >
          {state.error}
        </p>
      )}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
