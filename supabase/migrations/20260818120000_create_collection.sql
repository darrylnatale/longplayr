-- longplayr — the collection and its satellites
--
-- Phase 2's schema. Five relations, and the relationships between them are the
-- part worth reading carefully:
--
--   collection_entries   one row per user per album, permanently. The core.
--   relisten_events      discrete rows. The truth behind relisten_count.
--   reviews              one-to-one with an entry, separately moderatable.
--   favourite_albums     independent of the collection, capped at ten.
--   want_to_listen       independent of the collection. Intent, not history.
--
-- Every user-authored table references profiles(id), never auth.users. That is
-- not a style preference: an authenticated user without a handle has no profile
-- row, so the foreign key is what makes a completed profile a precondition for
-- authoring anything. Phase 1 already shipped a silent failure from getting
-- this subtly wrong (docs/current-state.md §6).

-- ---------------------------------------------------------------------------
-- collection_entries
-- ---------------------------------------------------------------------------

create table public.collection_entries (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id) on delete cascade,

  -- 0.0 to 10.0 to one decimal. numeric(3,1) enforces the precision; the check
  -- enforces the range. Null means unrated, which is distinct from 0.0 — 0.0 is
  -- a real score somebody chose, and averages exclude nulls, not zeroes.
  rating numeric(3, 1)
    constraint collection_entries_rating_range
    check (rating >= 0 and rating <= 10),

  liked boolean not null default false,

  -- Denormalised for cheap grid display. Maintained by trigger from
  -- relisten_events, which are the actual record.
  relisten_count integer not null default 0
    constraint collection_entries_relisten_count_non_negative
    check (relisten_count >= 0),

  -- What the user asserts. Nullable, and freely backdated.
  --
  -- This does NOT decide feed eligibility. That rule keys on whether the write
  -- was an interaction or a backfill, never on this column (CLAUDE.md).
  listened_on date,

  -- What actually happened. Never null, never user-supplied.
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One entry per user per album, permanently. Non-negotiable: longplayr is a
  -- collection, not a dated diary.
  constraint collection_entries_one_per_user_per_album unique (user_id, album_id)
);

comment on table public.collection_entries is
  'One row per user per album, permanently. The product''s core entity.';
comment on column public.collection_entries.rating is
  '0.0-10.0 to one decimal. Null is unrated; 0.0 is a score. Averages exclude nulls.';
comment on column public.collection_entries.listened_on is
  'User-asserted, backdatable. Never decides feed eligibility.';

-- The collection view: a user's entries, newest first.
--
-- Indexed on added_at rather than on coalesce(listened_on, added_at). The
-- coalesce expression cannot be indexed — casting timestamptz to date depends
-- on the session time zone, so it is not IMMUTABLE and Postgres rejects it.
-- Both columns are present, so the planner can still use this for the common
-- ordering; the interleaved sort itself is a Phase 5 concern, at a catalogue
-- size where it will actually matter.
create index collection_entries_user_idx
  on public.collection_entries (user_id, added_at desc);

create index collection_entries_user_listened_idx
  on public.collection_entries (user_id, listened_on desc nulls last);

-- Average and count for one album, and the "who else has this" read.
create index collection_entries_album_idx on public.collection_entries (album_id);

-- Rating aggregation reads only non-null ratings, so the partial index is the
-- one that matters for averages.
create index collection_entries_album_rating_idx
  on public.collection_entries (album_id)
  where rating is not null;

create trigger collection_entries_set_updated_at
  before update on public.collection_entries
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- relisten_events
-- ---------------------------------------------------------------------------

create table public.relisten_events (
  id uuid primary key default gen_random_uuid(),
  collection_entry_id uuid not null
    references public.collection_entries (id) on delete cascade,
  occurred_at timestamptz not null default now()
);

comment on table public.relisten_events is
  'Discrete relistens. Three relistens are three rows, because three feed items cannot come from a counter.';

