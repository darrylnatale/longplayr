import Link from 'next/link';
import type { ReactNode } from 'react';

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
 * Presentation only. Every control is inert — Phase 2 wires them.
 */

export type ActionCardState =
  | { kind: 'signed-out' }
  | { kind: 'onboarding-required' }
  | { kind: 'not-collected' }
  | { kind: 'collected-unrated'; relistens?: number }
  | { kind: 'collected-rated'; score: number; liked?: boolean; relistens?: number };

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

/** Dominant action. One per card, and never more than one. */
function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className="w-full rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:cursor-default"
    >
      {children}
    </button>
  );
}

function QuietAction({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      disabled
      className={`flex-1 rounded-sm border px-3 py-1.5 text-xs disabled:cursor-default ${
        active
          ? 'border-accent-dim bg-bg text-accent'
          : 'border-border bg-raised text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function StackedLink({ children }: { children: ReactNode }) {
  return (
    <span className="block cursor-default py-1.5 text-sm text-text-secondary">{children}</span>
  );
}

export function ActionCard({ state }: { state: ActionCardState }) {
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
          <PrimaryButton>Add to collection</PrimaryButton>
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
      </Row>
    </Shell>
  );
}
