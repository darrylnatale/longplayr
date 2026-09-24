-- longplayr — the grant and policy audit
--
-- **RLS answers *which rows*; grants answer *which columns*.** §14.1 closed
-- that gap on `profiles`, `reviews` and `lists` after a suspended account was
-- found able to reinstate itself. This is the deliberate sweep that should have
-- followed it: every table, its grants, its policies, and what the service layer
-- actually writes, compared.
--
-- **The rule was already in this codebase, applied once and never
-- generalised.** `notifications` grants `UPDATE` on `read_at` alone, and
-- `markNotificationRead` says why in as many words: *"RLS decides which rows;
-- the grant decides which columns."* Nothing carried it to the other twenty-one
-- tables. That is the shape of this whole finding — not a missing idea, an
-- unapplied one.
--
-- **Nothing here is exploitable today** and that is recorded rather than leaned
-- on: five accounts, no real traffic, and RLS scopes rows correctly throughout.
-- Each of these is a rule the application assumes and the database did not hold.

-- ---------------------------------------------------------------------------
-- collection_entries — a trigger-owned counter was user-writable
-- ---------------------------------------------------------------------------
--
-- `relisten_count` is maintained by `sync_relisten_count` and its own migration
-- says *"Nothing but arithmetic lives here. The rows remain the truth; this
-- column is a convenience for rendering a grid, and no business rule reads it."*
-- A user token could set it to anything, so the grid could show a number the
-- `relisten_events` rows do not support.
--
-- `listened_on` is set once, by `ensure_collection_entry` at creation, and
-- never updated by any path. `added_at`, `album_id`, `user_id` and `id` have no
-- writer at all.
--
-- **`updated_at` is in this list and nearly was not — §14.1's lesson, again.**
-- `ensure_collection_entry` is SECURITY INVOKER and its
-- `on conflict do update set updated_at = …` runs with the *caller's*
-- privileges, so omitting the column would make **adding an album you already
-- hold** fail with `42501`. Granting it is harmless: the `before update` trigger
-- overwrites whatever a caller sends.

revoke update on public.collection_entries from authenticated;
grant update (rating, liked, updated_at) on public.collection_entries to authenticated;

-- ---------------------------------------------------------------------------
-- list_items — only a position is ever moved
-- ---------------------------------------------------------------------------
--
-- `reorder_list_item` is the sole update path and it is SECURITY INVOKER, so
-- the grant has to cover exactly what it writes and nothing else. Moving an
-- item between lists, or rewriting which album it holds, has no caller.

revoke update on public.list_items from authenticated;
grant update (position) on public.list_items to authenticated;

-- ---------------------------------------------------------------------------
-- favourite_albums — no update path exists at all
-- ---------------------------------------------------------------------------
--
-- Favourites are added and removed; **reordering is unbuilt and its interaction
-- model is still open** (`product-feedback.md` F-001), so nothing updates this
-- table. The grant is withdrawn rather than narrowed.
--
-- **When reordering ships it will need a grant on `position` and will fail
-- loudly without one**, which is the intended outcome: a privilege that appears
-- when the feature does, rather than one waiting years in advance.

revoke update on public.favourite_albums from authenticated;

-- ---------------------------------------------------------------------------
-- activity — the actor was checked, the subject was not
-- ---------------------------------------------------------------------------
--
-- `activity_write_own` required `actor_id = auth.uid()` and nothing more, while
-- the subject-matches-type constraint requires only that a subject column be
-- **non-null** — not that the row it names belongs to the actor. A user could
-- therefore insert a `reviewed` event under their own handle pointing at
-- **somebody else's review**, and `feed_activity` joins the review body in: that
-- is another person's writing appearing as yours in your followers' feeds.
--
-- **The correct pattern was already two tables away.** `relisten_events_write_own`
-- checks ownership *through the parent entry* rather than trusting a column on
-- the row being written. This is that, applied to each of the four subjects.
--
-- Writes are not hot: an activity row is created when somebody rates, reviews,
-- relistens or makes a list, never on a read.

drop policy activity_write_own on public.activity;

create policy activity_write_own on public.activity
  for all to authenticated
  using ((select auth.uid()) = actor_id)
  with check (
    (select auth.uid()) = actor_id
    and (
      collection_entry_id is null
      or exists (
        select 1 from public.collection_entries e
        where e.id = collection_entry_id and e.user_id = actor_id
      )
    )
    and (
      relisten_event_id is null
      or exists (
        select 1 from public.relisten_events r
        join public.collection_entries e on e.id = r.collection_entry_id
        where r.id = relisten_event_id and e.user_id = actor_id
      )
    )
    and (
      review_id is null
      or exists (
        select 1 from public.reviews rv
        join public.collection_entries e on e.id = rv.collection_entry_id
        where rv.id = review_id and e.user_id = actor_id
      )
    )
    and (
      list_id is null
      or exists (
        select 1 from public.lists l
        where l.id = list_id and l.user_id = actor_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- notifications — the same gap, one table over
-- ---------------------------------------------------------------------------
--
-- `notifications_actor_insert` checked `actor_id = auth.uid()` and nothing
-- about the relationship the notification claims. `follows` and `review_likes`
-- are publicly readable, so a user could name **somebody else's** follow or like
-- and deliver a fabricated *"X followed you"* to an arbitrary recipient. The
-- per-source unique constraints bound how often, not whether.
--
-- The check now requires the referenced row to be **the actor's own action** —
-- which is the only kind of notification the service ever creates.

drop policy notifications_actor_insert on public.notifications;

create policy notifications_actor_insert on public.notifications
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      follow_id is null
      or exists (
        select 1 from public.follows f
        where f.id = follow_id
          and f.follower_id = actor_id
          and f.followee_id = recipient_id
      )
    )
    and (
      review_like_id is null
      or exists (
        select 1 from public.review_likes rl
        where rl.id = review_like_id and rl.user_id = actor_id
      )
    )
    and (
      list_like_id is null
      or exists (
        select 1 from public.list_likes ll
        where ll.id = list_like_id and ll.user_id = actor_id
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Verified correct, and recorded so the next audit starts from here
-- ---------------------------------------------------------------------------
--
--   follows, want_to_listen        write policies key on the owning column
--   list_likes, review_likes       owner plus an existence check on the subject
--   relisten_events                ownership through the parent entry
--   notifications.read_at          already a column grant, and the precedent
--   profiles, reviews, lists       narrowed by §14.1 in 20260922120000
--   albums, artists, releases,     read-only to anon and authenticated; every
--   tracks, album_artists,         write is service_role
--   discovery_chart_entries,
--   upstream_payloads,
--   ingestion_jobs,
--   catalogue_additions,
--   reserved_handles
