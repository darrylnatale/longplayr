'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { HANDLE_MAX_LENGTH } from '@/services/profiles/handle';

import { chooseHandle } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-muted disabled:opacity-50"
    >
      {pending ? 'Claiming…' : 'Claim handle'}
    </button>
  );
}

export function HandleForm() {
  const [state, formAction] = useActionState(chooseHandle, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="handle" className="text-sm text-muted">
          Handle
        </label>
        <div className="flex items-center rounded-md border border-border bg-surface focus-within:border-muted">
          <span className="pl-3 text-sm text-muted">longplayr.com/</span>
          <input
            id="handle"
            name="handle"
            required
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={HANDLE_MAX_LENGTH}
            aria-describedby={state.error ? 'handle-error' : 'handle-hint'}
            className="flex-1 bg-transparent py-2 pr-3 text-sm outline-none"
          />
        </div>
        {state.error ? (
          <p id="handle-error" role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        ) : (
          <p id="handle-hint" className="text-sm text-muted">
            Letters, numbers and underscores. This is your profile address.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="displayName" className="text-sm text-muted">
          Display name <span className="text-muted/70">(optional)</span>
        </label>
        <input
          id="displayName"
          name="displayName"
          maxLength={50}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-muted"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
