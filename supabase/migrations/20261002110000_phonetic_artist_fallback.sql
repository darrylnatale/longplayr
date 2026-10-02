-- longplayr — a phonetic fallback for artist search
--
-- **`search_artists` is already four-tiered** — exact name, prefix, `tsvector`,
-- then trigram similarity above 0.3. So the question is not whether to add
-- fuzziness but **whether phonetics catch anything trigram misses.**
--
-- **They do, and the measurement corrected the reason.** `product-feedback.md`
-- F-019 argues from *smith* / *smyth*; `similarity('smith','smyth')` is
-- **0.333**, already above the threshold, and nine such pairs were all caught
-- by trigram already. **The real win is consonant substitution that preserves
-- sound**: `caesar`/`ceasar` 0.273, `cure`/`kure` 0.250, `phoenix`/`feenix`
-- 0.250, `queen`/`kween` 0.200, `fugees`/`foogeez` 0.154,
-- `chemical`/`kemikal` 0.133 — **six of twelve harder pairs**, all missed by
-- trigram and all phonetically identical. `architecture.md` §10.4.
--
-- **It is a fallback, and that bound is the decision rather than a detail.**
-- The phonetic pass runs **only when the four existing tiers return nothing**:
--
--   * no query that works today can change, so the blast radius on anything
--     already good is exactly zero;
--   * Double Metaphone collides freely, so as an `or` inside the main
--     predicate it would scatter loose matches **alongside** exact ones — the
--     failure that made `search_artists('the wall')` return The Wake, The
--     Weeknd, The Who and The xx before the prefix-stripping fix;
--   * a result set that was empty cannot be made worse by adding to it.
--
-- **Not uniformly better, which is the other reason it is a fallback.**
-- `kiss`/`ciss` and `xzibit`/`exhibit` are missed by trigram *and* phonetics.
--
-- **Artists only.** The algorithm is built for names; an album title is not
-- one, and `Kid A` against `Kid B` is the collision a title would produce.

create extension if not exists fuzzystrmatch;

-- `dmetaphone` is IMMUTABLE — checked, not assumed, because §89 records that
-- `unaccent` is not and cannot carry a generated column. So an expression index
-- is available, and the fallback never degrades to a scan as the catalogue
-- deepens.
create index artists_dmetaphone_idx on public.artists (dmetaphone(name));

-- ---------------------------------------------------------------------------
-- search_artists, now with a fallback
-- ---------------------------------------------------------------------------
--
-- **`plpgsql`, so the two passes are one round trip and one rule.** The service
-- layer could run the second query on an empty first, but that is two calls on
-- every miss and puts a *which rows* rule outside the database —
-- `CLAUDE.md`'s domain-logic test keeps it here.
--
-- **The primary pass is unchanged, character for character.** It is restated
-- rather than refactored so that a diff of this migration shows exactly one
-- new thing: the `if not found` branch.

create or replace function public.search_artists(query text, max_results integer default 10)
returns table(
  id uuid,
  mbid uuid,
  slug text,
  name text,
  disambiguation text,
  album_count bigint,
  tier smallint
)
language plpgsql
stable
as $$
begin
  return query
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
      or similarity(regexp_replace(ar.name, '^(the|a|an)\s+', '', 'i'), n.fuzzy_q) > 0.3
    )
  group by ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation, n.q, n.tsq
  order by
    tier asc,
    album_count desc,
    ar.name asc
  limit greatest(1, least(max_results, 50));

  -- **Only when the primary found nothing.** `found` reflects the last
  -- `return query`, so this is the whole guarantee that an existing good result
  -- set cannot be touched.
  if not found then
    return query
    with normalised as (
      select
        btrim(query) as raw,
        regexp_replace(lower(btrim(query)), '^(the|a|an)\s+', '', 'i') as fuzzy_q
    )
    select
      ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation,
      count(aa.album_id) as album_count,
      -- **Tier 5, below every existing tier.** A caller ordering by tier sees
      -- phonetic matches last whatever else arrives, and a surface that wants
      -- to say "did you mean" can tell them apart from a real match.
      5::smallint as tier
    from public.artists ar
    cross join normalised n
    left join public.album_artists aa on aa.artist_id = ar.id
    where
      n.raw <> ''
      -- Guarded on length: `dmetaphone` of a one or two character query
      -- matches a great many names, and a two-letter typo is not a
      -- misspelling anybody needs rescued.
      and length(n.fuzzy_q) >= 3
      and dmetaphone(ar.name) = dmetaphone(n.fuzzy_q)
    group by ar.id, ar.mbid, ar.slug, ar.name, ar.disambiguation
    order by album_count desc, ar.name asc
    limit greatest(1, least(max_results, 50));
  end if;
end;
$$;

comment on function public.search_artists is
  'Tiered artist search, with a phonetic fallback at tier 5 when nothing else matches. architecture.md §10.4.';

-- Search is a signed-out surface, so `anon` genuinely needs this. The revoke
-- decides the audience; the grant only states it (§16.5).
revoke all on function public.search_artists(text, integer) from public;
grant execute on function public.search_artists(text, integer) to anon, authenticated, service_role;
