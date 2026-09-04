-- longplayr — lists
--
-- Phase 4, slice 1. Two tables and one function, and the slice exists to
-- establish **identity** before anything consumes it (`architecture.md` §16.4).
--
-- **Nothing here is a like, an activity event or a notification.** `list_liked`
-- was deferred in Phase 3 for a mechanical reason — there was no table for
-- `list_like_id` to reference, so the foreign key could not be created at all.
-- This migration removes that blocker and stops. It adds **no** enum value to
-- `activity_type` or `notification_type` and touches neither table's check
-- constraint. `ListLike` remains `[INFERRED]` in `data-model.md` §5.
--
-- **`position` is always stored and always maintained contiguous, on every list,
-- ranked or not. [DECIDED 2026-09-03]** `is_ranked` decides whether the order is
-- meaningful *to the reader*, not whether it exists. Read it as "meaningful only
-- when ranked", never as "maintained only when ranked" — the latter would let an
-- unranked list accumulate gaps and lose the user's curation the moment they
-- toggled the flag. Un-ranking preserves the order exactly; re-ranking restores
-- it, with no fallback sort.

create table public.lists (
  id uuid primary key default gen_random_uuid(),

  -- The owner. Account deletion is a hard delete of `auth.users`, which cascades
  -- to `profiles` and so to here — no bespoke deletion path, and no orphan.
  user_id uuid not null references public.profiles (id) on delete cascade,

  title text not null
    constraint lists_title_length
    check (char_length(btrim(title)) between 1 and 120),

  -- Optional. Plain text with line breaks, matching `reviews.body`: no Markdown,
  -- so no sanitisation surface and no preview mode.
  description text
    constraint lists_description_length
    check (description is null or char_length(description) <= 2000),

  -- Presentation, not a storage mode. See the header note.
  is_ranked boolean not null default false,

  -- Moderation, present from day one. `data-model.md` §11 is explicit that
  -- retrofitting content status across a populated table is the failure to
  -- avoid, so it ships now even though no admin surface exists yet.
  status public.content_status not null default 'live',

  -- **No visibility column, deliberately.** Lists are public
  -- (`product-spec.md` §Lists, decided 2026-09-03), so a column with one legal
  -- value would imply an option the product does not offer.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lists is
  'A user-curated, public list of albums. Ranked or unranked; positions are maintained either way.';

-- The profile surface: one user''s live lists, newest first.
create index lists_owner_idx
  on public.lists (user_id, created_at desc)
  where status = 'live';

create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

create table public.list_items (
  -- A surrogate key rather than a composite on (list_id, album_id). Reordering
  -- addresses one item directly, and a single-column identity is what lets the
  -- reorder function take an item id rather than a pair.
  id uuid primary key default gen_random_uuid(),

  list_id uuid not null references public.lists (id) on delete cascade,

  -- **The cascade direction that matters.** Deleting an album removes the item
  -- and leaves the list standing. A list that loses one entry is still that
  -- list, and cascading upward would let catalogue maintenance silently destroy
  -- user-authored curation (`data-model.md` §5).
  album_id uuid not null references public.albums (id) on delete cascade,

  -- Zero-based and contiguous. Maintained on every list, ranked or not.
  position integer not null
    constraint list_items_position_non_negative
    check (position >= 0),

  created_at timestamptz not null default now(),

  -- Uniqueness is **per list, not global** — the same album may appear in any
  -- number of different lists, which is the point of lists.
  constraint list_items_one_per_album unique (list_id, album_id),

  -- **Deferrable, and this is not decoration.** A reorder permutes positions, so
  -- a single statement transiently holds two rows at the same position. A
  -- non-deferrable constraint would reject a legitimate reorder. `initially
  -- immediate` keeps ordinary writes strict; `reorder_list_item` defers it for
  -- the length of its own transaction and no longer.
  constraint list_items_position_unique unique (list_id, position)
    deferrable initially immediate
);

comment on table public.list_items is
  'One album in one list. Position is always maintained contiguous; is_ranked decides whether it is meaningful.';

-- The cascade from `albums` needs this direction: without it, deleting an album
-- sequentially scans this table. The unique constraints lead on `list_id` and so
-- do not serve it. `review_likes` indexes its cascade direction for the same
-- reason.
create index list_items_album_idx on public.list_items (album_id);

-- Table privileges, evaluated before RLS. Every new table needs this block.
grant select on public.lists to anon, authenticated;
grant insert, update, delete on public.lists to authenticated;
grant all on public.lists to service_role;

grant select on public.list_items to anon, authenticated;
grant insert, update, delete on public.list_items to authenticated;
grant all on public.list_items to service_role;

-- **`update` is granted here, unlike `review_likes`.** That table withholds it
-- because a like has nothing to edit. A list is editable content, so the
-- precedent being followed is `reviews`, not `review_likes`.

alter table public.lists enable row level security;
alter table public.list_items enable row level security;

-- Public, except that a removed list stays visible to its own author — exactly
-- what `reviews_public_read` does. Moderation hides content from readers; it
-- does not hide it from the person who wrote it.
create policy lists_public_read on public.lists
  for select using (
    status = 'live'
    or user_id = (select auth.uid())
  );

create policy lists_write_own on public.lists
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- **Ownership is inherited through `lists`, never duplicated onto this table.**
-- There is no `list_items.user_id` to fall out of sync with `lists.user_id`.
-- This is the `reviews`-through-`collection_entries` pattern verbatim.
create policy list_items_public_read on public.list_items
  for select using (
    exists (
      select 1 from public.lists l
      where l.id = list_id
        and (l.status = 'live' or l.user_id = (select auth.uid()))
    )
  );

-- **Both halves are mandatory, and `with check` is the one that stops the
-- attack.** `using` gates which rows you may touch; `with check` gates what you
-- may turn them into. With `using` alone, a caller could insert an item naming
-- someone else's `list_id`, or re-point one of their own items into another
-- user's list. Two integration tests pin exactly those two paths.
create policy list_items_write_own on public.list_items
  for all to authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
  );

