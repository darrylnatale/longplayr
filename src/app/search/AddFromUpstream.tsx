'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { addAlbum } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:border-muted disabled:opacity-50"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}

export function AddFromUpstream({ mbid }: { mbid: string }) {
  const [state, formAction] = useActionState(addAlbum, {});

  if (state.addedMbid) {
    return (
      <Link
        href={`/albums/${state.addedMbid}`}
        className="shrink-0 text-xs text-foreground underline underline-offset-4"
      >
        Added — view
      </Link>
    );
  }

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="mbid" value={mbid} />
      {state.error && (
        <span role="alert" className="max-w-[16rem] text-right text-xs text-red-400">
          {state.error}
        </span>
      )}
      <Submit />
    </form>
  );
}
