-- longplayr — list activity
--
-- Phase 4, slice 3, **narrowed to creation only**. Creating a list writes one
-- event; editing it, adding an album, removing one and reordering write nothing.
-- Events read live data (`data-model.md` §7), so the feed item already shows the
-- list's current title, albums and order — those mutations improve the existing
-- item rather than needing one of their own. See `architecture.md` §16.6.
--
-- **No `list_updated`, and no anti-burst mechanism.** With creation-only scope a
-- repeated-edit burst is impossible by construction, which is a stronger
-- guarantee than a constraint. The `activity_one_rated_per_entry` index remains
-- the precedent for bounding repeated events if that question is ever answered.

alter table public.activity
  add column list_id uuid references public.lists (id) on delete cascade;

comment on column public.activity.list_id is
  'The list a `list_created` event refers to. Cascades: deleting the list removes the event.';

-- **The constraint is rewritten, not extended, and every branch changed.**
--
-- Two hazards make this mandatory rather than tidy. First, the original `CASE`
-- had **no `ELSE`**: an unmatched type returns NULL, and a CHECK constraint with
-- a NULL result **passes**, so `list_created` would have been entirely
-- unconstrained. `else false` closes that. Second, adding a fourth subject
-- column means the four existing branches must also assert it is null — without
-- that, a `listened` row could carry a stray `list_id` and the feed would have to
-- defend against a state the table should never have allowed.
--
-- This is the same rewrite `20260904170100_create_list_likes.sql` applied to
-- `notifications_subject_matches_type`, for the same two reasons.
alter table public.activity drop constraint activity_subject_matches_type;

alter table public.activity add constraint activity_subject_matches_type check (
  case type
    when 'listened' then collection_entry_id is not null
      and relisten_event_id is null
      and review_id is null
      and list_id is null
    when 'rated' then collection_entry_id is not null
      and relisten_event_id is null
      and review_id is null
      and list_id is null
    when 'relistened' then relisten_event_id is not null
      and collection_entry_id is null
      and review_id is null
      and list_id is null
    when 'reviewed' then review_id is not null
      and collection_entry_id is null
      and relisten_event_id is null
      and list_id is null
    when 'list_created' then list_id is not null
      and collection_entry_id is null
      and relisten_event_id is null
      and review_id is null
    else false
  end
);

-- **Grants and RLS are deliberately unchanged, and that is a decision rather
-- than an omission.** `activity`'s existing privileges — `select` to `anon` and
-- `authenticated`, `insert, delete` to `authenticated`, no `update`, all to
-- `service_role` — are column-agnostic, as are `activity_public_read` and
-- `activity_write_own`. A new column adds no privilege surface, so nothing here
-- needs granting and nothing needs revoking. `pg_default_acl` is untouched.

-- **`feed_activity` is dropped and recreated because its return type changes**,
-- which `create or replace` cannot do. Everything else about it is preserved
-- exactly: the same signature and parameter names, `language sql`, `stable`,
-- `security invoker`, and `set search_path = public`.
--
-- **The album joins become LEFT joins, and that is the whole reason a rewrite is
-- needed rather than an added column.** Both were INNER, so every row had to
-- resolve to a collection entry and an album — and a `list_created` event has
-- neither. Left as INNER, list events would have been **silently dropped from
-- the feed** with nothing to indicate it.
--
-- **The invariant the INNER joins used to enforce is now stated explicitly**,
-- following this function's own habit: "Kept explicit so the intent is stated
-- here rather than inferred from a constraint elsewhere."
drop function public.feed_activity(uuid, integer, timestamptz, uuid);

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
  review_body text,
  list_id uuid,
  list_title text
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
$$;

comment on function public.feed_activity(uuid, integer, timestamptz, uuid) is
  'One page of the following feed: events by the people p_viewer follows, newest first, keyset-paginated.';

-- **Both statements are mandatory after a drop/recreate, and the revoke is the
-- one that gets forgotten.** A recreated function is a new object: it inherits
-- Postgres's default `EXECUTE` to `PUBLIC`, so the revoke applied in
-- `20260904130000_revoke_inherited_privileges.sql` does **not** survive and must
-- be re-applied here. Omitting it would silently undo that cycle's work and make
-- the feed `anon`-executable again. `privileges.test.ts` is the regression guard
-- and is deliberately unmodified.
revoke execute on function public.feed_activity(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.feed_activity(uuid, integer, timestamptz, uuid) to authenticated;
