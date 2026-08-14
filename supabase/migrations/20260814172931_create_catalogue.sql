-- longplayr — catalogue
--
-- Read-only downstream of MusicBrainz. Nothing here is user-authored, so every
-- table is publicly readable and writable only by the ingestion service.
--
-- Shape follows docs/data-model.md §2:
--   Artist ──< album_artists >── Album (release group) ──< Release ──< Track
--
-- MBIDs are the natural keys. Ingestion upserts on them, which is what keeps
-- re-ingesting an album from creating duplicates.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- MusicBrainz release-group primary types we accept. Singles are deliberately
-- absent: catalogue scope is albums, EPs and mixtapes, enforced at ingest.
create type public.album_type as enum ('album', 'ep', 'other');

-- Secondary types modify a primary type rather than replacing it: a live album
-- is primary 'album' plus secondary 'live'.
create type public.album_secondary_type as enum (
  'compilation',
  'soundtrack',
  'live',
  'remix',
  'mixtape',
  'demo',
  'spokenword',
  'interview',
  'audiobook',
  'dj_mix'
);

-- What the source actually knew, so display never invents precision.
create type public.date_precision as enum ('day', 'month', 'year');

-- Whether we have cover art. Recorded rather than inferred so that coverage is
-- a number we can query — Cover Art Archive is our only source and has real
-- gaps (docs/architecture.md §7).
create type public.artwork_status as enum ('pending', 'found', 'absent');

-- ---------------------------------------------------------------------------
-- Artists
-- ---------------------------------------------------------------------------

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  mbid uuid not null unique,

  name text not null,
  sort_name text not null,

  -- MusicBrainz's short qualifier, used when two artists share a name
  -- ("Nirvana (US grunge band)"). Displayed only where ambiguity exists.
  disambiguation text,

  -- Person, Group, Orchestra, Choir, Character, Other. Free text because
  -- MusicBrainz adds values and an enum would need a migration each time.
  type text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.artists is 'Artists, mirrored from MusicBrainz. Never user-authored.';

create index artists_name_trgm_idx on public.artists using gin (name gin_trgm_ops);
create index artists_sort_name_idx on public.artists (sort_name);

-- ---------------------------------------------------------------------------
-- Albums (MusicBrainz release groups)
-- ---------------------------------------------------------------------------

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  mbid uuid not null unique,

  title text not null,

  -- The credit string exactly as MusicBrainz renders it, e.g. "Jay-Z & Kanye
  -- West". Cached so we never reimplement join-phrase logic; album_artists
  -- exists for linking and discography queries, not for display.
  display_credit text not null,

  primary_type public.album_type not null,
  secondary_types public.album_secondary_type[] not null default '{}',

  -- Stored as a full date with defaults filled (missing day -> 1st, missing
  -- month -> January) so sorting and range queries stay trivial. The precision
  -- column is what keeps display honest.
  first_release_date date,
  first_release_date_precision public.date_precision,

  -- Tracklists belong to releases in MusicBrainz, not release groups, so the
  -- album page has to nominate one. Chosen by the deterministic rule in
  -- docs/data-model.md §2.
  representative_release_id uuid,

  artwork_status public.artwork_status not null default 'pending',
  artwork_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.albums is
  'Release groups. The social object: ratings, reviews and list items all attach here.';

create index albums_title_trgm_idx on public.albums using gin (title gin_trgm_ops);
create index albums_release_date_idx on public.albums (first_release_date desc nulls last);
create index albums_artwork_status_idx on public.albums (artwork_status);

-- ---------------------------------------------------------------------------
-- Album artists
-- ---------------------------------------------------------------------------

create table public.album_artists (
  album_id uuid not null references public.albums (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,

  -- Credit order. Position 0 is the primary artist.
  position smallint not null,

  primary key (album_id, artist_id)
);

comment on table public.album_artists is
  'Links albums to every credited artist. This is what makes a collaboration appear on the page of each artist involved.';

create index album_artists_artist_idx on public.album_artists (artist_id);

-- ---------------------------------------------------------------------------
-- Releases (editions)
-- ---------------------------------------------------------------------------

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  mbid uuid not null unique,

  album_id uuid not null references public.albums (id) on delete cascade,

  title text not null,

  -- Official, Promotion, Bootleg, Pseudo-Release. Drives representative-release
  -- selection, which prefers the earliest Official.
  status text,

  release_date date,
  release_date_precision public.date_precision,

  country text,
  -- CD, Digital Media, Vinyl, Cassette… free text; MusicBrainz has many.
  format text,
  label text,
  track_count smallint,
  disambiguation text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.releases is
  'Specific editions. Fetched lazily — most users never open the editions UI.';

create index releases_album_idx on public.releases (album_id);

alter table public.albums
  add constraint albums_representative_release_fk
  foreign key (representative_release_id)
  references public.releases (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- Tracks
-- ---------------------------------------------------------------------------

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,

  position smallint not null,
  -- Multi-disc releases; 1 for single-disc.
  medium_position smallint not null default 1,

  title text not null,
  length_ms integer,

  unique (release_id, medium_position, position)
);

comment on table public.tracks is
  'Tracklist entries, display only. Never rated, reviewed, logged or listed.';

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- Full-text over title plus credit, so "radiohead kid a" matches. Trigram
-- indexes above handle typos; this handles word matching and ranking.
alter table public.albums
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(display_credit, '')), 'B')
  ) stored;

create index albums_search_idx on public.albums using gin (search_vector);

alter table public.artists
  add column search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(name, ''))) stored;

create index artists_search_idx on public.artists using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger artists_set_updated_at
  before update on public.artists
  for each row execute function public.set_updated_at();

create trigger albums_set_updated_at
  before update on public.albums
  for each row execute function public.set_updated_at();

create trigger releases_set_updated_at
  before update on public.releases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Grants are evaluated before RLS: without them, every query fails with
-- "permission denied" no matter how permissive the policies are.
--
-- The catalogue is readable by everyone and writable only by the ingestion
-- service, which runs with the service role. No user ever writes here.
-- ---------------------------------------------------------------------------

grant select on public.artists, public.albums, public.album_artists,
  public.releases, public.tracks to anon, authenticated;

grant all on public.artists, public.albums, public.album_artists,
  public.releases, public.tracks to service_role;

alter table public.artists enable row level security;
alter table public.albums enable row level security;
alter table public.album_artists enable row level security;
alter table public.releases enable row level security;
alter table public.tracks enable row level security;

create policy artists_public_read on public.artists for select using (true);
create policy albums_public_read on public.albums for select using (true);
create policy album_artists_public_read on public.album_artists for select using (true);
create policy releases_public_read on public.releases for select using (true);
create policy tracks_public_read on public.tracks for select using (true);

-- No insert/update/delete policies. The service role bypasses RLS, so
-- ingestion works; everyone else is read-only by omission.
