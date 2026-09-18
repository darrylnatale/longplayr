-- longplayr — the feed carries each album's slug
--
-- `feed_activity` returns the columns a feed item renders, and every one of
-- those items links to its album. With URLs now built from slugs
-- (`product-spec.md` §6), returning only the MBID means the feed cannot link
-- at all without a second query per row.
--
-- **Dropped and recreated rather than replaced**, because adding a column to
-- `returns table` changes the return type and `create or replace function`
-- cannot. A drop takes privileges with it, so the grants below restore what it
-- removed rather than widening anything (`architecture.md` §16.5).

drop function if exists public.feed_activity(uuid, integer, timestamptz, uuid);

create or replace function public.feed_activity(p_viewer uuid, p_limit integer, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, type activity_type, created_at timestamp with time zone, actor_handle text, actor_display_name text, actor_avatar_url text, album_mbid uuid, album_slug text, album_title text, album_credit text, album_artwork_status artwork_status, rating numeric, review_body text, list_id uuid, list_title text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    a.id,
    a.type,
    a.created_at,
    actor.handle,
    actor.display_name,
    actor.avatar_url,
    al.mbid,
    al.slug,
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
    left(v.body, 400),
    l.id,
    l.title
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

  -- Every album-typed event resolves to a collection entry, and from there to
  -- one album. `albums.display_credit` is the rendered credit string, so the
  -- feed never touches `album_artists` or `artists`. **Left rather than inner
  -- since `list_created` has no entry; the predicate below restores the
  -- requirement for the types that do.**
  left join public.collection_entries e
    on e.id = coalesce(a.collection_entry_id, r.collection_entry_id, v.collection_entry_id)
  left join public.albums al on al.id = e.album_id

  -- **Left, and inner in effect for `list_created` only.** `lists_public_read`
  -- is `status = 'live' or user_id = auth.uid()`, and this function is
  -- `security invoker`, so a moderation-removed list yields null here and the
  -- predicate below drops the item rather than emitting one with no title.
  left join public.lists l on l.id = a.list_id

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
    -- review already makes the coalesce null and the predicate below drops the
    -- row. Kept explicit so the intent is stated here rather than inferred from
    -- a constraint elsewhere.
    and (a.type <> 'reviewed' or v.id is not null)

    -- **The invariant the INNER joins used to carry.** An album-typed event must
    -- still resolve to a readable album; without this, converting those joins to
    -- LEFT would let an event whose album was removed render with no title.
    and (a.type = 'list_created' or al.id is not null)

    -- **A list event requires a readable list.** RLS hides a moderation-removed
    -- list from everyone but its owner, and a deleted list is gone entirely, so
    -- this drops the row rather than emitting a feed item that names nothing.
    and (a.type <> 'list_created' or l.id is not null)

    -- Keyset, not offset. Row-wise and strict, so the cursor row is never
    -- repeated on the next page. `id` is unique, so the ordering is total and a
    -- shared `created_at` still pages deterministically.
    and (p_before is null or (a.created_at, a.id) < (p_before, p_before_id))

  order by a.created_at desc, a.id desc
  limit p_limit;
$function$;


revoke all on function public.feed_activity(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.feed_activity(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;
