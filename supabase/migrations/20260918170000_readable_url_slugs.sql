-- longplayr — readable URLs
--
-- Album and artist URLs become slugs and the identifier form stops resolving.
-- A clean switch rather than a dual-resolving one, decided 2026-09-16 on the
-- timing: four profiles, no real users, nothing meaningfully shared, so the
-- cost of stranding links is as close to zero as it will ever be.
-- docs/product-spec.md §6.
--
-- **Every slug carries an identity suffix, and that is what makes it
-- deterministic.** §6 requires collision resolution that is deterministic
-- rather than insertion-ordered. A bare title slug cannot satisfy that: the
-- first of two identically titled albums to be ingested would take `kid-a` and
-- the second would take `kid-a-2`, so the same catalogue in a different order
-- produces different URLs — and a later arrival sorting earlier would change a
-- slug that had already been shared. Appending a fixed prefix of the MBID makes
-- every slug a pure function of its own row, with no collision logic, no
-- uniqueness race and no order dependence anywhere.
--
-- **The MBID stays canonical.** architecture.md §19.1 holds that provider
-- identifiers are enrichment and never identity; a slug is weaker still — a
-- label, not an identifier. Nothing joins on it.
--
-- **A generated column rather than application code**, so the slug cannot drift
-- from the title it describes. An upstream rename updates it in the same
-- statement that renames the row, and no ingest path can forget to maintain it.

-- ---------------------------------------------------------------------------
-- slugify
-- ---------------------------------------------------------------------------
--
-- IMMUTABLE because a generated column requires it, and honestly so: the
-- output depends on nothing but the input.
--
-- **`unaccent` is deliberately not used.** It is not immutable — it reads a
-- dictionary that can be changed underneath it — so a generated column cannot
-- call it. `translate` over a fixed map is immutable, covers the Latin-1 and
-- Central European letters this catalogue actually contains, and is verified
-- against real titles in the test below.
--
-- **Non-Latin titles slugify to nothing, and that is handled rather than
-- hidden.** A title in Japanese or Cyrillic has no ASCII to keep, so the caller
-- below substitutes a literal and the identity suffix carries the URL alone.
-- The alternative — transliteration — needs a per-script table this project has
-- no reason to own.

