-- longplayr — distinguish a minimally hydrated album from a fully fetched one
--
-- Progressive hydration (docs/architecture.md §7) creates album rows from a
-- MusicBrainz *browse* response. A browse response carries every column an
-- album card needs and no releases at all; a full release-group fetch carries
-- both. Crucially, **both leave representative_release_id null when a release
-- group holds no releases**, so that column alone cannot say which happened.
--
-- The distinction is load-bearing: without it nothing can tell what still needs
-- fetching, and inferring it from the shape of a stored payload would be
-- exactly the kind of state nothing points at — the failure class already
-- recorded for artwork coverage and for jobs stuck in `running`.
--
-- Two states, not the four used by artwork_status and tracklist_status. Both
-- omissions are deliberate:
--
--   No `absent`. "Fetched, and the release group genuinely holds no releases"
--   is already carried by (hydration_status = 'fetched' AND
--   representative_release_id IS NULL). A third value would encode one fact
--   twice.
--
--   No `failed`. `pending` means "not successfully fetched", which is honest
--   whether the attempt never happened, failed, or exhausted its retries.
--   ingestion_jobs remains the source of truth for retry and error state.
--   The artwork precedent does not transfer: `failed` earns its place there
--   because artworkCoverage() would otherwise report success it had not
--   achieved, and hydration has no equivalent metric.

create type public.hydration_status as enum ('pending', 'fetched');

alter table public.albums
  add column hydration_status public.hydration_status not null default 'pending',
  add column hydration_updated_at timestamptz;

comment on column public.albums.hydration_status is
  'Whether the full release-group detail has been fetched. Read together with representative_release_id: fetched + null means the release group genuinely holds no releases.';

comment on column public.albums.hydration_updated_at is
  'When hydration_status last changed.';

-- Backfill from evidence held now, not from assumption about history.
--
-- A stored release_group payload is the observable record of a completed full
-- fetch: ingestReleaseGroupPayload writes it after the scope filter and before
-- any column is mapped, so its presence means the full response was received.
-- That is the whole of the claim being made here — nothing is asserted about
-- how, when, or by which path any particular album was originally created.
--
-- Albums without such a payload stay `pending`, which is the honest reading:
-- we hold no evidence that their full detail was fetched. They are then
-- indistinguishable from browse-created rows, and correctly so.
update public.albums a
set hydration_status = 'fetched',
    hydration_updated_at = now()
where exists (
  select 1
  from public.upstream_payloads p
  where p.source = 'musicbrainz'
    and p.kind = 'release_group'
    and p.source_id = a.mbid::text
);

-- The drain and the tranche driver both ask "which albums are still pending",
-- and both run against a table that is about to grow substantially.
create index albums_hydration_status_idx
  on public.albums (hydration_status)
  where hydration_status = 'pending';
