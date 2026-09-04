-- longplayr — revoke the privileges the defaults granted and the migrations never asked for
--
-- **A grant states intent; only a revoke enforces it.** Postgres grants
-- `EXECUTE` on a new function to `PUBLIC`, and this project's default ACL for
-- schema `public` grants `Dxtm` on new tables to `anon` and `authenticated`. An
-- explicit `grant … to authenticated` therefore *adds* a grant and removes
-- nothing, so every migration that named its intended audience restricted
-- nobody. Measured 2026-09-04: **9 of 10 project-authored functions were
-- `anon`-executable**, and calling `feed_activity` with the `anon` key returned
-- **HTTP 200** against a migration comment claiming there was nothing there for
-- `anon` to read.
--
-- **This is not a leak and was not exploitable.** All seven non-trigger
-- functions are `security invoker`, so RLS still decided what they could see;
-- PostgREST exposes no verb for `TRUNCATE` or `CREATE TRIGGER`. The defect is a
-- boundary the repository believed it had and did not. See `architecture.md`
-- §16.5 for the evidence and the per-function intent.
--
-- **Grants only.** No RLS policy, no schema, no data, no default ACLs, nothing
-- outside `public`, and no extension-owned function is touched.

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
--
-- **`revoke execute … from public`, never `revoke all … from public, anon,
-- authenticated`.** The second form is what `claim_ingestion_jobs` uses, and it
-- is correct there because nothing but the ingestion service may call it.
-- Copying it here would strip the `anon` access the search functions are
-- required to keep. Removing only the `PUBLIC` entry leaves every explicit role
-- grant standing.

-- Mutations. `anon` holds no DML grant on the underlying tables, so execution
-- already failed — this makes the boundary true rather than incidental.
revoke execute on function public.ensure_collection_entry(uuid, uuid, date) from public;
revoke execute on function public.add_list_item(uuid, uuid) from public;
revoke execute on function public.remove_list_item(uuid, uuid) from public;
revoke execute on function public.reorder_list_item(uuid, integer) from public;

-- A feed is a per-viewer query, not public content. This confirms the intent
-- `create_feed_activity.sql` already recorded in a comment.
revoke execute on function public.feed_activity(uuid, integer, timestamptz, uuid) from public;

-- Trigger functions. Unreachable through PostgREST, which does not expose
-- `trigger`-returning functions — but `sync_relisten_count` is `security
-- definer`, and a `security definer` function carrying `PUBLIC EXECUTE` is the
-- one combination worth removing on principle. Both had a null `proacl`, which
-- means the built-in default applied rather than that they were owner-only.
--
-- **Triggers keep firing.** `EXECUTE` is checked when a trigger is created, not
-- each time it fires, and the triggers are created by the migration owner.
-- Verified by test rather than inferred — see `tests/integration/privileges.test.ts`.
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.sync_relisten_count() from public;

-- Signed-out search is a shipped feature, so `anon` keeps these two. The grants
-- already existed; they are restated so this migration says what it intends
-- rather than leaving the capability to survive by inheritance.
revoke execute on function public.search_albums(text, integer) from public;
revoke execute on function public.search_artists(text, integer) from public;

grant execute on function public.search_albums(text, integer) to anon;
grant execute on function public.search_artists(text, integer) to anon;

-- `claim_ingestion_jobs` is deliberately absent. It is the one function that was
-- already correct, and re-revoking it would imply it was not.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
--
-- `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` — the `Dxtm` the default
-- ACL hands to `anon` and `authenticated` on every table. `MAINTAIN` is
-- Postgres 17 and does not appear in `information_schema.role_table_grants`,
-- which is why the first measurement of this defect saw only three.
--
-- **Nothing the application uses is touched.** Every `select`, `insert`,
-- `update` and `delete` grant stands, including the column-level
-- `update (read_at)` on `notifications`, which a table-level revoke cannot
-- affect. **`service_role` is untouched**, which is what keeps the integration
-- suite's truncation working.
revoke truncate, trigger, references, maintain
  on all tables in schema public
  from anon, authenticated;

-- **Future objects still inherit these defaults.** `ALTER DEFAULT PRIVILEGES`
-- is deliberately not changed here — that is a separate decision. Until it is
-- taken, the control is the convention in `CLAUDE.md`: a table or function is
-- not correctly provisioned until the privileges it should not offer have been
-- revoked.