-- Moves one item to an absolute position, closing and reopening the gap in a
-- single transaction.
--
-- **A function rather than a sequence of client updates, for the reason
-- `ensure_collection_entry` gives:** two statements from the client leave a
-- window. Here the window is worse than a stale read — a dropped connection
-- midway through an N-statement rewrite leaves permanent gaps, and two
-- concurrent reorders interleave into an order neither user asked for.
--
-- **`security invoker`, so RLS still applies.** `security definer` would make
-- this a way to reorder someone else's list. The policies above are the
-- authorisation; this function adds none of its own beyond the ownership lock.
--
-- **`for update` on the owning list row serialises concurrent reorders.** Two
-- callers queue rather than interleave, which is what makes contiguity hold
-- under concurrency rather than merely in tests.
create or replace function public.reorder_list_item(
  p_item_id uuid,
  p_to_position integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_list_id uuid;
  v_from integer;
  v_count integer;
  v_to integer;
begin
  select list_id, position into v_list_id, v_from
  from public.list_items
  where id = p_item_id;

  -- Not found, or hidden by RLS. Indistinguishable on purpose: telling a
  -- stranger that an item exists but is not theirs is a disclosure.
  if v_list_id is null then
    raise exception 'list item not found' using errcode = 'no_data_found';
  end if;

  -- Serialise against other reorders on the same list. This also re-checks
  -- ownership through the `lists` policy: a caller who cannot see the row cannot
  -- lock it.
  perform 1 from public.lists where id = v_list_id for update;

  select count(*) into v_count from public.list_items where list_id = v_list_id;

  -- Clamp rather than reject. "Move to last" is naturally expressed as a large
  -- index by any caller that does not want to fetch the count first.
  v_to := greatest(0, least(p_to_position, v_count - 1));

  if v_to = v_from then
    return;
  end if;

  set constraints public.list_items_position_unique deferred;

  if v_to < v_from then
    -- Moving up: everything in [v_to, v_from) shifts down one.
    update public.list_items
    set position = position + 1
    where list_id = v_list_id and position >= v_to and position < v_from;
  else
    -- Moving down: everything in (v_from, v_to] shifts up one.
    update public.list_items
    set position = position - 1
    where list_id = v_list_id and position > v_from and position <= v_to;
  end if;

  update public.list_items set position = v_to where id = p_item_id;
end;
$$;

grant execute on function public.reorder_list_item(uuid, integer)
  to authenticated, service_role;

-- Removes one album and closes the gap it leaves, so contiguity is a property of
-- the operation rather than something every caller must remember.
create or replace function public.remove_list_item(
  p_list_id uuid,
  p_album_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_position integer;
begin
  perform 1 from public.lists where id = p_list_id for update;

  delete from public.list_items
  where list_id = p_list_id and album_id = p_album_id
  returning position into v_position;

  -- Already absent. Idempotent, matching `unfollowUser` and `unlikeReview`.
  if v_position is null then
    return;
  end if;

  update public.list_items
  set position = position - 1
  where list_id = p_list_id and position > v_position;
end;
$$;

grant execute on function public.remove_list_item(uuid, uuid)
  to authenticated, service_role;

-- Appends an album at `max(position) + 1`, computed inside one statement so two
-- concurrent adds cannot both claim the same tail position.
create or replace function public.add_list_item(
  p_list_id uuid,
  p_album_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform 1 from public.lists where id = p_list_id for update;

  insert into public.list_items (list_id, album_id, position)
  select p_list_id, p_album_id,
         coalesce(max(position) + 1, 0)
  from public.list_items
  where list_id = p_list_id;
end;
$$;

grant execute on function public.add_list_item(uuid, uuid)
  to authenticated, service_role;