create index relisten_events_entry_idx
  on public.relisten_events (collection_entry_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- relisten_count, maintained by trigger
-- ---------------------------------------------------------------------------
--
-- A trigger rather than service-layer logic, deliberately.
--
-- supabase-js has no multi-statement transaction API, so a service-layer
-- version is two round-trips with a window between them in which a failure
-- leaves the counter wrong — or it becomes a database function anyway. Here the
-- insert and the increment are one statement's worth of work in one
-- transaction, so drift is not merely unlikely, it is unrepresentable.
--
-- It also survives write paths that do not exist yet. A backfill, an admin
-- tool, or a future bulk import all get a correct counter without knowing they
-- were supposed to maintain one.
--
-- Nothing but arithmetic lives here. The rows remain the truth; this column is
-- a convenience for rendering a grid, and no business rule reads it.

create or replace function public.sync_relisten_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.collection_entries
       set relisten_count = relisten_count + 1
     where id = new.collection_entry_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.collection_entries
       set relisten_count = greatest(relisten_count - 1, 0)
     where id = old.collection_entry_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger relisten_events_sync_count
  after insert or delete on public.relisten_events
  for each row
  execute function public.sync_relisten_count();

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

create type public.content_status as enum ('live', 'removed');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),

  -- One-to-one with the entry. A review is about an album the user holds, and
  -- routing it through the entry means "one review per user per album" needs no
  -- second uniqueness rule to stay true.
  collection_entry_id uuid not null unique
    references public.collection_entries (id) on delete cascade,

  -- Plain text with line breaks. No Markdown: it adds a sanitisation surface,
  -- an editor and a preview mode for writing that is short by nature.
  body text not null
    constraint reviews_body_length
    check (char_length(body) between 1 and 10000),

  -- Soft delete for moderation. The whole reason this is its own table rather
  -- than a column: removing a review must not destroy the collection entry.
  status public.content_status not null default 'live',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reviews is
  'One standing review per collection entry, editable in place. No version history.';

-- Reviews shown on an album page: live ones, newest first.
create index reviews_live_idx
  on public.reviews (created_at desc)
  where status = 'live';

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- favourite_albums
-- ---------------------------------------------------------------------------
--
-- Independent of the collection by decision C: you may favourite an album you
-- have not added, and favouriting does not add it, because a favourite is a
-- statement about taste rather than a record of listening.

create table public.favourite_albums (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id) on delete cascade,

  -- 1-10, user-controlled ordering.
  --
  -- The cap of ten is enforced here rather than only in the service layer. A
  -- count-then-insert check in application code is racy: two concurrent
  -- requests can both observe nine and both insert. Bounding the position and
  -- making it unique per user caps the table at ten rows by construction, with
  -- no trigger and no counter to drift.
  position integer not null
    constraint favourite_albums_position_range
    check (position between 1 and 10),

  created_at timestamptz not null default now(),

  constraint favourite_albums_one_per_user_per_album unique (user_id, album_id),

  -- Deferrable so a reorder can move several rows within one transaction
  -- without tripping over itself mid-update.
  constraint favourite_albums_position_unique unique (user_id, position)
    deferrable initially immediate
);

comment on table public.favourite_albums is
  'Up to ten pinned albums per user. Independent of the collection: pinning does not add.';
comment on constraint favourite_albums_position_unique on public.favourite_albums is
  'With the 1-10 position check, this is what caps favourites at ten. Deferrable so reordering works.';

create index favourite_albums_user_idx on public.favourite_albums (user_id, position);

-- ---------------------------------------------------------------------------
-- want_to_listen
-- ---------------------------------------------------------------------------
--
-- Intent, not history. An INDEPENDENT relation from the collection: an album
-- may legally sit in both, and nothing here may prevent that.
--
-- The clearing rule — any action that causes a collection entry to exist clears
-- Want to Listen for that album — is a one-directional side effect implemented
-- in ensure_collection_entry() below. It does not run in reverse, and it does
-- not fire when a wishlist row is created, so an album collected first and
-- wished second stays in both. That state is legal and must remain
-- representable, which is why there is deliberately no exclusion constraint
-- against collection_entries here.

create table public.want_to_listen (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  album_id uuid not null references public.albums (id) on delete cascade,

  -- No user-supplied date. An intention cannot be backdated.
  added_at timestamptz not null default now(),

  constraint want_to_listen_one_per_user_per_album unique (user_id, album_id)
);

comment on table public.want_to_listen is
  'Albums a user intends to hear. Independent of the collection; both may hold the same album.';

create index want_to_listen_user_idx on public.want_to_listen (user_id, added_at desc);

