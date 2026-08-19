'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { ScoreBadge } from '@/components/ScoreBadge';

/**
 * The collection action card.
 *
 * Personal state gets a discrete raised card rather than being scattered inline
 * — the single most transferable pattern from our structural reference
 * (docs/design-reference.md §3), and collecting is our core action, so it earns
 * a permanent home on the album page.
 *
 * **Five states, not three.** The spec names three collection states; the real
 * set includes two that precede them. The onboarding state exists because a
 * completed profile is required before any collection mutation: user-authored
 * rows reference `profiles(id)`, and an authenticated user mid-onboarding has
 * no profile row to reference. Phase 1 shipped exactly that bug in self-service
 * additions, where the audit insert failed silently and the rate limit was
 * bypassed. Here it is a visible state rather than a silent failure.
 *
 * **Controls are inert unless an action is supplied.** Add and remove are wired
 * as of Phase 2's first user-visible slice; rating, liking, relistening and
 * reviews are still presentation, and stay disabled until their own slices.
 * That is what keeps the development gallery working: it passes no actions, so
 * every control there renders in its resting, disabled form.
 */

/**
 * Server actions the card can invoke. Optional — without them the card is the
 * presentational component it was.
 */
export type ActionCardActions = {
  add?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  remove?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
};

export type ActionCardState =
  | { kind: 'signed-out' }
  | { kind: 'onboarding-required' }
  | { kind: 'not-collected' }
  | { kind: 'collected-unrated'; relistens?: number; hasReview?: boolean }
  | {
      kind: 'collected-rated';
      score: number;
      liked?: boolean;
      relistens?: number;
      hasReview?: boolean;
    };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
      {children}
    </div>
  );
}

function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

const PRIMARY =
  'w-full rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors';

/**
 * Dominant action, inert — a control whose slice has not landed.
 *
 * Visibly unavailable rather than merely non-functional. Once Add became live,
 * an identically-styled brass button that silently did nothing sat directly
 * beneath it, and there was no way to tell them apart before clicking. Each of
 * these reverts to the live treatment as its own slice wires it.
 */
