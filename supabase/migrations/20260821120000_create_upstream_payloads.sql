-- longplayr — raw upstream payloads
--
-- What an upstream source actually returned, kept verbatim beside the columns
-- we mapped out of it.
--
-- **Why this exists.** Ingestion maps a small, deliberate subset of each
-- MusicBrainz response and discards the rest. That was the right call for the
-- columns, and the wrong call for the response: label MBIDs, recording MBIDs,
-- external links and relationship credits all arrive in requests we already
-- make and are thrown away. Recovering any one of them later costs a re-fetch
-- per album at the one-request-per-second ceiling — six minutes for the
-- catalogue as it stands, hours for the catalogue as it is intended to be.
-- Keeping the response makes every future modelling question a local reshape
-- instead of a negotiation with the rate limiter.
--
-- **This is a snapshot, not a mirror.** A payload records what a source said at
-- `fetched_at`. Upstream corrections do not flow into it, and there is
-- deliberately no refresh policy yet — `fetched_at` is recorded so one can be
-- added when something needs it, rather than inventing a cadence now for a
-- staleness nobody has felt.
--
-- **Source-agnostic on purpose.** MusicBrainz is the only source today, and
-- Discogs is recorded direction. Making the key `(source, source_id, kind)`
-- from the start costs nothing and saves a migration. It does NOT by itself
-- make a second source workable: `albums.mbid` is `not null unique`, so an
-- album that exists only on Discogs still has no home. That is a larger
-- decision and this table does not pretend to settle it.

create table public.upstream_payloads (
  -- Free text rather than an enum. The whole point of this table is that the
  -- set of sources is expected to grow, and an enum would make each addition a
  -- migration for no integrity gained — a typo'd source is a bug either way.
  source text not null
    constraint upstream_payloads_source_not_blank
    check (btrim(source) <> ''),

  -- The identifier in that source's namespace. An MBID today; a Discogs
  -- release id is a number, hence text rather than uuid.
  source_id text not null
    constraint upstream_payloads_source_id_not_blank
    check (btrim(source_id) <> ''),

  -- Constrained, unlike source: these are the shapes *we* request, so the set
  -- is ours to close.
  kind text not null
    constraint upstream_payloads_kind
    check (kind in ('release_group', 'release', 'artist')),

  payload jsonb not null,

  fetched_at timestamptz not null default now(),

  -- One row per shape per record per source. Re-ingesting replaces rather than
  -- accumulates: this is a cache of the latest answer, not a history of them.
  -- The key also serves the sweep, which asks "which of these mbids have a
  -- release_group payload from musicbrainz" with source fixed.
  constraint upstream_payloads_pkey primary key (source, source_id, kind)
);

comment on table public.upstream_payloads is
  'Verbatim upstream responses, kept so future metadata work needs no re-fetch. A snapshot, not a mirror.';
comment on column public.upstream_payloads.fetched_at is
  'When this snapshot was taken. No refresh policy exists yet; this is what one would key on.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Deliberately narrower than every other table here, and the omission is the
-- point: **no grants to anon or authenticated at all.**
--
-- This is ingestion plumbing. Nothing user-facing reads it, the mapped columns
-- are what the product renders, and a raw payload is a large object served for
-- no benefit. Everything in it is public MusicBrainz data, so this is not a
-- confidentiality boundary — it is a surface-area one.
--
-- Grants are evaluated before RLS, so withholding them is the actual control;
-- RLS below is the backstop.

grant all on public.upstream_payloads to service_role;

alter table public.upstream_payloads enable row level security;

-- No policies, deliberately. service_role bypasses RLS; every other role is
-- refused by the absent grant and then again by the absent policy.
