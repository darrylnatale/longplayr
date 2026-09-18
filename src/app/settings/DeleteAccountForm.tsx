'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, INPUT } from '@/components/Field';
import { confirmationMatches } from '@/services/auth/delete-confirmation';

import { deleteAccount } from './actions';

/**
 * The delete-account control.
 *
 * **The button stays disabled until the handle is typed correctly.** The server
 * checks the same thing and is the real gate — this is about not letting
 * someone reach a one-way action by reflex. `product-spec.md` §6, Settings.
 *
 * **Destructive styling rather than the shared `SUBMIT`.** Every other primary
 * action in the product is brass; this one must not look like them.
 *
 * **It reuses the tinted-outline treatment `ActionCard` and `EditListForm`
 * already use for removal**, at primary size, rather than introducing a solid
 * red fill. A new destructive style on the one screen that most needs to look
 * familiar would be a poor place to start a second convention — and
 * `--color-danger` is documented as *"not legible as text"*, so a solid fill
 * would need a contrast pairing this palette does not define.
 */

const DESTRUCTIVE =
  'w-full rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm font-medium text-danger-text transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50';

function SubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || !enabled} className={DESTRUCTIVE}>
      {pending ? 'Deleting…' : 'Delete my account'}
    </button>
  );
}

export function DeleteAccountForm({ handle }: { handle: string }) {
  const [state, formAction] = useActionState(deleteAccount, {});
  const [typed, setTyped] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        id="confirmation"
        label={`Type ${handle} to confirm`}
        hint="This cannot be undone, and the handle cannot be used again."
        error={state.error}
      >
        <input
          id="confirmation"
          name="confirmation"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-describedby={state.error ? 'confirmation-error' : 'confirmation-hint'}
          className={INPUT}
        />
      </Field>

      <SubmitButton enabled={confirmationMatches(typed, handle)} />
    </form>
  );
}
