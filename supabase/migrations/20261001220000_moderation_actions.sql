-- longplayr — a statement of reasons, written in the same breath as the action
--
-- **What this repairs is live, not hypothetical.** §92 built content removal
-- and account suspension. Nothing tells the affected author anything, and
-- **DSA Art 17 requires that it does** — `docs/legal-obligations.md`
-- establishes the obligation applies today with no micro-enterprise exclusion.
--
-- **This is not a notification, and the reason is in `notifications`' own
-- comment.** That table says of its subject columns: *"both cascade, which is
-- the whole undo mechanism"*. For a retained record that is backwards —
-- restoring content must not erase the explanation of why it was removed.
-- `architecture.md` §16.10.
--
-- **One row holds the action and the statement**, because a report's resolution
-- and a statement of reasons are the same moment seen from two sides, and
-- separate rows let one exist without the other — the defect §92 shipped.
-- §16.10a.

create type public.moderation_action_kind as enum (
  'content_removed',
  'content_restored',
  'account_suspended',
  'account_reinstated'
);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),

  -- **The acting administrator. Recorded always, shown never.** Art 17 does not
  -- require naming the individual moderator, and in a product with one admin
  -- showing it would expose a named person to everyone they moderate. The
  -- column grants below are what enforce that — §16.10a and §16.10e.
  actor_id uuid not null references public.profiles (id) on delete cascade,

  -- The person owed the statement.
  subject_user_id uuid not null references public.profiles (id) on delete cascade,

  kind public.moderation_action_kind not null,

  -- **Deliberately `on delete set null`, against the pattern every other table
  -- here uses** (§16.10c-i). `notifications` cascades its subject because
  -- cascade *is* its undo. An author can hard-delete their own review, so
  -- cascading would mean **the author deleting the content destroys the
  -- statement explaining why it was removed** — the same failure §16.10
  -- rejected, through a different door. Do not "correct" these to cascade.
  review_id uuid references public.reviews (id) on delete set null,
  list_id uuid references public.lists (id) on delete set null,

  -- What was acted on, snapshotted, so the statement outlives its subject.
  subject_label text not null,

  -- The ground for the decision, and the text the author reads. Art 17 wants
  -- the facts relied on, the ground, and the redress available; redress is the
  -- address published on `/moderation` and is rendered rather than stored.
  ground text not null,
  statement text,

  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,

  -- **The obligation, in the schema rather than only in the service.** A
  -- restriction cannot be recorded without the statement that Art 17 owes. A
  -- restoration needs none: it is not a restriction.
  constraint statement_required_for_restrictions check (
    kind in ('content_restored', 'account_reinstated')
    or (statement is not null and length(btrim(statement)) > 0)
  ),

  -- A content action never names both; an account action names neither.
  --
  -- **It deliberately tolerates both being null, and the reason is a bug this
  -- constraint had in its first draft.** `ON DELETE SET NULL` performs an
  -- UPDATE on this row, and Postgres re-evaluates CHECK constraints on UPDATE.
  -- A stricter form — *a content action must name exactly one* — therefore
  -- **fails the constraint when the content is deleted, which blocks the delete
  -- and breaks an author deleting their own review.** The snapshot in
  -- `subject_label` is what carries the row once the key is gone.
  constraint subject_matches_kind check (
    case
      when kind in ('content_removed', 'content_restored')
        then not (review_id is not null and list_id is not null)
      else review_id is null and list_id is null
    end
  )
);

comment on table public.moderation_actions is
  'Moderation actions and their DSA Art 17 statements of reasons. architecture.md §16.10.';

