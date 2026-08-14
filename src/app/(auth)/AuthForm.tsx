'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AuthFormState } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-muted disabled:opacity-50"
    >
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

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm text-muted">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-muted"
        />
        {state.fieldErrors?.email && (
          <p id="email-error" className="text-sm text-red-400">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={submitLabel === 'Create account' ? 'new-password' : 'current-password'}
          required
          aria-describedby={state.fieldErrors?.password ? 'password-error' : 'password-hint'}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-muted"
        />
        {passwordHint && !state.fieldErrors?.password && (
          <p id="password-hint" className="text-sm text-muted">
            {passwordHint}
          </p>
        )}
        {state.fieldErrors?.password && (
          <p id="password-error" className="text-sm text-red-400">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
