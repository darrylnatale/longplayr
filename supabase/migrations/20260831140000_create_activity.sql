-- longplayr — activity
--
-- Phase 3, slice 2. Materialised feed events. **The table only, plus the write
-- points; there is no feed query and no feed surface in this slice.** The
-- reason for the split is the anti-flood rule below: `development-plan.md`
-- calls it the single most important test in the phase, because its failure
-- floods every follower's feed and is not recoverable. It is settled and
-- tested here, before anything renders it.
--
-- **The eligibility rule is the write path, not the date.** An interactive add
-- produces a `listened` event; a historical or backfilled write produces
-- nothing. `listened_on` does not decide it — an album added by hand is an
-- interaction whether the listen was last night or in 1997 (CLAUDE.md).
--
-- **Four types, and the omissions are deliberate.** `list_created` and
-- `list_updated` arrive with Phase 4, and their `list_id` column cannot even be
-- written yet because `lists` does not exist. Want to Listen is excluded
-- because whether *removing* generates an event is still `[OPEN]`
-- (`product-spec.md` §10.1). Likes generate nothing at all, by decision — they
-- would dominate by volume and crowd out reviews (`product-spec.md` §4).

create type public.activity_type as enum ('listened', 'relistened', 'rated', 'reviewed');

create table public.activity (
  id uuid primary key default gen_random_uuid(),

  actor_id uuid not null references public.profiles (id) on delete cascade,

  type public.activity_type not null,

  -- Exactly one of the three is set, and which one is a function of the type.
  --
  -- **Events reference live data; they never snapshot it** (`data-model.md`
  -- §7). A feed item showing a rating reads the current value from the entry,
  -- so an edit propagates everywhere and the feed never displays a claim that
  -- has stopped being true. Undoing the action removes the event, which is what
  -- the cascades below are for.
  collection_entry_id uuid references public.collection_entries (id) on delete cascade,
  relisten_event_id uuid references public.relisten_events (id) on delete cascade,
  review_id uuid references public.reviews (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- One subject, matching the type. Without this a row could claim to be a
  -- `reviewed` event while pointing at a relisten, and the feed would have to
  -- defend against a state the table should never have allowed.
  constraint activity_subject_matches_type check (
    case type
      when 'listened' then collection_entry_id is not null
        and relisten_event_id is null
        and review_id is null
      when 'rated' then collection_entry_id is not null
        and relisten_event_id is null
        and review_id is null
      when 'relistened' then relisten_event_id is not null
        and collection_entry_id is null
        and review_id is null
      when 'reviewed' then review_id is not null
        and collection_entry_id is null
        and relisten_event_id is null
    end
  ),

  -- One event per relisten and per review. Nulls do not collide in a unique
  -- constraint, so these bind only on the rows that carry the column.
  constraint activity_one_per_relisten unique (relisten_event_id),
  constraint activity_one_per_review unique (review_id)
);

comment on table public.activity is
  'Materialised feed events. Written at the moment a user acts; historical and backfilled writes produce none.';

-- **At most one `listened` and one `rated` per entry, and the asymmetry with
-- relistens is the point.**
--
-- Re-rating an album edits what the feed already shows rather than announcing
-- it again, because the event reads the entry's live value. Relistens are the
-- opposite and deliberately unconstrained: three relistens are three rows,
-- because three feed items cannot come from a counter (`data-model.md` §4).
create unique index activity_one_listened_per_entry
  on public.activity (collection_entry_id)
  where type = 'listened';

create unique index activity_one_rated_per_entry
  on public.activity (collection_entry_id)
  where type = 'rated';

-- The shape the feed query will need: an actor's events, newest first, over the
-- follow graph. Built now because the column pair is already known and adding
-- it later would mean a migration against a populated table.
create index activity_actor_idx on public.activity (actor_id, created_at desc);

-- Table privileges, evaluated before RLS. Every new table needs this block.
grant select on public.activity to anon, authenticated;
grant insert, delete on public.activity to authenticated;
grant all on public.activity to service_role;

-- **No update grant.** An event is written or removed; there is nothing on it
-- to edit. The values a feed item displays live on the referenced row, so
-- editing a rating changes what the event shows without touching the event.

alter table public.activity enable row level security;

-- Everything user-generated is public. The feed filters by the follow graph in
-- application code; it is not a visibility boundary.
create policy activity_public_read on public.activity
  for select using (true);

-- You may only create or destroy your own activity. Keyed on `actor_id` in both
-- USING and WITH CHECK, so a request cannot attribute an event to someone else.
create policy activity_write_own on public.activity
  for all to authenticated
  using ((select auth.uid()) = actor_id)
  with check ((select auth.uid()) = actor_id);
