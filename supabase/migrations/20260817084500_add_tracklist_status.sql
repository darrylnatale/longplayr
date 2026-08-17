-- longplayr — record whether a release's tracklist was actually fetched
--
-- Ingestion costs two MusicBrainz requests: the release group, then the
-- representative release for its tracklist. The second request was allowed to
-- fail quietly —
--
--     } catch {
--       // A missing or broken tracklist must not fail an otherwise good album.
--       return null;
--     }
--
-- — which is the right instinct and the wrong implementation. The album was
-- written, nothing recorded that the tracklist had been attempted, and no work
-- was queued to try again. 44 of 335 albums on staging have no tracklist as a
-- result, indistinguishable from albums nobody has looked at yet. That is 13%,
-- which matches the rate at which MusicBrainz sheds load at its edge.
--
-- This is the same failure-as-success shape already corrected for artwork, and
-- it gets the same four states. The distinction that carries the weight is
-- between the last two:
--
--   pending  not attempted
--   found    fetched and stored
--   absent   MusicBrainz answered, and the release carries no tracks
--   failed   the request errored                              (retryable)
--
-- The status lives on `releases` rather than on `albums` deliberately. A
-- tracklist is a property of one release. Were it held on the album and
-- `representative_release_id` later moved to a different release, the album
-- would go on reporting `found` while the release it now points at has no
-- tracks at all. On the release it stays true without anyone maintaining it.

create type public.tracklist_status as enum ('pending', 'found', 'absent', 'failed');

alter table public.releases
  add column tracklist_status public.tracklist_status not null default 'pending',
  add column tracklist_updated_at timestamptz;

comment on column public.releases.tracklist_status is
  'Whether this release''s tracklist was fetched. absent is a fact about the release; failed is a fact about the network.';

-- Backfill from evidence we already hold: a release with tracks was plainly
-- fetched successfully.
--
-- Everything else stays `pending`, including the 44 representative releases
-- whose fetch failed. They were attempted, but nothing recorded it, and
-- marking them `failed` would assert a history we cannot actually observe.
-- `pending` is the honest description of what we know, and recovery sweeps
-- both `pending` and `failed`, so nothing is missed by being truthful here.
update public.releases r
set tracklist_status = 'found',
    tracklist_updated_at = now()
where exists (select 1 from public.tracks t where t.release_id = r.id);

-- Finding the work to retry: representative releases still owed a tracklist.
-- Only representative releases ever get one — the other ~6,000 releases are
-- correctly and permanently `pending`, and a sweep must not confuse the two.
create index releases_tracklist_recovery_idx
  on public.releases (tracklist_status)
  where tracklist_status in ('pending', 'failed');

-- The retry job. Targets the release MBID, since that is what gets fetched.
--
-- Added here but deliberately not referenced in SQL anywhere in this file:
-- Postgres forbids using a new enum value in the same transaction that adds it.
alter type public.job_kind add value if not exists 'fetch_tracklist';
