-- longplayr — the following feed query
--
-- Phase 3, slice 3. **The query only.** No table, no column, no enum value, no
-- index and no data: this migration adds one function and its grant.
--
-- **Why the query lives here rather than in the PostgREST client the rest of
-- the read path uses.** PostgREST cannot express a subquery in a filter, so the
-- alternative is fetching the follow graph first and passing every followee id
-- as a literal UUID in the URL. Measured against the local stack on
-- 2026-08-31, that request succeeds at 207 followed accounts and returns
-- `HTTP 414` at 209, and the ceiling falls further as the select grows because
-- the id list and the select string share one URL budget. That is a cliff, not
-- a curve — the surface simply breaks for that user, with no degraded mode and
-- no warning as they approach it. See `architecture.md` §16.1.
--
-- **`security invoker` is a correctness requirement, not a style choice.**
-- `reviews_public_read` restricts a review with `status = 'removed'` to its
-- author, and RLS is what makes that true. `security definer` would bypass it
-- and leak moderation-removed reviews into every follower's feed.
--
-- **What is deliberately not optimised here.** The planner materialises every
-- activity row belonging to the followed set and then top-N sorts it, so cost
-- scales with that set's whole history rather than with page size —
-- `activity_actor_idx` serves the filter, not the ordering. That curve is left
-- alone, consistent with `architecture.md` §17, which ranks feed queries third
-- among things that break and names fan-out-on-write as the mitigation *if
-- measurement ever justifies it*. A per-actor LATERAL top-N shape measured
-- better on synthetic data and is **not rejected** — it is simply not the shape
-- chosen now, and because the query lives behind this function it can be
-- swapped by `create or replace function` with no contract change and no data
-- migration.

create function public.feed_activity(
  p_viewer uuid,
  p_limit integer,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  type public.activity_type,
  created_at timestamptz,
  actor_handle text,
  actor_display_name text,
  actor_avatar_url text,
  album_mbid uuid,
  album_title text,
  album_credit text,
  album_artwork_status public.artwork_status,
  rating numeric,
  review_body text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id,
    a.type,
    a.created_at,
    actor.handle,
    actor.display_name,
    actor.avatar_url,
    al.mbid,
    al.title,
    al.display_credit,
    al.artwork_status,
    e.rating,
    -- A transport bound, never rendered raw. `reviews_body_length` allows
    -- 10,000 characters, so twenty unbounded bodies would be 200KB on the wire
    -- to render an excerpt a fraction of that size. The excerpt itself — the
    -- word boundary and the ellipsis — is the component's job, where it can be
    -- unit-tested; this only guarantees the component always has more text than
    -- it needs.
    left(v.body, 400)
  from public.activity a

  -- **The actor filter is explicit because RLS will not do it.**
  -- `profiles_public_read` is `using (true)`, so a suspended or banned account
  -- stays publicly readable. The follower and following lists apply exactly this
  -- filter for the same reason.
  join public.profiles actor
    on actor.id = a.actor_id
   and actor.status = 'active'

  left join public.relisten_events r on r.id = a.relisten_event_id

  -- **Left, but inner in effect, and that is load-bearing.** RLS removes a
  -- review the viewer may not read, so this yields null and the predicate below
  -- drops the item. Do not "simplify" the predicate away: it is what states the
  -- intent, and without it the behaviour would rest entirely on a check
  -- constraint declared in another file (see the note on the predicate below).
  left join public.reviews v on v.id = a.review_id

  -- Every type resolves to a collection entry, and from there to one album.
  -- `albums.display_credit` is the rendered credit string, so the feed never
  -- touches `album_artists` or `artists`.
  join public.collection_entries e
    on e.id = coalesce(a.collection_entry_id, r.collection_entry_id, v.collection_entry_id)
  join public.albums al on al.id = e.album_id

  where a.actor_id in (
          select f.followee_id
            from public.follows f
           where f.follower_id = p_viewer)

    -- **The viewer's own activity is excluded by the follow graph itself.**
    -- `follows_no_self_follow` makes a self-follow impossible, so no separate
    -- predicate is needed and none is added — inventing one would state a
    -- product rule twice, in two places that can disagree.

    -- A rating cleared after its event was written. The claim has stopped being
    -- true, which `data-model.md` §7 forbids the feed from displaying. **This
    -- tolerates the non-atomic rating write; it does not fix it.**
    and (a.type <> 'rated' or e.rating is not null)

    -- Belt and braces, deliberately. The check constraint guarantees
    -- `collection_entry_id` is null on a `reviewed` event, so an RLS-hidden
    -- review already makes the coalesce null and the inner join above drops the
    -- row. Kept explicit so the intent is stated here rather than inferred from
    -- a constraint elsewhere.
    and (a.type <> 'reviewed' or v.id is not null)

    -- Keyset, not offset. Row-wise and strict, so the cursor row is never
    -- repeated on the next page. `id` is unique, so the ordering is total and a
    -- shared `created_at` still pages deterministically.
    and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))

  order by a.created_at desc, a.id desc
  limit p_limit;
$$;

comment on function public.feed_activity(uuid, integer, timestamptz, uuid) is
  'One page of the following feed: events by the people p_viewer follows, newest first, keyset-paginated.';

-- `authenticated` only. A feed is not user-generated content — it is a
-- per-viewer query whose only input is the viewer's own follow graph — so
-- there is nothing here for `anon` to read.
grant execute on function public.feed_activity(uuid, integer, timestamptz, uuid) to authenticated;
