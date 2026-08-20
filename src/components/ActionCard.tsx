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
  rate?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  like?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  relisten?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  favourite?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  wantToListen?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  saveReview?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
  deleteReview?: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
};

/** Matches the check constraint and the service; the field enforces it too. */
export const REVIEW_LIMIT = 10_000;
/** Where the counter stops hiding. Far enough out to be a warning, not a meter. */
const COUNTER_THRESHOLD = REVIEW_LIMIT - 500;

export type ActionCardState =
  | { kind: 'signed-out' }
  | { kind: 'onboarding-required' }
  | { kind: 'not-collected' }
  | {
      kind: 'collected-unrated';
      liked?: boolean;
      relistens?: number;
      hasReview?: boolean;
      reviewBody?: string | null;
      reviewUpdatedAt?: string | null;
    }
  | {
      kind: 'collected-rated';
      score: number;
      liked?: boolean;
      relistens?: number;
      hasReview?: boolean;
      reviewBody?: string | null;
      reviewUpdatedAt?: string | null;
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

/**
 * The explicit add, with an optional listen date. Idempotent server-side, so a
 * double submit yields one entry.
 *
 * **The date is subordinate to the button, not beside it.** Adding is one click
 * (`design-reference.md` §6.4 makes Add dominant in this state), and the date
 * is the exception rather than the path — so it stays behind a quiet
 * disclosure and the primary control never moves. Revealing it does not change
 * what submits: the same form, the same action, the same single sanctioned
 * collection-creation path, with one more field in it.
 *
 * A native date input rather than a bespoke one. The design system has no date
 * control, inventing one is beyond this slice, and the native control brings
 * the platform's own keyboard handling and locale-aware display for free —
 * while still submitting the ISO calendar date the column stores.
 *
 * Closing the disclosure unmounts the field, so a date typed and then dismissed
 * is not submitted. That is the intended reading of "without a date".
 *
 * No stale-state risk here, unusually for this card: a successful add moves the
 * card from `not-collected` to a collected kind, so this component unmounts
 * entirely. On a rejected date the kind does not change, the disclosure stays
 * open, and the message sits under the field it belongs to.
 */
function AddRow({ action }: { action: NonNullable<ActionCardActions['add']> }) {
  const [state, formAction] = useActionState(action, {});
  const [dating, setDating] = useState(false);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-2.5">
        {dating && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="listened-on"
              className="text-xs uppercase tracking-widest text-text-muted"
            >
              Listened on
            </label>
            <input
              id="listened-on"
              name="listenedOn"
              type="date"
              autoFocus
              aria-describedby="listened-on-hint"
              className="tabular w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-accent"
            />
            <p id="listened-on-hint" className="text-xs text-text-faint">
              Optional, and freely backdated. Leave it blank if you would rather not say.
            </p>
          </div>
        )}
        <SubmitButton pendingLabel="Adding…">Add to collection</SubmitButton>
      </form>

      <button
        type="button"
        onClick={() => setDating((open) => !open)}
        aria-expanded={dating}
        aria-controls={dating ? 'listened-on' : undefined}
        className="mt-2 text-xs text-text-muted transition-colors hover:text-text"
      >
        {dating ? 'Add without a date' : 'Add with a listen date…'}
      </button>

      {state.error && (
        <div className="mt-2">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

/**
 * The review editor.
 *
 * Plain text, and plain text all the way down: no Markdown, no autolinking, and
 * nothing on the render side that could interpret what someone typed. Reviews
 * are displayed with `whitespace-pre-wrap`, which keeps line breaks while React
 * escapes the content — `dangerouslySetInnerHTML` must never appear near this.
 *
 * Explicit Save and Cancel rather than saving as you type. Someone writing a
 * paragraph should be able to change their mind, and an autosave that commits
 * half a sentence to a public page is worse than a button.
 *
 * The counter stays hidden until the last 500 characters. A live count from the
 * first word turns a writing surface into a form, and the limit is high enough
 * that almost nobody will ever see it.
 */
function ReviewControl({
  save,
  remove,
  body,
}: {
  save: NonNullable<ActionCardActions['saveReview']>;
  remove?: ActionCardActions['deleteReview'];
  body: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(body ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [state, formAction] = useActionState(save, {});
  const noop = async (): Promise<{ error?: string }> => ({});
  const [removeState, removeAction] = useActionState<{ error?: string }, FormData>(
    remove ?? noop,
    {},
  );

  const existing = body !== null && body.length > 0;

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setDraft(body ?? '');
            setOpen(true);
          }}
          className="block py-1.5 text-left text-sm text-text-secondary transition-colors hover:text-text"
        >
          {existing ? 'Edit review…' : 'Write a review…'}
        </button>
        {(state.error || removeState.error) && (
          <Failure message={state.error ?? removeState.error!} />
        )}
      </>
    );
  }

  const remaining = REVIEW_LIMIT - draft.length;
  const showCounter = draft.length >= COUNTER_THRESHOLD;

  return (
    <div className="flex flex-col gap-2.5 py-1">
      <form action={formAction} className="flex flex-col gap-2.5">
        <label htmlFor="review-body" className="text-xs uppercase tracking-widest text-text-muted">
          Your review
        </label>
        <textarea
          id="review-body"
          name="body"
          rows={8}
          autoFocus
          maxLength={REVIEW_LIMIT}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-describedby={state.error ? 'review-error' : showCounter ? 'review-count' : undefined}
          placeholder="What did you make of it?"
          className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-base leading-relaxed text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent"
        />

        {showCounter && (
          <p
            id="review-count"
            aria-live="polite"
            className={`tabular text-xs ${remaining <= 0 ? 'text-danger-text' : 'text-text-muted'}`}
          >
            {remaining.toLocaleString()} characters left
          </p>
        )}

        {state.error && (
          <p id="review-error" role="alert" className="text-xs leading-relaxed text-danger-text">
            {state.error}
          </p>
        )}

        <div className="flex gap-2">
          <ReviewSubmit />
          <button
            type="button"
            onClick={() => {
              setDraft(body ?? '');
              setOpen(false);
              setConfirmingDelete(false);
            }}
            className="rounded-sm border border-border bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
        </div>
      </form>

      {existing && remove && !confirmingDelete && (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="self-start text-xs text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text"
        >
          Delete review
        </button>
      )}

      {existing && remove && confirmingDelete && (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-text-secondary">
            Delete this review? It cannot be undone. The album stays in your collection.
          </p>
          <div className="flex gap-2">
            <form action={removeAction}>
              <button
                type="submit"
                className="rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger/20"
              >
                Delete
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-sm border border-border bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text"
            >
              Keep
            </button>
          </div>
        </div>
      )}

      {removeState.error && (
        <p role="alert" className="text-xs leading-relaxed text-danger-text">
          {removeState.error}
        </p>
      )}
    </div>
  );
}

function ReviewSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-sm bg-accent px-4 py-1.5 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Saving…' : 'Save review'}
    </button>
  );
}

