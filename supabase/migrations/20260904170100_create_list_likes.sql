-- longplayr — list likes
--
-- Phase 4, slice 2. `data-model.md` §5 holds the model, `product-spec.md` §6 the
-- behaviour, `architecture.md` §16.3 the notification contract.
--
-- **A separate table rather than a polymorphic `Like`**, for the reason
-- `review_likes` already records: polymorphic foreign keys cannot be enforced by
-- the database. Album likes remain a column on `collection_entries`, because
-- that is your own collection state rather than an interaction with someone
-- else's content.
--
-- **No Activity row, and none ever.** Likes generate no feed events by standing
-- decision — they would dominate by volume. They generate a *notification*
-- instead, which is what makes a like legible to its recipient at all.
-- `list_created` and `list_updated` belong to slice 3 and are not touched here.

create table public.list_likes (
  -- Surrogate, not a composite key on the pair. `notifications.list_like_id`
  -- must reference **one** column, so a composite key would force that table to
  -- carry two columns for one of its three subject references. Identical
  -- reasoning to `review_likes` and `follows`.
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,

  -- No user-supplied date and no updated_at. A like is created or destroyed;
  -- there is nothing about it to edit, which is why no update grant is issued.
  created_at timestamptz not null default now(),

  -- **The integrity boundary.** One like per user per list, enforced here and
  -- not in the service. The service turns the resulting unique violation into a
  -- clean outcome; it does not prevent the collision.
  constraint list_likes_one_per_user_per_list unique (user_id, list_id)
);

comment on table public.list_likes is
  'A like on someone else''s list. Generates a notification, never a feed event.';

-- The unique constraint's index leads on `user_id`, which serves "which of these
-- lists have I liked?". It does not serve the reverse direction, and **the
-- cascade needs that direction**: without this index every list deletion
-- sequentially scans this table. `review_likes` indexes its cascade for the same
-- reason, and so does the count this table now has to serve.
create index list_likes_list_idx on public.list_likes (list_id);

-- Table privileges, evaluated before RLS. Every new table needs this block.
grant select on public.list_likes to anon, authenticated;
grant insert, delete on public.list_likes to authenticated;
grant all on public.list_likes to service_role;

-- No update grant, deliberately. Altering user_id or list_id would be forging
-- someone else's like, and created_at is the system's record of when it happened.

-- **Granting is not restricting.** This is the first table created since that
-- convention was written, and it inherits `Dxtm` from the schema's default ACL
-- exactly as every table before it did. See `CLAUDE.md` and `architecture.md`
-- §16.5 — the privileges below are removed because nothing here should offer
-- them, not because anything can currently reach them.
revoke truncate, trigger, references, maintain
  on public.list_likes
  from anon, authenticated;

alter table public.list_likes enable row level security;

-- Everything user-generated is public.
create policy list_likes_public_read on public.list_likes
  for select using (true);

-- You may only create or destroy your own like, and only on a list you can
-- actually read.
--
-- **The `exists` clause is a deferral to `lists_public_read`, not a restatement
-- of it.** A policy subquery has the referenced table's own row security
-- applied, so a list this caller may not read is simply not found here and the
-- insert is refused. `lists_public_read` is `status = 'live' or user_id =
-- auth.uid()`, so a moderation-removed list cannot be liked by a stranger while
-- its owner can still read it. **Do not "simplify" this away.**
--
-- **It deliberately does not prevent a self-like.** An owner can read their own
-- list, so this policy admits it. Refusing a self-like is service-layer
-- behaviour and is **not** an integrity boundary: a list's owner is `lists.user_id`,
-- a column on a different table, so no CHECK can express it and only a trigger
-- could. None is added — `data-model.md` §5 records the decision and the one way
-- its consequence differs from a review's.
create policy list_likes_write_own on public.list_likes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.lists l where l.id = list_id)
  );

-- ---------------------------------------------------------------------------
-- Notifications gain their third subject
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column list_like_id uuid references public.list_likes (id) on delete cascade;

-- One notification per source row, matching the other two subjects. Nullable,
-- and Postgres permits many NULLs under a unique constraint, so all three types
-- coexist without a partial index.
alter table public.notifications
  add constraint notifications_one_per_list_like unique (list_like_id);

-- **The type/subject constraint is rewritten, not extended, and all three
-- branches change.** Adding a third subject column means the two existing
-- branches must now also assert that it is null — otherwise a `followed` row
-- could carry a stray `list_like_id` and the `CASE` would still return true.
-- Verified before writing: the pre-existing constraint admits exactly that.
--
-- **The `else false` stays, and stays load-bearing.** `activity_subject_matches_type`
-- has no `ELSE`, so a future value added there is silently unconstrained. That
-- gap is not reproduced here: a fourth notification type is rejected outright
-- until it gains a matching `WHEN`.
alter table public.notifications
  drop constraint notifications_subject_matches_type;

alter table public.notifications
  add constraint notifications_subject_matches_type check (
    case type
      when 'followed'
        then follow_id is not null and review_like_id is null and list_like_id is null
      when 'review_liked'
        then review_like_id is not null and follow_id is null and list_like_id is null
      when 'list_liked'
        then list_like_id is not null and follow_id is null and review_like_id is null
      else false
    end
  );

comment on table public.notifications is
  'Directed events: someone followed you, or liked your review or list. Private to the recipient.';
