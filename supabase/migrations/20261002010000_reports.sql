-- longplayr — somebody can say something is wrong
--
-- **Phase 6 slice 3b.** DSA Art 16 requires a notice-and-action mechanism
-- allowing *any individual or entity* to notify a hosting provider of content
-- they consider illegal. It applies with **no micro-enterprise exclusion** —
-- `docs/legal-obligations.md` §2.1.
--
-- **Art 16 was already satisfied before this table existed**, which is why this
-- slice came second rather than first: the address published on `/moderation`
-- is the channel for everybody, and `architecture.md` §16.10b records that it is
-- what makes in-product reporting signed-in-only lawful rather than a gap.
-- **This adds convenience, not compliance**, and that ordering was deliberate.
--
-- **Insert-only for `authenticated`, and readable by nobody but an
-- administrator** (§16.10f). `product-spec.md` §4.2 decided the reporter is
-- never told the outcome — it would reveal whether a specific account was acted
-- on, and the person acted on is the one with the right to know. So there is no
-- read policy here to get subtly wrong. **Removing the surface is stronger than
-- guarding it**, which is §92 and §94's lesson applied in the other direction.

create type public.report_reason as enum (
  'spam',
  'harassment',
  'sexual_or_violent',
  'illegal',
  'other'
);

comment on type public.report_reason is
  'The five reasons of product-spec.md §4.1. One list across reviews, lists and accounts.';

create type public.report_state as enum ('open', 'resolved', 'dismissed');

create table public.reports (
  id uuid primary key default gen_random_uuid(),

  reporter_id uuid not null references public.profiles (id) on delete cascade,

  -- **One nullable key per target, not a polymorphic pair.** The same shape
  -- `notifications` uses, so the database enforces that the target exists.
  -- **These cascade, unlike `moderation_actions`'** (§16.10c-i): a report is a
  -- notice about something, and a notice about content that no longer exists is
  -- not a retained record of a decision — nothing is owed to anybody once the
  -- subject is gone.
  review_id uuid references public.reviews (id) on delete cascade,
  list_id uuid references public.lists (id) on delete cascade,
  subject_user_id uuid references public.profiles (id) on delete cascade,

  reason public.report_reason not null,

  -- **Free text only on `other`, and that is a constraint rather than a form
  -- rule.** `product-spec.md` §7 defers comments as the largest moderation
  -- liability in the product, so free text is admitted in exactly one place and
  -- the database is what holds the line. §4.1.
  detail text
    constraint reports_detail_length check (detail is null or char_length(detail) <= 1000),

  state public.report_state not null default 'open',

  created_at timestamptz not null default now(),
  settled_at timestamptz,

  constraint reports_detail_only_on_other check (
    reason = 'other' or detail is null
  ),

  -- Exactly one target.
  constraint reports_one_target check (
    (review_id is not null)::int
      + (list_id is not null)::int
      + (subject_user_id is not null)::int = 1
  ),

  -- You cannot report yourself. Not a safety rule — it is noise in a queue
  -- with one moderator.
  constraint reports_not_self check (subject_user_id is null or subject_user_id <> reporter_id)
);

comment on table public.reports is
  'DSA Art 16 notices. Insert-only for the reporter; the queue is admin-only. architecture.md §16.10f.';

-- **One open report per person per target.** A duplicate returns `23505`, which
-- the service renders as *you have already reported this* — that leaks nothing,
-- because the reporter already knows what they did. Partial, so a settled
-- report does not block a later one about the same thing.
create unique index reports_one_open_per_review
  on public.reports (reporter_id, review_id) where state = 'open' and review_id is not null;
create unique index reports_one_open_per_list
  on public.reports (reporter_id, list_id) where state = 'open' and list_id is not null;
create unique index reports_one_open_per_account
  on public.reports (reporter_id, subject_user_id)
  where state = 'open' and subject_user_id is not null;

-- The queue reads this: open first, oldest first, because a notice that has
-- waited longest is the one most overdue.
create index reports_queue_idx on public.reports (state, created_at);

-- ---------------------------------------------------------------------------
-- Linking a decision back to the notice that prompted it
-- ---------------------------------------------------------------------------
--
-- **Nullable, because an administrator may act without a report** — and the Art
-- 17 statement is owed either way. `on delete set null` for the same reason the
-- content keys are: the statement must outlive everything around it.

alter table public.moderation_actions
  add column report_id uuid references public.reports (id) on delete set null;

comment on column public.moderation_actions.report_id is
  'The notice that prompted this, if any. Nullable: an admin may act unprompted.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- **`select` is granted to nobody.** §16.10f — there is nothing here a reporter
-- may read, so there is no read policy and no column list to maintain.
--
-- **The revoke is the fix; the grant only states intent** (§16.5).

alter table public.reports enable row level security;

revoke all on table public.reports from anon, authenticated;

grant insert (reporter_id, review_id, list_id, subject_user_id, reason, detail)
  on public.reports to authenticated;

grant all on table public.reports to service_role;

-- `with check` and no `using`: an insert policy needs only the former, and
-- writing a `using` clause would imply a read this grant does not permit.
create policy reports_insert_own
  on public.reports
  for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Ceilings
-- ---------------------------------------------------------------------------
--
-- **Reuses the trigger §96 built**, unchanged. **Chosen, not measured** — the
-- same standing as §96's ceilings and the twelve-character password minimum,
-- stated in the same words. Generous enough that no genuine reporter meets
-- them, tight enough to bound a script. **Raising them when real usage says so
-- is expected and is not a finding.**
--
-- Lower than liking by an order of magnitude: reporting is a deliberate act
-- about a specific thing, and a person who files twenty in an hour is either
-- in distress or automating.

create trigger reports_rate_limit
  before insert on public.reports
  for each row
  execute function public.enforce_rate_limit('reporter_id', '20', '60');
