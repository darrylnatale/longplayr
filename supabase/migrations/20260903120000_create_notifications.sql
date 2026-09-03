-- longplayr — notifications
--
-- Phase 3, slice 5, and the last named feature in the phase. Follows and review
-- likes deliberately generate no feed events, so until this table exists both
-- are visible only to the person who performed them (`product-spec.md` §6).
--
-- **Directed, not broadcast.** `Activity` is things you did, shown to whoever
-- follows you. A notification is something another person did *to you*. The two
-- carry disjoint event types and neither writes the other's rows
-- (`data-model.md` §7).
--
-- **Two types, not three.** `list_liked` is deferred until Lists exists — there
-- is no table for `list_like_id` to reference, so the foreign key could not be
-- created at all, and an enum member no code can write is speculative schema.
-- That is a phase boundary, not a product rejection: `product-spec.md` §5 and §6
-- keep list likes in the finished surface. See `architecture.md` §16.3.
--
-- **A notification is the current existence of its source action, not a
-- historical audit event.** Undoing the source removes it by cascade;
-- re-creating the source produces a new one. Nothing is retained as history.

create type public.notification_type as enum ('followed', 'review_liked');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Who is being notified, and who caused it. Both cascade: `data-model.md` §8
  -- requires deleting a user to remove the notifications they caused for other
  -- people, not merely the ones they received.
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,

  type public.notification_type not null,

  -- The subject, one column per type. Nullable because exactly one applies.
  -- Both cascade, which is the whole undo mechanism: unfollowing or unliking
  -- destroys the source row and the notification goes with it. There is no
  -- second delete anywhere in the service.
  follow_id uuid references public.follows (id) on delete cascade,
  review_like_id uuid references public.review_likes (id) on delete cascade,

  -- Nullable. Null is unread, and this drives the count in the navigation.
  read_at timestamptz,

  created_at timestamptz not null default now(),

  -- **One notification per source row, enforced here rather than in the
  -- service, and this is not defensive tidiness.** `followUser` and `likeReview`
  -- are idempotent: both return the *pre-existing* row on a unique violation and
  -- neither can tell "I created this" from "this already existed". A service
  -- that created a notification after every apparently successful call would
  -- emit a second one on any double submit or retry.
  --
  -- With these constraints the write can insert unconditionally and tolerate the
  -- violation — exactly what `activity.ts` already does — so no caller needs to
  -- know which happened.
  --
  -- Both columns are nullable and Postgres permits many NULLs under a unique
  -- constraint, so `followed` and `review_liked` rows coexist here without a
  -- partial index.
  constraint notifications_one_per_follow unique (follow_id),
  constraint notifications_one_per_review_like unique (review_like_id),

  -- The type and its subject must agree, and **the `else false` is the point.**
  --
  -- `activity_subject_matches_type` has no `ELSE`. A `CASE` with no matching
  -- branch returns `NULL`, `NULL` satisfies a `CHECK`, and a future enum value
  -- added without a matching `WHEN` is therefore **silently unconstrained**.
  -- That gap is tolerated on `activity` and deliberately not reproduced here —
  -- this table is expected to gain `list_liked` when Lists lands, which is
  -- precisely the case that would otherwise slip through.
  constraint notifications_subject_matches_type check (
    case type
      when 'followed' then follow_id is not null and review_like_id is null
      when 'review_liked' then review_like_id is not null and follow_id is null
      else false
    end
  )
);

comment on table public.notifications is
  'Directed events: someone followed you, or liked your review. Private to the recipient.';

-- Serves the page: the recipient filter and the keyset ordering, tiebreaker
-- included. Same shape as `activity_actor_idx`, plus `id` because the cursor is
-- `(created_at, id)`.
create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc, id desc);

-- Serves the unread count, which runs on **every page render** for a signed-in
-- user because it lives in the global navigation. The index above could answer
-- it, but would walk all of a recipient's history; this walks only what is
-- unread, which is the small and shrinking set.
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- Table privileges, evaluated before RLS. Every new table needs this block.
--
-- **`anon` gets nothing, and that is a deliberate departure.** Every other table
-- in this schema grants `anon` select, because everything user-generated is
-- public. Notifications are the first genuinely private rows here.
grant select, insert on public.notifications to authenticated;

-- **Column-level, because RLS cannot restrict columns.** A recipient must be
-- able to clear their own unread state and nothing else; a table-wide update
-- grant would let them rewrite `type` or `actor_id` and forge who did what.
grant update (read_at) on public.notifications to authenticated;

grant all on public.notifications to service_role;

-- No delete grant. Notifications are removed by cascade when their source goes,
-- never by hand.

alter table public.notifications enable row level security;

-- **Read and write are scoped to different people, which is unusual enough to
-- state plainly: the actor inserts, the recipient reads.** These two policies
-- must not be collapsed into one.
--
-- The read policy is the privacy boundary for the whole feature. It is emphatically
-- **not** the `using (true)` that `follows`, `activity` and `review_likes` carry —
-- copying one of those here would publish every user's notifications.
create policy notifications_recipient_read on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

-- You may create a notification only as yourself. The recipient is someone else,
-- so this checks the actor rather than the reader.
--
-- It deliberately does not verify that the subject row belongs to the actor: the
-- foreign keys already require the source row to exist, and the unique
-- constraints make a duplicate impossible. A caller forging a notification for a
-- follow they did not perform would need that follow's id, which is not exposed
-- anywhere.
create policy notifications_actor_insert on public.notifications
  for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- Clearing unread state. The column grant above is what confines this to
-- `read_at`; RLS decides *which rows*, the grant decides *which columns*, and
-- both are needed.
create policy notifications_recipient_update on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