-- ---------------------------------------------------------------------------
-- ensure_collection_entry — the single mutation path
-- ---------------------------------------------------------------------------
--
-- Every action that causes a collection entry to exist goes through here:
-- the explicit add, and the implicit ones behind rating, liking, reviewing and
-- relistening. One path rather than five, so the clearing rule cannot be
-- implemented four times and forgotten once.
--
-- It is a database function because the upsert and the Want to Listen clear
-- must be atomic. Two statements from the client would leave a window where a
-- collected album is still on the wishlist if the second call fails.
--
-- **This function creates an entry. It does not create an event.** Activity
-- belongs to the social phase, and an implicit add must never announce a listen
-- the user never claimed — they rated a record; they did not say they heard it
-- (docs/product-spec.md §8.5).
--
-- `p_listened_on` is only applied when the entry is created. Re-running this
-- for an album already held must not silently rewrite the date the user set.

create or replace function public.ensure_collection_entry(
  p_user_id uuid,
  p_album_id uuid,
  p_listened_on date default null
)
returns public.collection_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  entry public.collection_entries;
begin
  insert into public.collection_entries (user_id, album_id, listened_on)
  values (p_user_id, p_album_id, p_listened_on)
  on conflict (user_id, album_id) do update
    -- A no-op touch, so the row is returned whether it was inserted or already
    -- present. Deliberately does not overwrite listened_on.
    set updated_at = public.collection_entries.updated_at
  returning * into entry;

  -- The clearing rule. One-directional: creating an entry clears the wish,
  -- never the reverse.
  delete from public.want_to_listen
   where user_id = p_user_id
     and album_id = p_album_id;

  return entry;
end;
$$;

comment on function public.ensure_collection_entry is
  'The single path by which a collection entry comes to exist. Clears Want to Listen. Creates no activity event.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Evaluated before RLS: without these, a permissive policy still yields
-- "permission denied". Every new table needs this block.

grant select on public.collection_entries to anon, authenticated;
grant insert, update, delete on public.collection_entries to authenticated;
grant all on public.collection_entries to service_role;

grant select on public.relisten_events to anon, authenticated;
grant insert, delete on public.relisten_events to authenticated;
grant all on public.relisten_events to service_role;

grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;

grant select on public.favourite_albums to anon, authenticated;
grant insert, update, delete on public.favourite_albums to authenticated;
grant all on public.favourite_albums to service_role;

grant select on public.want_to_listen to anon, authenticated;
grant insert, delete on public.want_to_listen to authenticated;
grant all on public.want_to_listen to service_role;

grant execute on function public.ensure_collection_entry(uuid, uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Defence in depth, not the primary authorisation mechanism — that lives in the
-- service layer (docs/architecture.md §5). Everything user-generated is public
-- by product decision, so reads are open and writes are owner-only.

alter table public.collection_entries enable row level security;
alter table public.relisten_events enable row level security;
alter table public.reviews enable row level security;
alter table public.favourite_albums enable row level security;
alter table public.want_to_listen enable row level security;

create policy collection_entries_public_read on public.collection_entries
  for select using (true);
create policy collection_entries_write_own on public.collection_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Relistens and reviews are owned transitively, through their entry.
create policy relisten_events_public_read on public.relisten_events
  for select using (true);
create policy relisten_events_write_own on public.relisten_events
  for all to authenticated
  using (
    exists (
      select 1 from public.collection_entries e
      where e.id = collection_entry_id and e.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.collection_entries e
      where e.id = collection_entry_id and e.user_id = (select auth.uid())
    )
  );

-- Removed reviews stay readable to their author, so moderation does not make
-- someone's own writing vanish without explanation.
create policy reviews_public_read on public.reviews
  for select using (
    status = 'live'
    or exists (
      select 1 from public.collection_entries e
      where e.id = collection_entry_id and e.user_id = (select auth.uid())
    )
  );
create policy reviews_write_own on public.reviews
  for all to authenticated
  using (
    exists (
      select 1 from public.collection_entries e
      where e.id = collection_entry_id and e.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.collection_entries e
      where e.id = collection_entry_id and e.user_id = (select auth.uid())
    )
  );

create policy favourite_albums_public_read on public.favourite_albums
  for select using (true);
create policy favourite_albums_write_own on public.favourite_albums
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Read stays open pending the product question of whether Want to Listen is
-- public on profiles (docs/data-model.md §11.3). Open means undecided, and the
-- all-public model is the current default; narrowing it later is a policy
-- change, not a migration.
create policy want_to_listen_public_read on public.want_to_listen
  for select using (true);
create policy want_to_listen_write_own on public.want_to_listen
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
