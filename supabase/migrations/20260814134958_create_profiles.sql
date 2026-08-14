-- longplayr — profiles
--
-- Supabase Auth owns credentials in auth.users. This table owns everything
-- public about a person. Keeping them separate is what makes the auth provider
-- replaceable without losing application data (docs/architecture.md §6).
--
-- A profile is created only once a handle has been chosen, so an authenticated
-- user without a profile row is mid-onboarding rather than broken.

create type public.user_status as enum ('active', 'suspended', 'banned');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Handles are lowercase-only so uniqueness needs no case folding.
  -- Format and length are provisional — docs/product-spec.md §8.8 is still
  -- open. Reserved words are rejected in the service layer, not here, so the
  -- list can change without a migration.
  handle text not null unique
    constraint profiles_handle_format
    check (handle ~ '^[a-z][a-z0-9_]{2,29}$'),

  display_name text
    constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 50),

  bio text
    constraint profiles_bio_length
    check (char_length(bio) <= 300),

  avatar_url text,

  status public.user_status not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile for an authenticated user. One row per auth.users row, created at handle selection.';

-- Profile lookup by handle is the single most common read in the product:
-- every profile URL is /<handle>.
create index profiles_handle_idx on public.profiles (handle);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Table privileges. These are separate from, and evaluated before, RLS: a role
-- with no GRANT gets "permission denied" no matter how permissive the policies
-- are. Every new table needs this block.
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- No delete grant. Profiles disappear by cascade when auth.users is deleted,
-- which is the only way an account should ever be removed.

-- Row Level Security is defence-in-depth here, not the primary authorisation
-- mechanism — that lives in the service layer (docs/architecture.md §5).
alter table public.profiles enable row level security;

-- Everything user-generated is public, by product decision.
create policy profiles_public_read
  on public.profiles
  for select
  using (true);

create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy: account deletion is a hard delete of auth.users, which
-- cascades here. Users never delete their profile independently.
