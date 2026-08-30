-- longplayr — follows
--
-- Phase 3's first slice. One relation, and the things worth reading carefully
-- are the identity choice and what is deliberately absent.
--
-- Follows are **asymmetric**: A following B says nothing about B following A.
-- That was carried as [INFERRED] in docs/product-spec.md §4 and was confirmed
-- as a decision on 2026-08-30. There is no mutual-friend semantics anywhere in
-- this table, and a reciprocal row is an ordinary second row.
--
-- Like every user-authored table, this references profiles(id) and never
-- auth.users. An authenticated user mid-onboarding has no profile row, so the
-- foreign key is what makes a completed profile a precondition for following
-- someone. Phase 1 shipped a silent failure from getting this subtly wrong
-- (docs/current-state.md §6).
--
-- **No Activity row, no Notification row.** Following is decided to generate a
-- notification (docs/data-model.md §7) and decided *not* to generate a feed
-- event (docs/product-spec.md §4). Neither table exists yet, and inventing
-- either here would be building ahead.
--
-- **No block interaction.** Follow creation and the relationship lists have no
-- block check because blocking is a later-phase feature (Phase 6). When it
-- arrives it is a service-layer precondition plus a filter on two list
-- queries; it needs nothing from this schema.

create table public.follows (
  -- A surrogate key rather than a composite primary key on the pair, which is
  -- what album_artists uses for its pure join table.
  --
  -- The reason is a documented downstream requirement, not style.
  -- docs/data-model.md §7 gives Notification a nullable `follow_id` alongside
  -- `review_like_id` and `list_like_id`, and requires that unfollowing removes
  -- the notification by cascade. A composite key would force that table to
  -- carry two columns for one of its four subject references.
  id uuid primary key default gen_random_uuid(),

  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,

  -- No user-supplied date, and no updated_at. A follow is created or destroyed;
  -- there is nothing about it to edit, which is also why no update grant is
  -- issued below.
  created_at timestamptz not null default now(),

  constraint follows_one_per_pair unique (follower_id, followee_id),

  -- The final integrity boundary for self-follows. The service returns a
  -- friendly `self_follow` result before attempting the insert, but that check
  -- is a courtesy and must never be treated as the guarantee — the same
  -- division of labour the favourites cap uses (docs/data-model.md §3).
  constraint follows_no_self_follow check (follower_id <> followee_id)
);

comment on table public.follows is
  'Asymmetric follow. A following B implies nothing about B following A.';
comment on column public.follows.id is
  'Surrogate key so notifications.follow_id can reference one column and cascade.';

-- Two indexes because the relation is read in both directions and neither
-- query can use the other's leading column:
--
--   followers of X    where followee_id = X, newest first
--   who X follows     where follower_id = X, newest first
--
-- Both counts on the profile stat cluster are covered by these. The "am I
-- following this person" lookup is served by the unique constraint's own index
-- on (follower_id, followee_id), so it needs nothing further.
create index follows_followee_idx on public.follows (followee_id, created_at desc);
create index follows_follower_idx on public.follows (follower_id, created_at desc);

-- Table privileges. Separate from, and evaluated before, RLS: a role with no
-- GRANT gets "permission denied" no matter how permissive the policies are.
-- Every new table needs this block.
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;
grant all on public.follows to service_role;

-- No update grant, deliberately. There is no column a user could legitimately
-- change: altering follower_id or followee_id would be forging someone else's
-- relationship, and created_at is the system's record of when it happened.

alter table public.follows enable row level security;

-- Everything user-generated is public, by product decision. Follower and
-- following lists are public surfaces and a signed-out visitor sees exactly
-- what a signed-in one does.
create policy follows_public_read on public.follows
  for select using (true);

-- You may only create or destroy your own follows. Keyed on follower_id in both
-- USING and WITH CHECK, so a request cannot insert a row claiming someone else
-- follows you, nor delete a follow you do not own.
create policy follows_write_own on public.follows
  for all to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id);
