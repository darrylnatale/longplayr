-- longplayr — MusicBrainz artist aliases, for a search that forgives
--
-- **F-019: the cheapest unused lever on search quality**, and the entry's
-- claim is that the answer is *data rather than algorithm*. The live API
-- settles it. `artist/{mbid}?inc=aliases` for the artist MusicBrainz now calls
-- **Ye** returns twelve aliases:
--
--   6 × Artist name   — `Kanye`, `Kanye West`
--   3 × Search hint   — `K. West`, `KanYeWest`, **`Kayne West`**
--   2 × Legal name    — `Kanye Omari West`
--   1 × untyped       — `Donda`
--
-- **`Kayne West` is a curated misspelling.** That is typo-tolerance somebody
-- has already done by hand, and no algorithm competes with it — §111's
-- phonetic fallback would never reach it, because `kayne` and `ye` do not
-- sound alike.
--
-- **The entry's own example is backwards in the data, which strengthens it.**
-- F-019 hoped aliases would let *"Ye" reach Kanye West*. The canonical name
-- **is** Ye; `Kanye West` is the alias. So aliases let the name almost everyone
-- types reach the artist — a bigger win than the entry imagined.
--
-- **Two types are ingested and two are not.**
--
--   * `Artist name` and `Search hint` are **names for the artist**, which is
--     exactly what a search should match.
--   * **`Legal name` is deliberately excluded.** For an artist performing under
--     a pseudonym, making them findable by a birth name is a privacy decision
--     and not one to take by default. MusicBrainz marks it distinctly because
--     it *is* a different kind of thing. Reversible if ever wanted.
--   * **Untyped is deliberately excluded**, and the data is why: Ye's untyped
--     alias is `Donda`, an **album title**. Untyped is a mixed bag, and
--     admitting it would admit noise rather than names.
--
-- `architecture.md` §10.5.

alter type public.job_kind add value if not exists 'fetch_artist_aliases';

create type public.artist_alias_kind as enum ('artist_name', 'search_hint');

comment on type public.artist_alias_kind is
  'The two MusicBrainz alias types that are names for the artist. Legal name and untyped are excluded — architecture.md §10.5.';

create table public.artist_aliases (
  id uuid primary key default gen_random_uuid(),

  artist_id uuid not null references public.artists (id) on delete cascade,

  -- The alias as MusicBrainz spells it. Not slugified, not normalised: the
  -- search function does its own normalising, and storing a mangled copy would
  -- make the row useless for anything else later.
  name text not null constraint artist_aliases_name_length check (char_length(name) between 1 and 400),

  kind public.artist_alias_kind not null,

  -- **Kept but not used yet.** MusicBrainz carries a locale and a primary flag
  -- per alias, and both are plausible inputs to ranking or display later. They
  -- are stored because they arrive free with the request and **re-fetching 2,000
  -- artists to add a column would cost 2,000 requests against a one-per-second
  -- budget** — the same reasoning §7a gives for keeping upstream payloads
  -- verbatim.
  locale text,
  is_primary boolean,

  created_at timestamptz not null default now(),

  -- One row per artist per spelling per type. MusicBrainz legitimately carries
  -- the same string under two types, and the same string in two locales.
  constraint artist_aliases_unique unique (artist_id, name, kind)
);

comment on table public.artist_aliases is
  'Alternate names for an artist, from MusicBrainz. Widens search matching only; never displayed. architecture.md §10.5.';

-- The search join goes artist-first, and the name lookup is a prefix/equality
-- match, so this covers both directions the query uses.
create index artist_aliases_artist_idx on public.artist_aliases (artist_id);
create index artist_aliases_name_idx on public.artist_aliases (lower(name));

-- A trigram index for the fuzzy tier, matching what `artists.name` has.
create index artist_aliases_name_trgm_idx
  on public.artist_aliases using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- **Search is a signed-out surface**, so `anon` needs to read these — the
-- function is `stable` and runs as its caller, so without the grant an alias
-- match would return nothing for exactly the visitors most likely to be
-- guessing at a spelling.
--
-- **The revoke is the fix; the grant only states intent** (§16.5), and
-- `scripts/check-privileges.mjs` fails the build without it.

alter table public.artist_aliases enable row level security;

revoke all on table public.artist_aliases from anon, authenticated;

grant select on public.artist_aliases to anon, authenticated;
grant all on public.artist_aliases to service_role;

-- Catalogue data is public and read-only downstream of MusicBrainz, so this
-- matches the policy `artists` itself carries: everyone reads, nobody writes
-- but the service role.
create policy artist_aliases_public_read
  on public.artist_aliases
  for select
  to anon, authenticated
  using (true);
