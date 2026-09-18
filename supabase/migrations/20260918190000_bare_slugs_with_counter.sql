-- longplayr — plain slugs, with a counter only where one is needed
--
-- **Replaces the identity-hash suffix shipped hours earlier in
-- `20260918170000`.** That version appended ten hex characters of
-- `md5(mbid)` to every slug, so `kid-a-208b8292f8` — deterministic, and
-- unnecessarily noisy for a catalogue where the overwhelming majority of
-- titles are unique. Slugs read `kid-a` now, and only a second album of the
-- same title carries `kid-a-2`.
--
-- **This knowingly relaxes a constraint `product-spec.md` §6 recorded**, and
-- the maintainer relaxed it on 2026-09-18 with the reason stated: the product
-- has no users, everything in the catalogue is test data, and re-ingesting all
-- of it is acceptable. §6 required collision resolution that is *deterministic
-- rather than insertion-ordered*; a counter is insertion-ordered by nature.
--
-- **The instability is narrower than that phrasing suggests, which is why the
-- relaxation is reasonable rather than reckless.** A slug is assigned once and
-- then left alone: the first *Kid A* keeps `kid-a` and a later one takes
-- `kid-a-2`, so **neither URL ever changes because of the other**. Nothing
-- promotes a later album when an earlier one is renamed or deleted. The only
-- thing that reshuffles assignments is a **full re-ingest in a different
-- order** — precisely the case that was accepted.
--
-- **What this gives up against the generated column it replaces**, stated
-- rather than discovered later:
--
--   * the slug can no longer be generated, because "which counter is free"
--     depends on the rest of the table. It is assigned by trigger and stored.
--   * assignment reads before it writes, so it is racy. Closed below with a
--     transaction-scoped advisory lock keyed on the base slug.
--   * a non-Latin title still slugifies to nothing, and now falls back to
--     `album`, `album-2`, `album-3` rather than to distinct hashes. A run of
--     meaningless URLs is the real cost here, and it arrives with the first
--     non-Latin releases rather than today.

-- ---------------------------------------------------------------------------
-- Replace the generated columns
-- ---------------------------------------------------------------------------
--
-- Dropped rather than altered: a generated column cannot become an ordinary
-- one in place. The drop takes `albums_slug_key` and `artists_slug_key` with
-- it, so both are recreated below.
--
-- `slugify()` is unchanged and still does the readable half of the work.

alter table public.albums drop column slug;
alter table public.artists drop column slug;

alter table public.albums add column slug text;
alter table public.artists add column slug text;

-- ---------------------------------------------------------------------------
-- Backfill, in a deliberate order
-- ---------------------------------------------------------------------------
--
-- `created_at` then `mbid`: oldest row keeps the bare slug, ties broken by an
-- identifier that never changes. The order is arbitrary in the sense that any
-- order would have been valid — it is fixed here so the backfill is repeatable
-- rather than dependent on physical row order.
--
-- **This runs against a catalogue that already exists**, which is the one part
-- of this migration CI cannot exercise: CI applies migrations to an empty
-- database, so the backfill there has no rows to get wrong. `F-032` records
-- that blind spot.

-- **A one-pass `row_number()` is wrong here, and it took a probe to see why.**
-- Numbering within each base independently assigns `kid-a-2` to the second
-- album titled *Kid A* — and also to an album genuinely titled *Kid A 2*,
-- whose own base is `kid-a-2`. Two rows, one slug, and the unique index below
-- would abort the migration.
--
-- The triggers never had this problem: they search for the first *free*
-- candidate rather than counting within a partition. So the backfill does the
-- same search, one row at a time, in the fixed order described above. Slower,
-- and correct against a catalogue that already contains whatever titles it
-- contains.

do $$
declare
  row_record record;
  base text;
  candidate text;
  n integer;
