'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { BARE_INPUT, Field, INPUT, INPUT_SHELL, SUBMIT } from '@/components/Field';
import { HANDLE_MAX_LENGTH } from '@/services/profiles/handle';

import { chooseHandle } from './actions';

/**
 * Handle selection.
 *
 * Behaviour is untouched — same action, same `Result`-shaped error surfacing,
 * same `maxLength`, same autocapitalise and spellcheck suppression, same
 * optional display name. A taken handle is an expected outcome the form
 * renders, not an exception (src/services/result.ts).
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={SUBMIT}>
      {pending ? 'Claiming…' : 'Claim handle'}
    </button>
  );
}

export function HandleForm() {
  const [state, formAction] = useActionState(chooseHandle, {});

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        id="handle"
        label="Handle"
        hint="Letters, numbers and underscores. This is your profile address."
        error={state.error}
      >
        {/*
         * The address prefix sits inside the field rather than above it, so the
         * handle reads as the tail of a URL while it is being typed. The
         * wrapper owns the border and the focus state; the input is bare.
         */}
        <div className={INPUT_SHELL}>
          {/*
           * Divided from the input and set at chrome weight. Faint and
           * undivided, it read as placeholder text sitting inside an empty
           * field — something you might try to delete before typing.
           */}
          <span className="shrink-0 select-none border-r border-border py-2.5 pl-3 pr-3 text-base text-text-muted">
            longplayr.com/
          </span>
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
            className={`${BARE_INPUT} pl-3`}
          />
        </div>
      </Field>

      <Field id="displayName" label="Display name" optional>
        <input id="displayName" name="displayName" maxLength={50} className={INPUT} />
      </Field>

      <SubmitButton />
    </form>
  );
}
