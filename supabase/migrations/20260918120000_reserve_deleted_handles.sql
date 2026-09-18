-- longplayr — handles are reserved permanently once an account is deleted
--
-- Hard deletion frees a handle. Letting the next person claim it means every
-- old link, mention and follower memory resolves to a stranger, with nothing in
-- the product to signal the substitution. Decided 2026-09-18:
-- docs/data-model.md §9.5, docs/product-spec.md §8.8.
--
-- Two triggers, and they are deliberately separate concerns:
--
--   reserve_handle()          records the handle as the profile disappears
--   reject_reserved_handle()  refuses it to anyone afterwards
--
-- The enforcement is here rather than in the service layer for the same reason
-- handle uniqueness already is: a read-then-insert check is racy, and the
-- database is the only place the answer cannot change between the check and the
-- write. docs/architecture.md §15.1.

-- ---------------------------------------------------------------------------
-- reserved_handles
-- ---------------------------------------------------------------------------
--
-- One column, and the omissions are the design.
--
-- No user id, no email, no created_at. CLAUDE.md treats a row that outlives its
-- owner as a privacy failure, so the row that must outlive one is justified only
-- by carrying nothing: no link to a person, no way to recover who held it, no
-- content. A timestamp would tie a handle to a moment and give a correlation
-- handle where none is needed. Breaking this schema's usual created_at
-- convention is intentional.

create table public.reserved_handles (
  handle text primary key
);

comment on table public.reserved_handles is
  'Handles freed by account deletion and never reusable. Deliberately holds nothing but the handle.';

-- ---------------------------------------------------------------------------
-- reserve_handle — fires as the profile goes
-- ---------------------------------------------------------------------------
--
-- BEFORE DELETE on profiles, which is what makes it unbypassable. The delete
-- this product issues targets auth.users and reaches profiles as a cascade;
-- a row trigger fires on a cascaded delete, whereas an application-level write
-- placed before the delete call would not, and would also be skipped by any
-- deletion issued outside the app.
--
-- SECURITY DEFINER because the deleting role need not hold insert on this
-- table — and must not: nothing but this trigger may write here.
--
-- ON CONFLICT DO NOTHING so that re-reserving an already reserved handle is a
-- no-op rather than an error that would abort the whole deletion.

create or replace function public.reserve_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reserved_handles (handle)
  values (old.handle)
  on conflict (handle) do nothing;

  return old;
end;
$$;

comment on function public.reserve_handle is
  'Records a handle as permanently reserved as its profile is deleted. Fires on cascaded deletes.';

create trigger profiles_reserve_handle_on_delete
  before delete on public.profiles
  for each row
  execute function public.reserve_handle();

-- ---------------------------------------------------------------------------
-- reject_reserved_handle — refuses it afterwards
-- ---------------------------------------------------------------------------
--
-- Raised as unique_violation rather than a bespoke error class: a reserved
-- handle is a taken handle, permanently, and createProfile already treats that
-- SQLSTATE as a normal outcome rather than an exception.
--
-- The message carries the marker `profiles_handle_not_reserved` so the service
-- can tell this apart from an ordinary duplicate without matching on prose or
-- on a handle value that could contain any word at all.
--
-- Covers UPDATE as well as INSERT. Handles cannot be changed today; if that
-- ever ships, it must not be a route back into a reserved handle.

create or replace function public.reject_reserved_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.reserved_handles where handle = new.handle) then
    raise exception 'handle is not available: profiles_handle_not_reserved'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

comment on function public.reject_reserved_handle is
  'Refuses a handle that a deleted account left reserved. Raises unique_violation.';

create trigger profiles_reject_reserved_handle
  before insert or update of handle on public.profiles
  for each row
  execute function public.reject_reserved_handle();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Granting is not restricting (docs/architecture.md §16.5). Supabase's default
-- privileges hand table rights to anon and authenticated, and Postgres grants
-- EXECUTE on a new function to PUBLIC — so the revokes below are what actually
-- decides the audience, and the grants only state intent.
--
-- Read is authenticated-only rather than public: the sole reader is the
-- advisory availability check during onboarding, which no signed-out visitor
-- reaches. Nobody but service_role writes, because only the trigger should.

revoke all on public.reserved_handles from anon, authenticated;
grant select on public.reserved_handles to authenticated;
grant all on public.reserved_handles to service_role;

revoke all on function public.reserve_handle() from public;
revoke all on function public.reject_reserved_handle() from public;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Read-only to signed-in users, and no write policy of any kind. The triggers
-- are SECURITY DEFINER, so they write regardless; anything else must not.

alter table public.reserved_handles enable row level security;

create policy reserved_handles_authenticated_read on public.reserved_handles
  for select to authenticated using (true);