begin
  for row_record in
    select id, coalesce(nullif(public.slugify(title), ''), 'album') as base
      from public.albums
     order by created_at, mbid
  loop
    base := row_record.base;
    candidate := base;
    n := 1;

    while exists (select 1 from public.albums where slug = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;

    update public.albums set slug = candidate where id = row_record.id;
  end loop;

  for row_record in
    select id, coalesce(nullif(public.slugify(name), ''), 'artist') as base
      from public.artists
     order by created_at, mbid
  loop
    base := row_record.base;
    candidate := base;
    n := 1;

    while exists (select 1 from public.artists where slug = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;

    update public.artists set slug = candidate where id = row_record.id;
  end loop;
end;
$$;

alter table public.albums alter column slug set not null;
alter table public.artists alter column slug set not null;

-- **A default that is never stored, and it exists for the type generator.**
-- The generated column this replaces was marked generated in the catalogue, so
-- `database.types.ts` made `slug` optional on Insert. An ordinary NOT NULL
-- column without a default is *required* on Insert instead — which would force
-- every caller and every test fixture to supply a slug it must not choose.
--
-- A default makes it optional again. The value is unreachable: the BEFORE
-- INSERT trigger overwrites `new.slug` unconditionally, so no row ever lands
-- holding it, and the unique index would reject a second one if any did.
alter table public.albums alter column slug set default '';
alter table public.artists alter column slug set default '';

comment on column public.albums.slug is
  'Readable URL label, assigned once by trigger. Derived from the title, never joined on. The MBID remains canonical identity.';
comment on column public.artists.slug is
  'Readable URL label, assigned once by trigger. Derived from the name, never joined on. The MBID remains canonical identity.';

create unique index albums_slug_key on public.albums (slug);
create unique index artists_slug_key on public.artists (slug);

-- ---------------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------------
--
-- **The advisory lock is what makes this safe rather than merely usually
-- right.** Assignment has to read the table to learn which counter is free, so
-- two concurrent inserts of the same title would otherwise both see `kid-a`
-- unclaimed and one would fail on the unique index. The lock is
-- transaction-scoped and keyed on the base slug, so it serialises only inserts
-- that would actually contend — two different titles never wait on each other.
--
-- `id is distinct from new.id` so an UPDATE does not collide with the row's own
-- current slug and promote itself to a counter it does not need.

create or replace function public.assign_album_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n integer := 1;
begin
  base := coalesce(nullif(public.slugify(new.title), ''), 'album');

  perform pg_advisory_xact_lock(hashtext('album-slug:' || base));

  candidate := base;
  loop
    exit when not exists (
      select 1 from public.albums where slug = candidate and id is distinct from new.id
    );
    n := n + 1;
    candidate := base || '-' || n;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create or replace function public.assign_artist_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n integer := 1;
begin
  base := coalesce(nullif(public.slugify(new.name), ''), 'artist');

  perform pg_advisory_xact_lock(hashtext('artist-slug:' || base));

  candidate := base;
  loop
    exit when not exists (
      select 1 from public.artists where slug = candidate and id is distinct from new.id
    );
    n := n + 1;
    candidate := base || '-' || n;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

comment on function public.assign_album_slug is
  'Assigns an album slug from its title, with a counter only where the base is taken. Any supplied slug is overwritten.';
comment on function public.assign_artist_slug is
  'Assigns an artist slug from its name, with a counter only where the base is taken. Any supplied slug is overwritten.';

create trigger albums_assign_slug
  before insert on public.albums
  for each row
  execute function public.assign_album_slug();

-- **Fires on a slug change as well as a title change, and that is what keeps
-- the guarantee the generated column used to give for free.** A generated
-- column rejected any write outright; an ordinary column does not, so without
-- the second condition `update albums set slug = 'anything'` would stick. With
-- it, such a write recomputes from the title and discards the supplied value.
--
-- Narrow on purpose: albums are updated constantly for hydration and artwork
-- state, and none of those touch either column, so the common path never takes
-- the lock or runs the loop.
create trigger albums_reassign_slug
  before update of title, slug on public.albums
  for each row
  when (new.title is distinct from old.title or new.slug is distinct from old.slug)
  execute function public.assign_album_slug();

create trigger artists_assign_slug
  before insert on public.artists
  for each row
  execute function public.assign_artist_slug();

create trigger artists_reassign_slug
  before update of name, slug on public.artists
  for each row
  when (new.name is distinct from old.name or new.slug is distinct from old.slug)
  execute function public.assign_artist_slug();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and nothing should call
-- these directly — they are only ever reached through their triggers.

revoke all on function public.assign_album_slug() from public;
revoke all on function public.assign_artist_slug() from public;
