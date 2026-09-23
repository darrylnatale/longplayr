-- longplayr — an admin, and columns a user cannot reach
--
-- Two things, and the second is the more important of them.
--
-- **The privilege model.** `profiles.is_admin`, settable only by SQL. There is
-- deliberately no path in the product to grant it: the first admin has to be
-- made by hand whatever else exists, and a second way to become one is a second
-- thing to attack. `architecture.md` §14.2.
--
-- **The hole §91 left open.** Slice 1 made `status` *mean* something on every
-- read path. It did not make it stick: `grant insert, update on public.profiles
-- to authenticated` is table-level, so it covers every column, and
-- `profiles_update_own` permits any update to your own row. A suspended account
-- holding its own token could therefore PATCH `{"status":"active"}` onto itself
-- and succeed. `reviews_write_own` and `lists_write_own` are `for all` over the
-- same kind of grant, so an author could restore their own removed content.
-- `architecture.md` §14.1.
--
-- **RLS answers *which rows*; it never answers *which columns*.** That is the
-- general shape of the defect and the reason the fix is grants rather than
-- policies: a policy that correctly scopes a row is routinely mistaken for one
-- that scopes a field, and the two are unrelated.
--
-- **Not exploitable when found**, and recorded rather than used as comfort:
-- four test profiles, nobody suspended, nothing removed. A hole waiting for the
-- feature.

-- ---------------------------------------------------------------------------
-- is_admin
-- ---------------------------------------------------------------------------
--
-- Not null with a default, so every existing row is explicitly not an admin
-- rather than unknown. No index: the table is tiny and the column is read once
-- per admin request, never filtered on in a hot path.

alter table public.profiles
  add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Moderation privilege. Set by SQL only — no application path grants it. architecture.md §14.2.';

-- ---------------------------------------------------------------------------
-- Column privileges
-- ---------------------------------------------------------------------------
--
-- **The revoke is the fix; the grant only states intent** (`architecture.md`
-- §16.5). Replacing a table-level UPDATE with a column list is the whole
-- mechanism: after this, no token held by `authenticated` can reach `status` or
-- `is_admin` at all, whatever any policy permits.
--
-- `updated_at` is deliberately absent from every list below. It is maintained
-- by `set_updated_at` triggers, which run as the table owner and are unaffected
-- by what the caller may write.

revoke update on public.profiles from authenticated;
grant update (handle, display_name, bio, avatar_url) on public.profiles to authenticated;

-- A review's author may rewrite it and may delete it. They may not decide
-- whether it is live: that is the moderation outcome itself.
--
-- **`collection_entry_id` is in this list and `body` alone is not enough**, for
-- a reason that is not obvious and was found by probing rather than by
-- reasoning. `saveReview` is a PostgREST **upsert**, which compiles to
-- `INSERT … ON CONFLICT DO UPDATE SET …` over **every column in the payload** —
-- and Postgres checks UPDATE privilege on that SET list **whether or not a
-- conflict actually occurs**. Granting `body` alone therefore returned
-- `42501 permission denied` on the *first* save of a review, not merely on an
-- edit: it broke reviewing outright.
--
-- Widening it costs nothing that matters. `reviews_write_own`'s `with check`
-- still requires the target entry to belong to the writer, so an author can
-- move their review only between their own entries — and `status` remains
-- absent, which is the whole point.
revoke update on public.reviews from authenticated;
grant update (collection_entry_id, body) on public.reviews to authenticated;

revoke update on public.lists from authenticated;
grant update (title, description, is_ranked) on public.lists to authenticated;

-- `list_items` carries no status and is untouched, but the same reasoning is
-- why it is left alone rather than swept: position and album are the whole
-- editable surface, and both are legitimately the author's.

-- ---------------------------------------------------------------------------
-- Admin writes do not go through RLS at all
-- ---------------------------------------------------------------------------
--
-- Moderation runs on the service-role client, which bypasses RLS, and the
-- service layer checks `is_admin` (`architecture.md` §5, §14.2). **No
-- admin-shaped policy is added here, and that is deliberate**: with no grant to
-- `authenticated` on these columns there is no policy left to subvert, which is
-- a stronger position than a policy that has to be written correctly.
--
-- `service_role` already holds `all` on each of these tables from their
-- original migrations, so nothing needs granting back.
