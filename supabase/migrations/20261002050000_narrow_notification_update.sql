-- longplayr — the table that taught the rule never had it applied
--
-- **`notifications` granted `update (read_at)` to `authenticated` and never
-- revoked table-level `update` first**, so the column list narrowed nothing:
-- Supabase's default privileges had already given the role the table. With
-- `notifications_recipient_update` permitting a recipient to update their own
-- row, a user token could rewrite **any** column of its own notifications —
-- `type`, `actor_id`, `follow_id`, `review_like_id`.
--
-- **The detail that makes this worth recording rather than just fixing.**
-- `20260924120000_grant_and_policy_audit.sql` is the deliberate sweep of this
-- exact rule, and its own header quotes this table as where the rule came
-- from: *"`notifications` grants `UPDATE` on `read_at` alone, and
-- `markNotificationRead` says why in as many words."* It then revoked on
-- `collection_entries`, `list_items` and `favourite_albums` — **and never on
-- `notifications`.** The table that taught the lesson is the one place it was
-- not applied.
--
-- **Severity is low and is stated rather than leaned on.** RLS scopes the rows
-- to their recipient, so the worst available outcome is somebody rewriting
-- their own private notification list. Nobody else can read it, and nothing
-- downstream trusts it. **It is the convention that was broken, not a user.**
--
-- **Found by `scripts/check-privileges.mjs`**, written in the same cycle — and
-- the point of that script is that this was the only one of eight column
-- grants missing its revoke, which no amount of reading had noticed across two
-- prior audits. `architecture.md` §16.12.
--
-- **The revoke is the fix; the grant only restates intent** (§16.5). `read_at`
-- is the only column any writer touches: `markNotificationRead` sets it and
-- nothing else does.

revoke update on public.notifications from authenticated;

grant update (read_at) on public.notifications to authenticated;
