'use client';

import { useActionState } from 'react';

import { deleteListAction, updateListAction, type ListActionState } from '@/app/lists/[id]/actions';

/**
 * The owner's controls on a list page: edit in place, or delete.
 *
 * **Toggling "Ranked" changes nothing but the flag.** Positions are maintained
 * on every list, so un-ranking preserves the order and re-ranking restores it
 * exactly — there is no reconstruction step here because there is nothing to
 * reconstruct (`data-model.md` §5).
 *
 * **Deletion is a hard delete and says so.** `CLAUDE.md` makes that
 * non-negotiable, so the confirmation is worded as permanent rather than
 * hedged.
 */
export function EditListForm({
  id,
  handle,
  title,
  description,
  isRanked,
}: {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  isRanked: boolean;
}) {
  const [state, action, pending] = useActionState<ListActionState, FormData>(
    updateListAction.bind(null, id),
    {},
  );

  return (
    <details className="rounded-md border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm text-text-secondary">
        Edit this list
      </summary>

      <div className="flex flex-col gap-3 border-t border-border p-4">
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-title" className="text-sm text-text-secondary">
              Title
            </label>
            <input
              id="edit-title"
              name="title"
              required
              maxLength={120}
              defaultValue={title}
              className="w-full min-w-0 rounded-md border border-border bg-raised px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-description" className="text-sm text-text-secondary">
              Description <span className="ml-1.5 text-text-faint">optional</span>
            </label>
            <textarea
              id="edit-description"
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={description ?? ''}
              className="w-full min-w-0 resize-y rounded-md border border-border bg-raised px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              name="is_ranked"
              defaultChecked={isRanked}
              className="accent-accent"
            />
            Ranked — turning this off keeps the order for later
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
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <form action={deleteListAction.bind(null, id, handle)}>
          <button
            type="submit"
            className="rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20"
          >
            Delete list permanently
          </button>
        </form>
      </div>
    </details>
  );
}
