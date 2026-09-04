'use client';

import { useActionState } from 'react';

import { createListAction, type CreateListState } from '@/app/[handle]/lists/actions';

/**
 * The owner's create-a-list form, shown only on their own lists destination.
 *
 * **A plain form posting a server action**, matching every other mutation in the
 * product. There is no client-side validation beyond `required`: the service
 * owns the rules and returns a `Result` whose message is what renders here, so a
 * native client would refuse the same input for the same reason.
 */
export function CreateListForm({ handle }: { handle: string }) {
  const [state, action, pending] = useActionState<CreateListState, FormData>(
    createListAction.bind(null, handle),
    {},
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="list-title" className="text-sm text-text-secondary">
          Title
        </label>
        <input
          id="list-title"
          name="title"
          required
          maxLength={120}
          placeholder="Records for a long drive"
          className="w-full min-w-0 rounded-md border border-border bg-raised px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="list-description" className="text-sm text-text-secondary">
          Description <span className="ml-1.5 text-text-faint">optional</span>
        </label>
        <textarea
          id="list-description"
          name="description"
          rows={2}
          maxLength={2000}
          className="w-full min-w-0 resize-y rounded-md border border-border bg-raised px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-accent"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" name="is_ranked" className="accent-accent" />
        Ranked — the order is part of the point
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-danger-text">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm border border-border bg-raised px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-border-strong disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create list'}
      </button>
    </form>
  );
}