/**
 * Relisten.
 *
 * The one mutation on this card that is deliberately **not** idempotent: each
 * submission is another event, because three relistens are three feed items and
 * a counter could not express that.
 *
 * The count rides on the control that produces it rather than getting a figure
 * of its own. A card that reported `×3` in its own row would be the first step
 * toward a statistics panel, and this is a place to act, not a dashboard. It is
 * omitted entirely at zero — `×0` is noise, and `ScoreBadge`'s rule about
 * absence applies here too.
 */
function RelistenButton({
  action,
  count,
  dominant,
}: {
  action: NonNullable<ActionCardActions['relisten']>;
  count: number;
  dominant: boolean;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <>
      <form action={formAction} className={dominant ? 'w-full' : 'flex-1'}>
        {dominant ? (
          <SubmitButton pendingLabel="Marking…">
            Mark a relisten{count > 0 ? <span className="tabular"> · ×{count}</span> : null}
          </SubmitButton>
        ) : (
          <RelistenQuiet count={count} />
        )}
      </form>
      {state.error && (
        <div className="w-full">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

function RelistenQuiet({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-sm border border-border bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? '…' : <>Relisten{count > 0 ? <span className="tabular"> ×{count}</span> : null}</>}
    </button>
  );
}

/**
 * The like toggle.
 *
 * Restrained by construction: it reuses the quiet-action treatment already in
 * the card, and "liked" is expressed as the accent border and accent text that
 * every active quiet control in this product uses. No heart, no colour outside
 * the palette, and nothing that competes with the dominant action above it.
 *
 * The desired next value is submitted rather than derived, so a double click or
 * a resubmitted form settles on one state instead of toggling twice.
 * `aria-pressed` is what makes this a toggle to a screen reader rather than a
 * button whose label happens to change.
 */
function LikeButton({
  action,
  liked,
}: {
  action: NonNullable<ActionCardActions['like']>;
  liked: boolean;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <>
      <form action={formAction} className="flex-1">
        <input type="hidden" name="liked" value={liked ? 'false' : 'true'} />
        <LikeSubmit liked={liked} />
      </form>
      {state.error && (
        <div className="w-full">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

function LikeSubmit({ liked }: { liked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={liked}
      className={`w-full rounded-sm border px-3 py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-70 ${
        liked
          ? 'border-accent-dim bg-bg text-accent hover:border-accent'
          : 'border-border bg-raised text-text-secondary hover:border-border-strong hover:text-text'
      }`}
    >
      {pending ? '…' : liked ? 'Liked' : 'Like'}
    </button>
  );
}

/**
 * The favourite toggle.
 *
 * **Deliberately the same treatment as Like, and deliberately not in the same
 * row.** The two are different relations and must not be conflated, but the
 * distinction is not a styling problem: both are binary toggles, so giving one
 * a decorated treatment would say they differ in *kind* of interaction when
 * they differ in *meaning*. What separates them here is where they sit and what
 * they are called.
 *
 * Like, Rate and Relisten all implicitly collect the album (product-spec.md
 * §8.5). Favourite does not — pinning is a statement about taste and never adds
 * anything. That is a real boundary, so the favourite gets its own row below
 * the ones that collect, rather than a fourth chip in a line of three.
 *
 * No heart. The heart glyph means **liked** on a collection tile, and reusing
 * it for a favourite would collapse exactly the distinction this separation
 * exists to hold.
 *
 * `aria-pressed` carries the state, matching Like, so the control announces
 * itself as a toggle rather than as two buttons that swap labels.
 */
function FavouriteButton({
  action,
  favourited,
}: {
  action: NonNullable<ActionCardActions['favourite']>;
  favourited: boolean;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="favourited" value={favourited ? 'false' : 'true'} />
        <FavouriteSubmit favourited={favourited} />
      </form>
      {state.error && (
        <div className="w-full">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

function FavouriteSubmit({ favourited }: { favourited: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={favourited}
      className={`rounded-sm border px-3 py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-70 ${
        favourited
          ? 'border-accent-dim bg-bg text-accent hover:border-accent'
          : 'border-border bg-raised text-text-secondary hover:border-border-strong hover:text-text'
      }`}
    >
      {pending ? '…' : favourited ? 'Favourited' : 'Favourite'}
    </button>
  );
}

/**
 * The Want to Listen toggle.
 *
 * **Offered in every collection state, including the collected ones.** The
 * relations are independent and an album may legally sit in both, so hiding
 * this once an album is collected would misrepresent the model — and wanting to
 * hear a record again is an ordinary thing to mean. Resolved 2026-08-20; the
 * question was open until then and the card must not be read as having inferred
 * it (product-spec.md §10.1).
 *
 * **It touches nothing else.** Wanting an album does not collect it, and
 * unwanting it does not remove it. The one-way rule runs the other direction
 * only: adding to the collection later clears the wish, inside
 * `ensure_collection_entry` and nowhere near this control.
 *
 * The label changes rather than relying on colour alone. "Wanted" was rejected
 * — it reads as past tense, where "Liked" and "Favourited" read as states — so
 * the active form names where the album now is.
 */
function WantToListenButton({
  action,
  wanted,
}: {
  action: NonNullable<ActionCardActions['wantToListen']>;
  wanted: boolean;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="wanted" value={wanted ? 'false' : 'true'} />
        <WantToListenSubmit wanted={wanted} />
      </form>
      {state.error && (
        <div className="w-full">
          <Failure message={state.error} />
        </div>
      )}
    </>
  );
}

function WantToListenSubmit({ wanted }: { wanted: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={wanted}
      className={`rounded-sm border px-3 py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-70 ${
        wanted
          ? 'border-accent-dim bg-bg text-accent hover:border-accent'
          : 'border-border bg-raised text-text-secondary hover:border-border-strong hover:text-text'
      }`}
    >
      {pending ? '…' : wanted ? 'On your list' : 'Want to listen'}
    </button>
  );
}

/**
 * The score input.
 *
 * Numeric, not stars. The score is 0.0-10.0 to one decimal by decision, and a
 * five-star control cannot express that — the reference product itself displays
 * a decimal average while collecting stars, which is the tell that the
 * underlying quantity was always numeric (docs/design-reference.md §3).
 *
 * `inputMode="decimal"` brings up the numeric keypad on a phone, and `step` of
 * 0.1 makes the desktop spinner move in the units the scale actually has.
 * Validation is deliberately duplicated: `min`, `max` and `step` catch most
 * mistakes before a round-trip, the service rejects anything that gets past
 * them, and a check constraint rejects anything that gets past the service.
 *
 * Clearing is submitting an empty field. That returns the entry to **unrated**,
 * which is null rather than zero — different claims, and conflating them would
 * invent an opinion and move the album's average.
 */
function RatingControl({
  action,
  current,
  triggerLabel,
  dominant,
}: {
  action: NonNullable<ActionCardActions['rate']>;
  current: number | null;
  triggerLabel: string;
  dominant: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});

  if (!open) {
    return (
      <>
        {dominant ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${PRIMARY} hover:bg-accent-hover`}
          >
            {triggerLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-1 rounded-sm border border-border bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text"
          >
            {triggerLabel}
          </button>
        )}
        {state.error && (
          <div className="mt-2">
            <Failure message={state.error} />
          </div>
        )}
      </>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-2.5">
      <label htmlFor="rating" className="text-xs uppercase tracking-widest text-text-muted">
        Your score
      </label>
      <div className="flex gap-2">
        <input
          id="rating"
          name="rating"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          max="10"
          autoFocus
          defaultValue={current === null ? '' : current.toFixed(1)}
          placeholder="0.0-10.0"
          aria-describedby={state.error ? 'rating-error' : undefined}
          className="tabular w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2.5 text-base text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent"
        />
        <RatingSubmit />
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-text-muted transition-colors hover:text-text"
        >
          Cancel
        </button>
        {current !== null && (
          // Clearing submits the same form with an empty field, so it travels
          // the one code path rather than needing an action of its own.
          <button
            type="submit"
            name="intent"
            value="clear"
            className="text-xs text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text"
          >
            Clear score
          </button>
        )}
      </div>

      {state.error && (
        <div id="rating-error">
          <Failure message={state.error} />
        </div>
      )}
    </form>
  );
}

function RatingSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="shrink-0 rounded-sm bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
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

/**
 * The two relations that do **not** collect.
 *
 * This is the card's one real boundary, and the row exists to draw it. Rate,
 * Like and Relisten all create a collection entry implicitly
 * (product-spec.md §8.5); Favourite and Want to Listen never do. Grouping by
 * that property is why Favourite was pulled out of the chip line in the first
 * place, and Want to Listen belongs on the same side of it — so it joins the
 * existing row rather than adding a fourth.
 *
 * They stay distinct by label and by meaning: a favourite is a judgement about
 * a record you know, a wish is an intention about one you may not. Neither
 * takes an icon — the heart already means *liked* on collection tiles, and a
 * second glyph here would blur three relations rather than two.
 *
 * Both controls are keyed on their server-confirmed value. Neither toggle
 * changes the card's kind — wanting an uncollected album leaves it uncollected
 * — so React preserves this subtree across the mutation, and with it any error
 * `useActionState` is holding. That exact disclosure bug has shipped three
 * times now, and only the browser has ever caught it.
 */
function IndependentRelations({
  actions,
  favourited,
  wanted,
  note,
}: {
  actions: ActionCardActions;
  favourited: boolean;
  wanted: boolean;
  note?: string;
}) {
  return (
    <Row>
      <div className="flex flex-wrap gap-2">
        {actions.favourite ? (
          <FavouriteButton
            key={`fav-${favourited}`}
            action={actions.favourite}
            favourited={favourited}
          />
        ) : (
          <QuietAction active={favourited}>{favourited ? 'Favourited' : 'Favourite'}</QuietAction>
        )}
        {actions.wantToListen ? (
          <WantToListenButton key={`wtl-${wanted}`} action={actions.wantToListen} wanted={wanted} />
        ) : (
          <QuietAction active={wanted}>{wanted ? 'On your list' : 'Want to listen'}</QuietAction>
        )}
      </div>
      {note && <p className="mt-2 text-xs text-text-faint">{note}</p>}
    </Row>
  );
}

export function ActionCard({
  state,
  actions = {},
  favourited = false,
  wanted = false,
}: {
  state: ActionCardState;
  actions?: ActionCardActions;
  /**
   * Whether the signed-in user has pinned this album.
   *
   * A top-level prop rather than a field on `state`, because favourites are
   * **orthogonal to collection membership**. `state` discriminates on whether
   * the album is collected and how it is scored; a favourite may exist in any
   * of those cases, including `not-collected`, and toggling it must never move
   * the card between kinds.
   */
  favourited?: boolean;
  /**
   * Whether the signed-in user has this album on their Want to Listen list.
   *
   * Orthogonal for the same reason as `favourited`, and load-bearing in one
   * more: an album may be wanted *and* collected. Folding this into `state`
   * would split `not-collected` in two and turn the union into a cross-product,
   * while encoding a relation the collection does not own.
   */
  wanted?: boolean;
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
          <div className="flex flex-wrap gap-2">
            {actions.rate ? (
              <RatingControl
                action={actions.rate}
                current={null}
                triggerLabel="Rate"
                dominant={false}
              />
            ) : (
              <QuietAction>Rate</QuietAction>
            )}
            {actions.like ? (
              <LikeButton action={actions.like} liked={false} />
            ) : (
              <QuietAction>Like</QuietAction>
            )}
            {actions.relisten ? (
              <RelistenButton action={actions.relisten} count={0} dominant={false} />
            ) : (
              <QuietAction>Relisten</QuietAction>
            )}
          </div>
          {/* Rating, liking or relistening an uncollected album adds it
              silently, so the controls are offered rather than hidden
              (product-spec.md §8.5). */}
          <p className="mt-2 text-xs text-text-faint">Rating, liking or a relisten adds it too.</p>
        </Row>
        <IndependentRelations
          actions={actions}
          favourited={favourited}
          wanted={wanted}
          note="Neither of these adds it to your collection."
        />
        <Row>
          {actions.saveReview ? (
            <ReviewControl save={actions.saveReview} remove={actions.deleteReview} body={null} />
          ) : (
            <StackedLink>Write a review…</StackedLink>
          )}
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
          {actions.rate ? (
            <RatingControl
              action={actions.rate}
              current={null}
              triggerLabel="Rate this album"
              dominant
            />
          ) : (
            <PrimaryButton>Rate this album</PrimaryButton>
          )}
        </Row>
        <Row>
          <div className="flex flex-wrap gap-2">
            {actions.like ? (
              <LikeButton action={actions.like} liked={Boolean(state.liked)} />
            ) : (
              <QuietAction>Like</QuietAction>
            )}
            {actions.relisten ? (
              <RelistenButton
                action={actions.relisten}
                count={state.relistens ?? 0}
                dominant={false}
              />
            ) : (
              <QuietAction>
                Relisten
                {state.relistens ? <span className="tabular"> ×{state.relistens}</span> : null}
              </QuietAction>
            )}
          </div>
        </Row>
        <IndependentRelations actions={actions} favourited={favourited} wanted={wanted} />
        <Row>
          {actions.saveReview ? (
            <ReviewControl
              // Keyed on the timestamp the server last confirmed, so a saved
              // edit collapses the editor. Without it the control stays open
              // showing a stale draft: the card's kind does not change on an
              // edit, so React preserves the component's state.
              key={`review-${state.reviewUpdatedAt ?? 'none'}`}
              save={actions.saveReview}
              remove={actions.deleteReview}
              body={state.reviewBody ?? null}
            />
          ) : (
            <StackedLink>Write a review…</StackedLink>
          )}
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
        {actions.relisten ? (
          <RelistenButton action={actions.relisten} count={relistens ?? 0} dominant />
        ) : (
          <PrimaryButton>
            Mark a relisten{relistens ? <span className="tabular"> · ×{relistens}</span> : null}
          </PrimaryButton>
        )}
      </Row>
      <Row>
        <div className="flex flex-wrap gap-2">
          {actions.like ? (
            <LikeButton action={actions.like} liked={Boolean(liked)} />
          ) : (
            <QuietAction active={liked}>{liked ? 'Liked' : 'Like'}</QuietAction>
          )}
          {actions.rate ? (
            <RatingControl
              // Keyed on the confirmed score, so the control resets and
              // collapses once the server acknowledges a change. Without this
              // it stays open showing a stale value, because the card's kind
              // has not changed and React preserves the component's state.
              key={`rate-${score}`}
              action={actions.rate}
              current={score}
              triggerLabel="Change score"
              dominant={false}
            />
          ) : (
            <QuietAction>Change score</QuietAction>
          )}
        </div>
      </Row>
      <IndependentRelations actions={actions} favourited={favourited} wanted={wanted} />
      <Row>
        {actions.saveReview ? (
          <ReviewControl
            key={`review-${state.reviewUpdatedAt ?? 'none'}`}
            save={actions.saveReview}
            remove={actions.deleteReview}
            body={state.reviewBody ?? null}
          />
        ) : (
          <StackedLink>Edit review…</StackedLink>
        )}
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
