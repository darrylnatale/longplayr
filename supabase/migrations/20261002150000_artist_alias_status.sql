-- Durable per-artist alias ingestion state.
--
-- **Why this exists, when the plan did not call for it.** The enqueue path for
-- `fetch_artist_aliases` has to answer "which artists still need aliases?", and
-- nothing on `artists` could answer it. The two mechanisms available without a
-- column were both wrong:
--
--   * **An anti-join against `artist_aliases`** cannot distinguish *never
--     fetched* from *fetched, and this artist genuinely has no usable alias*.
--     MusicBrainz holds many artists with no alias at all, and several whose
--     only aliases are `Legal name` or untyped - which §10.5 drops on purpose.
--     Every one of those would be re-queued on every sweep, forever, spending
--     the 1 req/sec budget re-learning a settled fact.
--
--   * **Inferring it from `ingestion_jobs` history**, which is what
--     `enqueueFailedExpansions` does, is durable here (no retention policy
--     prunes that table). But the candidate set would have to come from
--     `artists` and be filtered against jobs afterwards, so a bounded read
--     returns mostly-settled artists once the backfill is underway and makes
--     progress depend on page position - the shape §8.10 records as a defect.
--
-- So this mirrors `albums.artwork_status` and `releases.tracklist_status`
-- exactly, which is the established pattern for precisely this question. One
-- pattern to learn rather than three.

create type public.alias_status as enum ('pending', 'stored', 'absent', 'failed');

comment on type public.alias_status is
  'Alias ingestion state per artist. `stored` and `absent` are settled; `pending` and `failed` warrant another attempt.';

alter table public.artists
  add column alias_status public.alias_status not null default 'pending';

comment on column public.artists.alias_status is
  'Whether MusicBrainz aliases have been fetched for this artist. `absent` means MusicBrainz answered and had nothing §10.5 keeps - a settled fact, not a retry.';

-- Partial, because the retryable set shrinks towards empty as the backfill
-- completes while the table keeps growing. A full index would be mostly
-- `stored` rows that this query never wants.
create index artists_alias_status_pending_idx
  on public.artists (alias_status)
  where alias_status in ('pending', 'failed');

/*
 * No grant or revoke statements, deliberately, and this is the part worth
 * checking rather than assuming.
 *
 * `create_catalogue.sql` grants `select` on `public.artists` at **table** level,
 * not column level, so this column is readable by `anon` and `authenticated`
 * the moment it exists. That is intended: it is ingestion state, not user data,
 * and `albums.artwork_status` has been public on the same terms since Phase 1.
 *
 * Had those grants been column-scoped, this migration would have needed an
 * explicit grant and the column would have read as empty to every signed-out
 * visitor - the failure mode §16.5 describes.
 */
