'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { FollowActionState } from '@/app/[handle]/actions';

/**
 * The follow toggle on a profile.
 *
 * **Not part of `ActionCard`.** That component is the album collection state
 * machine — five states, nine action slots, a disclosure that has twice shipped
 * a stale-subtree bug. A follow is one boolean with no disclosure and no
 * implicit side effects, and putting it there would mean growing the card a
 * tenth slot it would never use anywhere it is actually rendered.
 *
 * **The desired next state is submitted rather than derived**, the same as the
 * like toggle: a double click or a resubmitted form settles on one state
 * instead of toggling twice. `aria-pressed` is what makes it a toggle to a
 * screen reader rather than a button whose label happens to change.
 *
 * **It is not rendered at all when signed out**, by the profile page rather
 * than by this component. An anonymous visitor sees the counts and no control,
 * and is never redirected to authentication merely for looking at a profile.
 */

type Props = {
  followeeId: string;
  following: boolean;
  followAction: (prev: FollowActionState, formData: FormData) => Promise<FollowActionState>;
  unfollowAction: (prev: FollowActionState, formData: FormData) => Promise<FollowActionState>;
};

export function FollowButton({ followeeId, following, followAction, unfollowAction }: Props) {
  const action = following ? unfollowAction : followAction;
  const [state, formAction] = useActionState(action, {});

  return (
    <div className="shrink-0">
      <form action={formAction}>
        <input type="hidden" name="followeeId" value={followeeId} />
        <FollowSubmit following={following} />
      </form>
      {state.error && (
        <p role="alert" className="mt-2 max-w-[28ch] text-right text-xs text-text-muted">
          {state.error}
        </p>
      )}
    </div>
  );
}

/**
 * Two labels, and the resting one is the quiet treatment rather than the loud
 * one.
 *
 * Following is the *active* state, so it takes the accent border every active
 * quiet control in this product uses. Not following is the invitation, so it
 * takes the raised surface. The hover label does not change to "Unfollow":
 * `aria-pressed` already carries that, and a control that renames itself under
 * the cursor is how a mis-click happens.
 */
function FollowSubmit({ following }: { following: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={following}
      className={`rounded-sm border px-4 py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-70 ${
        following
          ? 'border-accent-dim bg-bg text-accent hover:border-accent'
          : 'border-border bg-raised text-text-secondary hover:border-border-strong hover:text-text'
      }`}
    >
      {pending ? '…' : following ? 'Following' : 'Follow'}
    </button>
  );
}