function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className={`${PRIMARY} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  );
}

/**
 * Dominant action, live.
 *
 * `useFormStatus` reads the pending state of the enclosing form, which is why
 * this is a separate component — the hook reports on the form above it, not on
 * one rendered alongside.
 */
function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${PRIMARY} hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * A failed mutation.
 *
 * Muted brick from the palette rather than an alarm red: a failure to add an
 * album is worth reading, not worth shouting about.
 */
function Failure({ message }: { message: string }) {
  return (
    <p role="alert" className="text-xs leading-relaxed text-danger-text">
      {message}
    </p>
  );
}

function QuietAction({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      disabled
      className={`flex-1 rounded-sm border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'border-accent-dim bg-bg text-accent'
          : 'border-border bg-raised text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Removal, which is destructive and says so before it happens.
 *
 * Two steps rather than a native confirm dialog: the confirmation stays inside
 * the card and inside the design system, and it can name exactly what this
 * particular removal will destroy. Removal cascades to the review and the
 * relisten history, so a control labelled only "Remove" could cost somebody up
 * to ten thousand characters of their own writing.
 *
 * The wishlist is deliberately not mentioned, because removal does not touch
 * it: the clearing rule runs one way only.
 */
function RemoveControl({
  action,
  hasReview,
  relistens,
}: {
  action: NonNullable<ActionCardActions['remove']>;
  hasReview: boolean;
  relistens: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(action, {});

  if (!confirming) {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="block py-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          Remove from collection
        </button>
        {state.error && <Failure message={state.error} />}
      </>
    );
  }

  const losses = [
    hasReview && 'your review',
    relistens > 0 && `${relistens} relisten${relistens === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs leading-relaxed text-text-secondary">
        {losses.length > 0 ? (
          <>This also deletes {losses.join(' and ')}. It cannot be undone.</>
        ) : (
          <>Remove this album from your collection?</>
        )}
      </p>
      <div className="flex gap-2">
        <form action={formAction} className="flex-1">
          <button
            type="submit"
            className="w-full rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20"
          >
            Remove
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-sm border border-border bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong"
        >
          Keep
        </button>
      </div>
      {state.error && <Failure message={state.error} />}
    </div>
  );
}

/** Add, live. Idempotent server-side, so a double submit yields one entry. */
function AddRow({ action }: { action: NonNullable<ActionCardActions['add']> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <>
      <form action={formAction}>
        <SubmitButton pendingLabel="Adding…">Add to collection</SubmitButton>
      </form>
      {state.error && (
        <div className="mt-2">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

/** An inert stacked action, for the same reason as `PrimaryButton`. */
function StackedLink({ children }: { children: ReactNode }) {
  return (
    <span className="block cursor-not-allowed py-1.5 text-sm text-text-secondary opacity-45">
      {children}
    </span>
  );
}

export function ActionCard({
  state,
  actions = {},
}: {
  state: ActionCardState;
  actions?: ActionCardActions;
}) {
  if (state.kind === 'signed-out') {
    return (
      <Shell>
        <Row>
          <Link
            href="/login"
            className="block w-full rounded-sm bg-accent px-4 py-2 text-center text-sm font-medium text-accent-contrast"
          >
            Sign in to add
          </Link>
        </Row>
        <Row>
          <p className="text-xs text-text-muted">
            Keep a record of what you listen to, score it, and write about it.
          </p>
        </Row>
      </Shell>
    );
  }

  if (state.kind === 'onboarding-required') {
    return (
      <Shell>
        <Row>
          <Link
            href="/onboarding"
            className="block w-full rounded-sm border border-accent-dim bg-bg px-4 py-2 text-center text-sm font-medium text-accent"
          >
            Choose a handle
          </Link>
        </Row>
        <Row>
          {/* Says why, rather than presenting a control that would fail. */}
          <p className="text-xs text-text-muted">
            Pick a handle before adding to your collection — it is how your collection is addressed.
          </p>
        </Row>
      </Shell>
    );
  }

  if (state.kind === 'not-collected') {
    return (
      <Shell>
        <Row>
          {actions.add ? (
            <AddRow action={actions.add} />
          ) : (
            <PrimaryButton>Add to collection</PrimaryButton>
          )}
        </Row>
        <Row>
          <div className="flex gap-2">
            <QuietAction>Rate</QuietAction>
            <QuietAction>Like</QuietAction>
          </div>
          {/* Rating or liking an uncollected album adds it silently, so the
              controls are offered rather than hidden (product-spec.md §8.5). */}
          <p className="mt-2 text-xs text-text-faint">Rating or liking adds it too.</p>
        </Row>
        <Row>
          <StackedLink>Write a review…</StackedLink>
        </Row>
      </Shell>
    );
  }

  if (state.kind === 'collected-unrated') {
    return (
      <Shell>
        <Row className="flex items-center justify-between gap-4">
          <span className="text-sm text-text-secondary">In your collection</span>
          <span className="text-xs uppercase tracking-widest text-accent">Added</span>
        </Row>
        <Row>
          {/* Rate is dominant here: it is the obvious next thing to do. */}
          <PrimaryButton>Rate this album</PrimaryButton>
        </Row>
        <Row>
          <div className="flex gap-2">
            <QuietAction>Like</QuietAction>
            <QuietAction>
              Relisten
              {state.relistens ? <span className="tabular"> ×{state.relistens}</span> : null}
            </QuietAction>
          </div>
        </Row>
        <Row>
          <StackedLink>Write a review…</StackedLink>
          <StackedLink>Edition…</StackedLink>
          {actions.remove && (
            <RemoveControl
              action={actions.remove}
              hasReview={Boolean(state.hasReview)}
              relistens={state.relistens ?? 0}
            />
          )}
        </Row>
      </Shell>
    );
  }

  const { score, liked, relistens } = state;

  return (
    <Shell>
      <Row className="flex items-center justify-between gap-4">
        <span className="text-xs uppercase tracking-widest text-text-muted">Your score</span>
        <ScoreBadge score={score} variant="user" size="lg" />
      </Row>
      <Row>
        {/* Once rated, relisten is the action that recurs — the album is
            already scored, so the card's job changes (design-reference §6.4). */}
        <PrimaryButton>
          Mark a relisten{relistens ? <span className="tabular"> · ×{relistens}</span> : null}
        </PrimaryButton>
      </Row>
      <Row>
        <div className="flex gap-2">
          <QuietAction active={liked}>{liked ? 'Liked' : 'Like'}</QuietAction>
          <QuietAction>Change score</QuietAction>
        </div>
      </Row>
      <Row>
        <StackedLink>Edit review…</StackedLink>
        <StackedLink>Edition…</StackedLink>
        {actions.remove && (
          <RemoveControl
            action={actions.remove}
            hasReview={Boolean(state.hasReview)}
            relistens={relistens ?? 0}
          />
        )}
      </Row>
    </Shell>
  );
}
