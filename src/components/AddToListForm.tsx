'use client';

import { useActionState } from 'react';

import type { ListActionState } from '@/app/lists/[id]/actions';

/**
 * "Add to list", on an album page.
 *
 * **Rendered only when the viewer already has a list**, because a select with no
 * options is a control that cannot work. Someone with no lists is pointed at
 * their lists destination instead — the same reasoning as the profile's
 * no-empty-scaffold rule: do not render a mechanism that implies capability it
 * does not have.
 *
 * The duplicate case comes back as a message rather than an error page: an album
 * is in a list at most once, and trying twice is an ordinary thing to do.
 */
export function AddToListForm({
  albumId,
  lists,
  action,
}: {
  albumId: string;
  lists: { id: string; title: string }[];
  action: (albumId: string, prev: ListActionState, formData: FormData) => Promise<ListActionState>;
}) {
  const [state, formAction, pending] = useActionState<ListActionState, FormData>(
    action.bind(null, albumId),
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="add-to-list" className="text-sm text-text-secondary">
        Add to a list
      </label>

      <div className="flex gap-2">
        <select
          id="add-to-list"
          name="list_id"
          className="min-w-0 flex-1 rounded-md border border-border bg-raised px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent"
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.title}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-sm border border-border bg-raised px-3 py-2 text-xs font-medium text-text transition-colors hover:border-border-strong disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-text-muted">
          {state.error}
        </p>
      )}
    </form>
  );
}
