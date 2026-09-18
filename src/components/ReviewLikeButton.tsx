'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { CollectionActionState } from '@/app/albums/[slug]/actions';

/**
 * The like toggle beneath someone else's review.
 *
 * **Shaped on `FollowButton`, not on a new pattern.** Same `useActionState` and
 * `useFormStatus` pair, same `aria-pressed`, same disabled-while-pending
 * treatment, same desired-state hidden field the album page's other toggles
 * post. It is smaller because it sits inside a list item rather than a header.
 *
 * **The caller decides whether this renders at all.** It is never given to a
 * signed-out visitor, and never to the review's own author — the service refuses
 * a self-like too, but an interface should not offer an action it will reject.
 *
 * **No count.** Slice 4 displays none, so this shows only your own state
 * (`product-spec.md` §6). Until the Notifications slice lands, a like is visible
 * to nobody but the person who gave it.
 */

type Props = {
  reviewId: string;
  liked: boolean;
  toggleAction: (prev: CollectionActionState, formData: FormData) => Promise<CollectionActionState>;
};

/**
 * The same heart the collection tile draws.
 *
 * Duplicated rather than imported: the original is a local function inside
 * `CollectionTile`, and exporting it would mean editing a file outside this
 * slice. Same path, same weight — one glyph, not a second visual system.
 */
function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-3.5 w-3.5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.4}
    >
      <path d="M8 14s-5.5-3.6-5.5-7A3 3 0 0 1 8 5.2 3 3 0 0 1 13.5 7c0 3.4-5.5 7-5.5 7z" />
    </svg>
  );
}

export function ReviewLikeButton({ reviewId, liked, toggleAction }: Props) {
  const [state, formAction] = useActionState(toggleAction, {});

  return (
    <div className="mt-3">
      <form action={formAction}>
        <input type="hidden" name="reviewId" value={reviewId} />
        {/* The desired state, exactly as the album page's other toggles post it. */}
        <input type="hidden" name="liked" value={liked ? 'false' : 'true'} />
        <LikeSubmit liked={liked} />
      </form>
      {state.error && (
        <p role="alert" className="mt-1.5 max-w-[36ch] text-xs text-text-muted">
          {state.error}
        </p>
      )}
    </div>
  );
}

function LikeSubmit({ liked }: { liked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={liked}
      // The album's own like control on this page is also labelled "Like".
      // Same visible word, distinct accessible name, so the two are never
      // confusable by assistive technology — and "Like" is still contained in
      // the name, so the visible label matches it.
      aria-label={liked ? 'Liked this review' : 'Like this review'}
      className={`inline-flex items-center gap-1.5 rounded-sm text-xs transition-colors disabled:cursor-wait disabled:opacity-70 ${
        liked ? 'text-like' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      <HeartGlyph filled={liked} />
      {liked ? 'Liked' : 'Like'}
    </button>
  );
}