create function public.slugify(value text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select trim(both '-' from regexp_replace(translate(replace(replace(replace(lower(value), 'ß','ss'), 'æ','ae'), 'œ','oe'), 'áàâäãåāçćčéèêëēėęíìîïīıñńóòôöõøōšśúùûüūýÿžźżđðþłğřŵ', 'aaaaaaaccceeeeeeeiiiiiinnooooooossuuuuuyyzzzddtlgrw'), '[^a-z0-9]+', '-', 'g'));
$$;

comment on function public.slugify is
  'Lowercases, folds common accents, and reduces anything else to single hyphens. Immutable, for generated columns.';

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------
--
-- Ten hex characters of the MD5 of the MBID — a hash of the whole identifier,
-- never a prefix of it.
--
-- **The first version of this migration took `left(replace(mbid::text,'-',''), 8)`
-- and CI killed it in under a minute.** A prefix is only as well distributed as
-- its input, and identifiers are very often structured rather than random: the
-- search suite's fixtures are all `0b0e4f1e-5555-4000-8000-…`, so every one of
-- them shared a prefix and two albums titled *Blonde* collided on the first
-- insert. Real MusicBrainz identifiers are random v4 UUIDs and would rarely have
-- shown this — which is exactly why it was worth catching: the design was
-- relying on the input happening to be random.
--
-- Hashing the whole value removes that dependence. Ten hex characters is about
-- 1.1e12 of space, so a collision stays negligible at any size this catalogue
-- will reach, and the unique index below means one would surface as a clean
-- ingest failure rather than as a wrong page being served.
--
-- `nullif(..., '')` with a literal fallback covers the non-Latin case: the slug
-- becomes `album-8f4c2b1a` rather than `-8f4c2b1a`.

alter table public.albums
  add column slug text
  generated always as (
    coalesce(nullif(public.slugify(title), ''), 'album')
      || '-' || left(md5(mbid::text), 10)
  ) stored;

-- NOT NULL because the expression cannot produce one: the coalesce guarantees a
-- non-empty base and the suffix is always present. Declaring it means every
-- consumer gets `string` rather than `string | null` and none of them has to
-- handle an absence that cannot happen.
alter table public.albums alter column slug set not null;

alter table public.artists
  add column slug text
  generated always as (
    coalesce(nullif(public.slugify(name), ''), 'artist')
      || '-' || left(md5(mbid::text), 10)
  ) stored;

alter table public.artists alter column slug set not null;

comment on column public.albums.slug is
  'Readable URL label. Derived, never joined on. The MBID remains canonical identity.';
comment on column public.artists.slug is
  'Readable URL label. Derived, never joined on. The MBID remains canonical identity.';

-- Unique because resolution is a single equality and must return one row.
-- These are also the lookup indexes: every album and artist page reads by slug.
create unique index albums_slug_key on public.albums (slug);
create unique index artists_slug_key on public.artists (slug);

-- ---------------------------------------------------------------------------
-- Search returns the slug, because search links to these pages
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced: `create or replace function`
-- cannot change a return type, which adding a column to `returns table` does.
-- architecture.md §16.8 made the same move for the same reason.
--
-- **A drop takes the privileges with it** (architecture.md §16.5), so the
-- grants below are restoring what the drop removed, not adding anything new.

drop function if exists public.search_albums(text, integer);
drop function if exists public.search_artists(text, integer);

create or replace function public.search_albums(query text, max_results integer DEFAULT 20)
 RETURNS TABLE(id uuid, mbid uuid, slug text, title text, display_credit text, primary_type album_type, artwork_status artwork_status, first_release_date date, first_release_date_precision date_precision, popularity_score integer, tier smallint, text_rank real, artists jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      -- Used by the fuzzy comparison only. `q` above is untouched, so every
      -- exact and prefix predicate keeps its existing semantics.
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    a.id, a.mbid, a.slug, a.title, a.display_credit, a.primary_type, a.artwork_status,
    a.first_release_date, a.first_release_date_precision, a.popularity_score,
    case
      -- Tier 1: the title is exactly what was typed.
      when lower(a.title) = n.q then 1
      -- Tier 2: exact artist match, or the title begins with the query.
      when lower(a.display_credit) = n.q then 2
      when lower(a.title) like n.q || '%' then 2
      -- Tier 3: full-text match across title (weight A) and credit (weight B).
      when a.search_vector @@ n.tsq then 3
      -- Tier 4: fuzzy, for typos and partial words.
      else 4
    end::smallint as tier,
    -- Rounded so near-identical relevance collapses into a tie and popularity
    -- can act. Without this, ts_rank's continuous values would almost never
    -- tie and popularity would effectively never be consulted.
    round(ts_rank(a.search_vector, n.tsq)::numeric, 2)::real as text_rank,
    -- `[]` rather than null when an album has no credited artists, so the
    -- caller never distinguishes "no rows" from "no column". The flat
    -- `display_credit` above remains the fallback for that case.
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'position', aa.position,
            'artists', jsonb_build_object('id', ar.id, 'mbid', ar.mbid, 'name', ar.name)
          )
          order by aa.position
        ),
        '[]'::jsonb
      )
      from public.album_artists aa
      join public.artists ar on ar.id = aa.artist_id
      where aa.album_id = a.id
    ) as artists
  from public.albums a, normalised n
  where
    n.q <> ''
    and (
      a.search_vector @@ n.tsq
      or lower(a.title) like n.q || '%'
      or similarity(a.title, n.q) > 0.3
      -- Article-normalised on both sides. See the header.
      or similarity(regexp_replace(a.display_credit, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  order by
    tier asc,
    text_rank desc,
    -- Secondary only. Never lifts a weaker text match above a stronger one,
    -- because tier and text_rank are both compared first.
    a.popularity_score desc nulls last,
    a.title asc
  limit greatest(1, least(max_results, 100));
$function$;

create or replace function public.search_artists(query text, max_results integer DEFAULT 10)
 RETURNS TABLE(id uuid, mbid uuid, slug text, name text, disambiguation text, album_count bigint, tier smallint)
 LANGUAGE sql
 STABLE
AS $function$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation,
    count(aa.album_id) as album_count,
    min(
      case
        when lower(ar.name) = n.q then 1
        when lower(ar.name) like n.q || '%' then 2
        when ar.search_vector @@ n.tsq then 3
        else 4
      end
    )::smallint as tier
  from public.artists ar
  cross join normalised n
  left join public.album_artists aa on aa.artist_id = ar.id
  where
    n.q <> ''
    and (
      ar.search_vector @@ n.tsq
      or lower(ar.name) like n.q || '%'
      -- Same mechanism as the album credit predicate, and justified on its own
      -- evidence: `search_artists('the wall')` returned The Wake, The Weeknd,
      -- The Who and The xx, none of them relevant.
      or similarity(regexp_replace(ar.name, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  group by ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation, n.q, n.tsq
  order by
    tier asc,
    -- No popularity signal for artists yet, so catalogue depth stands in as a
    -- rough proxy for prominence.
    album_count desc,
    ar.name asc
  limit greatest(1, least(max_results, 50));
$function$;


comment on function public.search_albums is
  'Tiered album search. Returns the slug so results can link without a second lookup.';
comment on function public.search_artists is
  'Tiered artist search. Returns the slug so results can link without a second lookup.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on a new function to PUBLIC, so the revoke is what
-- decides the audience and the grant only states it. Search is a signed-out
-- surface, so anon genuinely needs both.

revoke all on function public.slugify(text) from public;
grant execute on function public.slugify(text) to anon, authenticated, service_role;

revoke all on function public.search_albums(text, integer) from public;
grant execute on function public.search_albums(text, integer) to anon, authenticated, service_role;

revoke all on function public.search_artists(text, integer) from public;
grant execute on function public.search_artists(text, integer) to anon, authenticated, service_role;
