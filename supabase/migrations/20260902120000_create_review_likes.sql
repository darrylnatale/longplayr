-- longplayr — review likes
--
-- Phase 3, slice 4. One relation, and the two things worth reading carefully are
-- what the database enforces and what it deliberately does not.
--
-- **A separate table rather than a polymorphic `Like`.** Polymorphic foreign
-- keys cannot be enforced by the database and there are only two like targets
-- (`data-model.md` §5). Album likes are not here at all — they are a column on
-- `collection_entries`, because that is your own collection state rather than an
-- interaction with someone else's content.
--
-- **No Activity row.** Likes generate no feed events, by decision: they would
-- dominate the feed by volume and crowd out reviews (`product-spec.md` §4,
-- `data-model.md` §5). They generate a *notification* instead, which is the only
-- way a like becomes visible to its recipient at all — **and notifications are
-- the next slice, not this one.** Until then a like is visible to nobody but the
-- person who gave it. That is the expected intermediate state.

create table public.review_likes (
  -- A surrogate key rather than a composite primary key on the pair, and the
  -- reason is a documented downstream requirement rather than style:
  -- `data-model.md` §7 gives Notification a nullable `review_like_id` alongside
  -- `follow_id` and `list_like_id`, and requires that unliking removes the
  -- notification by cascade. **A foreign key must reference one column**, so a
  -- composite key would force that table to carry two columns for one of its
  -- four subject references. This is the identical argument that gave `follows`
  -- its surrogate key.
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles (id) on delete cascade,
  review_id uuid not null references public.reviews (id) on delete cascade,

  -- No user-supplied date, and no updated_at. A like is created or destroyed;
  -- there is nothing about it to edit, which is also why no update grant is
  -- issued below.
  created_at timestamptz not null default now(),

  -- **The integrity boundary.** One like per user per review, enforced here and
  -- not in the service. The service turns the resulting unique violation into a
  -- clean outcome; it does not prevent the collision.
  constraint review_likes_one_per_user_per_review unique (user_id, review_id)
);

comment on table public.review_likes is
  'A like on someone else''s review. Generates a notification, never a feed event.';

-- The unique constraint's index leads on `user_id`, which serves the only query
-- the album page makes: "which of these reviews have I liked?", as
-- `user_id = me and review_id in (...)`. It does not serve the reverse
-- direction, and **the cascade needs that direction**: without this index every
-- review deletion sequentially scans this table. `follows` indexes both of its
-- directions for the same reason.
create index review_likes_review_idx on public.review_likes (review_id);

-- Table privileges, evaluated before RLS. Every new table needs this block.
grant select on public.review_likes to anon, authenticated;
grant insert, delete on public.review_likes to authenticated;
grant all on public.review_likes to service_role;

-- No update grant, deliberately. Altering user_id or review_id would be forging
-- someone else's like, and created_at is the system's record of when it
-- happened.

alter table public.review_likes enable row level security;

-- Everything user-generated is public.
create policy review_likes_public_read on public.review_likes
  for select using (true);

-- You may only create or destroy your own like, and only on a review you can
-- actually read.
--
-- **The `exists` clause is load-bearing, and it is not a restatement of
-- `reviews_public_read` — it is a deferral to it.** A policy subquery has the
-- referenced table's own row security applied, so a review this caller may not
-- read is simply not found here and the insert is refused. Verified by
-- execution before this was written: as a non-author, liking a
-- `status = 'removed'` review raises "new row violates row-level security
-- policy". **Do not "simplify" it away** — without it, a stranger who guessed a
-- removed review's id could like it.
--
-- **It deliberately does not prevent a self-like.** An author can read their own
-- review, live or removed, so this policy admits it. Refusing a self-like is
-- service-layer behaviour and is **not** an integrity boundary: a review's
-- author is not a column on the like, so no CHECK can express it and only a
-- trigger could. None is added — a self-like is a vanity annoyance rather than
-- an integrity or privacy failure (`data-model.md` §5). Describing it as
-- enforced would be false.
create policy review_likes_write_own on public.review_likes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.reviews r where r.id = review_id)
  );
