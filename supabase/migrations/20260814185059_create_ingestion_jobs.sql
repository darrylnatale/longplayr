-- longplayr — ingestion jobs and catalogue-addition audit
--
-- Two workloads share the MusicBrainz budget of one request per second:
--
--   Fast path   a user adds a specific album; fetched inline, no queue
--   Bulk path   seeding, artwork, editions; queued and drained by cron
--
-- Only the bulk path lives here. Making a user wait behind a queue for the one
-- album they asked for would be the wrong trade (docs/architecture.md §7).

create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed');

create type public.job_kind as enum (
  'ingest_release_group', -- fetch and upsert one release group
  'fetch_artwork', -- resolve cover art for one album
  'fetch_releases' -- lazily fetch a release group's editions
);

create table public.ingestion_jobs (
  id bigint generated always as identity primary key,

  kind public.job_kind not null,

  -- The MBID the job operates on. Kept as text rather than a foreign key
  -- because a job routinely runs before the row it will create exists.
  target_mbid uuid not null,

  status public.job_status not null default 'pending',

  attempts smallint not null default 0,
  max_attempts smallint not null default 3,

  -- Set on failure so a retry waits rather than hammering a failing upstream.
  run_after timestamptz not null default now(),

  last_error text,

  -- Lower runs first. Lets a user-triggered enrichment jump ahead of a large
  -- seeding backlog.
  priority smallint not null default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ingestion_jobs is
  'Bulk ingestion work, drained by a cron endpoint at the MusicBrainz rate limit.';

-- One outstanding job per kind and target. A partial unique index rather than a
-- plain one, so completed jobs do not block the same work being queued again
-- later (a re-sync, say).
create unique index ingestion_jobs_pending_unique
  on public.ingestion_jobs (kind, target_mbid)
  where status in ('pending', 'running');

-- The drain query: ready work, best priority first, oldest first within that.
create index ingestion_jobs_claim_idx
  on public.ingestion_jobs (status, run_after, priority, id)
  where status = 'pending';

create trigger ingestion_jobs_set_updated_at
  before update on public.ingestion_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalogue additions
--
-- Audit trail for self-service additions, and the basis for rate limiting them
-- at 30/hour and 100/day per user (docs/product-spec.md §8.4).
-- ---------------------------------------------------------------------------

create table public.catalogue_additions (
  id bigint generated always as identity primary key,

  -- Survives account deletion as an anonymous row: the audit record of what
  -- entered the catalogue matters even when the person is gone, and it carries
  -- nothing personal once the reference is cleared.
  user_id uuid references public.profiles (id) on delete set null,

  album_mbid uuid not null,

  created_at timestamptz not null default now()
);

comment on table public.catalogue_additions is
  'Who added which album to the catalogue, for rate limiting and after-the-fact review.';

create index catalogue_additions_user_time_idx
  on public.catalogue_additions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Neither table is public. Jobs are internal machinery, and the additions log
-- records who did what — visible to admins, not to everyone.
-- ---------------------------------------------------------------------------

grant all on public.ingestion_jobs to service_role;
grant usage, select on sequence public.ingestion_jobs_id_seq to service_role;
grant all on public.catalogue_additions to service_role;
grant usage, select on sequence public.catalogue_additions_id_seq to service_role;

alter table public.ingestion_jobs enable row level security;
alter table public.catalogue_additions enable row level security;

-- No policies at all: only the service role, which bypasses RLS, may touch
-- these. Anonymous and authenticated clients get nothing.
