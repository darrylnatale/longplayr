-- `search_albums` returns the artists a result is credited to.
--
-- **Why this is a migration at all.** Every other surface that prints a credit
-- gets its artists from a PostgREST embed widened in TypeScript
-- (`architecture.md` §16.7). Search cannot: it reads this function, whose
-- columns are fixed by a SQL signature. The alternative was a second
-- service-layer query over the returned album ids — no migration, but an extra
-- serial round trip on a latency-sensitive surface `current-state.md` §8
-- already records as slow. The round trip was traded for this migration
-- deliberately. `architecture.md` §16.8.
--
-- **The aggregate returns the embed's own shape** — `{ position, artists }` —
-- so `toCreditedArtists` serves the RPC and the embed unchanged. Two producers
-- of one value would otherwise drift, and the drift would be invisible because
-- each surface looks correct on its own.
--
-- **Ordering is applied here and re-applied in the mapper.** `jsonb_agg`'s
-- `order by` makes the credit arrive in credit order; the mapper sorts anyway,
-- because it is the one place the rule is stated and the cost is nothing.
--
-- **Nothing about search behaviour changes.** Tier numbering, tier ordering,
-- every exact, prefix, full-text and fuzzy predicate, the article
-- normalisation, result ordering, the limit clamp, the signature and the
-- volatility are copied verbatim from
-- `20260828120000_refine_search_precision.sql`. The only addition is the final
-- column.

-- **A drop, not a `create or replace`.** Postgres refuses to change an existing
-- function's return type, and this adds a column. The signature `(text,
-- integer)` is unchanged, so `20260904130000_revoke_inherited_privileges.sql`'s
-- references stay valid. Verified before writing this: nothing in `pg_depend`
-- rewrites over this function, so no view or rule is carried away with it.
drop function if exists public.search_albums(text, integer);

create function public.search_albums(query text, max_results integer default 20)
returns table (
  id uuid,
  mbid uuid,
  title text,
  display_credit text,
  primary_type public.album_type,
  artwork_status public.artwork_status,
  first_release_date date,
  first_release_date_precision public.date_precision,
  popularity_score integer,
  tier smallint,
  text_rank real,
  artists jsonb
)
language sql
stable
as $$
  with normalised as (
    select
      lower(btrim(query)) as q,
      websearch_to_tsquery('simple', btrim(query)) as tsq,
      -- Used by the fuzzy comparison only. `q` above is untouched, so every
      -- exact and prefix predicate keeps its existing semantics.
      regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
  )
  select
    a.id, a.mbid, a.title, a.display_credit, a.primary_type, a.artwork_status,
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
$$;

comment on function public.search_albums is
  'Tiered album search: text relevance selects the tier, popularity orders within it. Fuzzy credit matching is article-normalised on both operands. Returns credited artists as jsonb in credit order.';

-- **Privileges are restated because the drop took them.** A recreated function
-- starts from Postgres''s default of `EXECUTE` to `PUBLIC`, so granting alone
-- would widen access rather than define it — `architecture.md` §16.5. Measured
-- on the deployed shape before this change, `search_albums` was executable by
-- `anon`, `authenticated` and `service_role` with `PUBLIC` revoked, and that is
-- reproduced exactly here.
--
-- **Both roles are load-bearing and neither failure is a compile error.**
-- Signed-out search is a shipped feature (`anon`); signed-in search is the
-- common case (`authenticated`). Dropping either would be a live outage.
revoke execute on function public.search_albums(text, integer) from public;
grant execute on function public.search_albums(text, integer) to anon, authenticated, service_role;