create index moderation_actions_subject_idx
  on public.moderation_actions (subject_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- **The revoke is the fix; the grant only states intent** — `architecture.md`
-- §16.5, measured there against seven of eight functions that were
-- `anon`-executable while appearing to withhold it.
--
-- **RLS answers which rows; grants answer which columns** (§16.10e). The policy
-- below correctly scopes rows to the subject. It does nothing whatever about
-- `actor_id`, and a table-level `select` would hand the moderator's identity to
-- every person they moderate. The column list is the whole mechanism.
--
-- The policy references `subject_user_id` while `authenticated` cannot select
-- it. That is correct and not an oversight: a policy is evaluated server-side
-- over the row, and column privileges bound only what a client may request.

alter table public.moderation_actions enable row level security;

revoke all on table public.moderation_actions from anon, authenticated;

grant select (
  id, kind, review_id, list_id, subject_label, ground, statement,
  created_at, acknowledged_at
) on public.moderation_actions to authenticated;

grant all on table public.moderation_actions to service_role;

-- **No insert, update or delete to `authenticated`, including on
-- `acknowledged_at`.** Marking one read goes through the service-role client
-- like every other write in `src/services/admin/`. A legal record is not a
-- place to open a write surface for the convenience of a badge.

create policy moderation_actions_select_own
  on public.moderation_actions
  for select
  to authenticated
  using (subject_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The actions themselves
-- ---------------------------------------------------------------------------
--
-- **Why these are functions at all** (`architecture.md` §16.10d). Every write
-- in `src/services/admin/` is a single `update` through the service-role
-- client, and `supabase-js` has no multi-statement transaction. Writing the
-- statement as a second call leaves a window in which the status changed and no
-- statement exists — **§92's defect in a new form, inside the slice built to
-- repair §92.** One function, one statement, no window.
--
-- **The actor is a parameter, not `auth.uid()`.** The caller is the service-role
-- client, for which `auth.uid()` is null. Only `service_role` may execute these,
-- which is what makes trusting the parameter acceptable.
--
-- **The lockout guards stay in the service.** `setAccountStatus` already
-- refuses to moderate yourself or another admin, those refusals are tested, and
-- `CLAUDE.md`'s domain-logic test puts a rule a native client needs in
-- `src/services/`. These functions are the atomic write, not the policy.
--
-- **Null means the target does not exist**, matching the `.maybeSingle()`
-- shape the service already branches on.

create or replace function public.moderate_review(
  p_actor_id uuid,
  p_review_id uuid,
  p_status public.content_status,
  p_ground text,
  p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_label text;
  v_action uuid;
begin
  -- **`reviews` has no `user_id`.** The author is reached through
  -- `collection_entries`, which is how the table enforces one review per user
  -- per album. A `returning user_id` here would compile and fail at runtime.
  select ce.user_id, 'the review of ' || a.title
    into v_author, v_label
    from public.reviews r
    join public.collection_entries ce on ce.id = r.collection_entry_id
    join public.albums a on a.id = ce.album_id
   where r.id = p_review_id;

  if v_author is null then
    return null;
  end if;

  update public.reviews
     set status = p_status
   where id = p_review_id;

  insert into public.moderation_actions
    (actor_id, subject_user_id, kind, review_id, subject_label, ground, statement)
  values
    (p_actor_id, v_author,
     (case p_status when 'removed' then 'content_removed' else 'content_restored' end)::public.moderation_action_kind,
     p_review_id, coalesce(v_label, 'a review'), p_ground, p_statement)
  returning id into v_action;

  return v_action;
end;
$$;

comment on function public.moderate_review is
  'Sets a review status and writes its Art 17 statement in one statement. architecture.md §16.10d.';

create or replace function public.moderate_list(
  p_actor_id uuid,
  p_list_id uuid,
  p_status public.content_status,
  p_ground text,
  p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_action uuid;
begin
  update public.lists
     set status = p_status
   where id = p_list_id
  returning user_id, title into v_owner, v_title;

  if v_owner is null then
    return null;
  end if;

  insert into public.moderation_actions
    (actor_id, subject_user_id, kind, list_id, subject_label, ground, statement)
  values
    (p_actor_id, v_owner,
     (case p_status when 'removed' then 'content_removed' else 'content_restored' end)::public.moderation_action_kind,
     p_list_id, coalesce('the list ' || v_title, 'a list'), p_ground, p_statement)
  returning id into v_action;

  return v_action;
end;
$$;

comment on function public.moderate_list is
  'Sets a list status and writes its Art 17 statement in one statement. architecture.md §16.10d.';

create or replace function public.moderate_account(
  p_actor_id uuid,
  p_target_id uuid,
  p_status public.user_status,
  p_ground text,
  p_statement text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text;
  v_action uuid;
begin
  update public.profiles
     set status = p_status
   where id = p_target_id
  returning handle into v_handle;

  if v_handle is null then
    return null;
  end if;

  insert into public.moderation_actions
    (actor_id, subject_user_id, kind, subject_label, ground, statement)
  values
    (p_actor_id, p_target_id,
     -- **The cast is required and was found by executing this, not by reading
     -- it.** A `case` yielding string literals is `text`, and Postgres will not
     -- coerce text into an enum column implicitly: `42804`. `npm run verify`
     -- cannot see it — F-032 exactly.
     (case p_status when 'active' then 'account_reinstated' else 'account_suspended' end)::public.moderation_action_kind,
     'the account @' || v_handle, p_ground, p_statement)
  returning id into v_action;

  return v_action;
end;
$$;

comment on function public.moderate_account is
  'Sets an account status and writes its Art 17 statement in one statement. architecture.md §16.10d.';

-- Nothing but the service layer may call these, and the service reaches them
-- through the service-role key. `grant execute … to service_role` would add a
-- grant and remove nothing — Postgres grants EXECUTE to PUBLIC on creation, so
-- the revoke is the entire control. `architecture.md` §16.5.

revoke all on function public.moderate_review(uuid, uuid, public.content_status, text, text) from public, anon, authenticated;
revoke all on function public.moderate_list(uuid, uuid, public.content_status, text, text) from public, anon, authenticated;
revoke all on function public.moderate_account(uuid, uuid, public.user_status, text, text) from public, anon, authenticated;

grant execute on function public.moderate_review(uuid, uuid, public.content_status, text, text) to service_role;
grant execute on function public.moderate_list(uuid, uuid, public.content_status, text, text) to service_role;
grant execute on function public.moderate_account(uuid, uuid, public.user_status, text, text) to service_role;
