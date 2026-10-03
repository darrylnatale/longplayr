# longplayr

A social music platform: users record the albums they've listened to, rate and review them, build lists, follow each other, and discover music through that activity.

**Current state [UPDATED 2026-09-18 — the previous line named `80e5c44`, fifteen pull requests out of date, which is the "actively misleading" bar this line sets for itself]: Phases 0 to 4 are complete. Phase 5 is _not_ complete and must not be described as such** — slices 1 (Popular this week) and 3 (the home discovery surface) are built and CI-verified; **slice 2, highest rated this week, is deferred by decision**, not outstanding work: `product-spec.md` §8.3 sets a five-rating threshold per album and the product holds two ratings in total, so the chart would be empty and fall through to external fill. It reopens when the internal chart reaches twenty entries from real activity — a trigger it shares with the Browse hierarchy in `design-reference.md` §11.11.

**Phase 6 is half built and Phase 7 is entirely unbuilt. [CORRECTED 2026-09-26 — this line read _"Phases 6 and 7 are entirely unbuilt"_, which was wrong at a STEP 00 that relied on it.]** **Phase 6 slices 1 and 2 are in production** — status enforced across every read path, an admin identity, suspend and reinstate, remove and restore (`/admin`, `src/services/admin/`, `20260922120000_admin_and_column_privileges.sql`). **Slice 3 is built too. [CORRECTED 2026-10-03 — this line read _"Slice 3 is what remains"_, the third time this file has been wrong about phase state.]** Reporting, the moderation audit trail and **statements of reasons** are deployed: `reports` carries reporter, subject, reason, detail, state and `settled_at`; `moderation_actions` carries `ground`, `statement`, `acknowledged_at` and `report_id`, with `/moderation`, `src/services/moderation/` and integration tests for both. `docs/legal-obligations.md` establishes the last two as DSA obligations rather than product tooling, and they are met in mechanism — **not reviewed by a lawyer**, which §10.4's flagged question still needs. **Blocking is unassigned by decision.**

**Phase 7 is half built too. [CORRECTED 2026-10-01 — the line above read _"Phase 7 is entirely unbuilt"_ when it was written on 2026-09-26, five days earlier, in a cycle whose subject was documentation accuracy. It was wrong then.]** **Four of its eight items are built**: account deletion as a hard delete with its cascade (§87), data export (§93), rate limits on abuse-prone writes (§96), and ingestion health monitoring as the `/debug/queue` operator view. **Four are absent**: error tracking on server and client, uptime checks, the security review of auth and the admin surface, and the performance pass on the heaviest surfaces. **Account deletion is no longer an unmet non-negotiable** — that is the single most load-bearing correction here. Phase 7 is launch readiness, and includes **account deletion as a hard delete with a complete cascade**, which is a non-negotiable below and is not built. **Neither phase appeared in a STEP A ranking between §72 and §86**, because selection drew only on `docs/product-feedback.md`. **STEP A must weigh the phase plan alongside the feedback backlog.**

**`main` is at `df49422`** (PR #65, CI `37099597106` `completed/success` on `736ca64`, attempt 1, **148 end-to-end, zero flaky**). **One clean run is not proof the F-063 flake is fixed** — see `cycle-log.md` §123., with nothing open and nothing pending. **The repository is public and branch protection is on** — both checks required, strict, though `enforce_admins` is `false` and there is one admin, so it is a guard rail rather than a mechanism (`architecture.md` §12.7).

**This line goes stale fast and is not the source of truth. `docs/current-state.md` is** — it is reconciled at every STEP K, and this line is updated only when it would actively mislead. See `docs/current-state.md` for exactly where things stand and what to do next. `docs/development-plan.md` defines what belongs to which phase — do not build ahead of the current phase without saying so.

---

## Non-negotiable rules

These are decided. Do not change them without raising the decision explicitly first.

- **One collection entry per user per album, permanently.** longplayr is a collection, not a dated diary. An album appears in a collection exactly once no matter how many times it's played.
- **Profiles never display dates.** Timestamps exist in the data and drive sort order and feed eligibility. They are not rendered on profiles or collections.
- **Feed events record interactions, not history.** An event is generated when a user acts, at the moment they act — that is the whole invariant. **A user-supplied `listened_on` never decides it**: an album added by hand is an interaction whether the listen was last night or in 1997. **Historical and backfilled collection data must never generate events** — a collection arriving in bulk is history being recorded, not hundreds of interactions, and treating it as the latter floods every follower's feed and cannot be undone. Adding to Want to Listen is an interaction and does generate an event. This sentence is the rule, **not the list of event types**; `docs/product-spec.md` and the owning phase define those, and the list grows.
- **Singles are outside the current catalogue boundary, and that boundary is not permanent.** **[AMENDED 2026-08-23]** Catalogue scope today is albums, EPs and mixtapes — including live albums, compilations and soundtracks. Still enforced at ingest, not at query time, and **no code changed with this amendment**. This line previously read _"Singles are never ingested"_, and the permanence was wrong: completionism does not exclude material by release type as a matter of principle, and a singles-only artist is presently unreachable by **every** route including self-service — a known, temporary exception to the breadth rule below. **The eventual treatment of singles is undecided and must be asked**, in particular whether a single becomes a catalogue release, a discovery object, or is represented only through the unique recordings it contains, such as a standalone track or a B-side that appears nowhere else. See `docs/product-spec.md` §8.9.
- **The catalogue is open-ended in breadth and completion-oriented in depth. Membership never depends on popularity.** **[DECIDED 2026-08-23]** There is no fixed universe of artists and no artist is permanently outside the catalogue. Once an artist is included, the goal is eventual completion of their in-scope body of work rather than a popularity-based sample, so **there is no permanent per-artist cap** — and a larger arbitrary cap is not the mechanism. Popularity is a **separate signal from membership**, and the absence of an external popularity signal says nothing about an album's merit. **The initial boundary is deliberately narrower than the principle** — albums, EPs and mixtapes, a curated starting set, and a temporary cap of 2 on the cold-start popularity seed — and that boundary must never be read as the model. See `docs/product-spec.md` §8.9.
- **The catalogue is read-only downstream of MusicBrainz — with one deliberate exception, decided but unbuilt. [AMENDED 2026-09-24]** This line read _"No user-authored metadata, ever"_ and **the permanence was removed by explicit decision**, which is the mechanism this section requires. The reason was concrete: a musician who self-releases a single track should be findable even where no official release exists (`product-feedback.md` F-011, F-040).

  **Nothing is built, nothing is scheduled, and the rule still governs every line of code today.** What changed is that it is no longer permanent.

  **The first question is not technical and must be answered before any other.** MusicBrainz accepts bootlegs, demos, DJ mixes and self-released material, so **most cases this exception was opened for are addressable upstream** — and `product-spec.md` §8.9 already decided contributing upstream is the strategy. **What genuinely cannot go upstream is unestablished**, and building an exception for a case that does not exist would be the expensive mistake here.

  **Three consequences are already visible and none is small.** `albums`, `artists` and `releases` all declare `mbid` **`not null unique`**. **Cover Art Archive is keyed by release-group MBID and has no fallback source**, so a user-authored album has no artwork path at all. **ListenBrainz popularity is MBID-keyed**, so such a record can never carry a popularity signal. See `docs/product-spec.md` §8.9a.

  **`architecture.md` §19.1 is untouched and still holds**: canonical identity stays MusicBrainz-shaped, and a provider identifier is enrichment rather than identity. **This exception is about records MusicBrainz does not have — not about a second source of truth for records it does.**

- **Canonical catalogue identity is MusicBrainz-shaped. Provider identifiers are enrichment attached to an entity, never the identity of one.** **[DECIDED 2026-08-23]** longplayr owns music identity and user relationships; it does not own the streaming catalogue. A Spotify, Apple Music, YouTube or Discogs identifier may hang off an album or track we already identify by MBID — it may never be what identifies one. Currently true by absence, and recorded now because the first integration is exactly where it would be broken casually, and because retrofitting identity is a migration across every relation. **This authorises no provider integration.** See `architecture.md` §19.1.
- **Ratings are optional, 0.0–10.0 to one decimal.** Unrated entries are excluded from averages.
- **Tracks are never rated, reviewed, logged or listed.** Tracklists are display-only.
- **Everything user-generated is public.** No private accounts, no per-entry visibility.
- **Account deletion is a hard delete** with a complete cascade. An orphaned row is a privacy failure.
- **No SQL or database client calls inside React components.** Everything goes through the service layer.
- **MusicBrainz is rate-limited to one request per second per IP.** Exceeding it returns `503` for _every_ request from that address, not just the excess. Always go through `src/services/catalogue/rate-limiter.ts`; never fetch in a loop.
- **No live MusicBrainz ingestion until `MUSICBRAINZ_CONTACT` is a real contact URL.** Local development uses a placeholder and the client refuses to make live requests while it looks like one. This is enforced in code — do not work around it.

## Deliberately not in scope

Comments, private accounts, track-level features, streaming integration or OAuth, passive scrobbling, in-app playback, gamification. Each is deferred with reasoning in `docs/product-spec.md` §7. Do not add any of them without an explicit scope decision.

**Direct messaging's blocking legal precondition is discharged as researched, not as cleared. [2026-09-24]** `docs/legal-obligations.md` answers what the minimum safety layer is — **Art 16 notice-and-action and Art 17 statements of reasons**, which Phase 6 slice 3 already owes. **One question inside it still needs a lawyer** and is flagged there. **Nothing here schedules messaging**, and §10.4's long list of unasked product questions is untouched.

**Passive scrobbling is under investigation and has NOT left this list** (`product-spec.md` §8.11, 2026-08-22). An investigation is not a scope decision; §2 still reads "Not a scrobbler". **Track-level features have not left it either** — §10.7 records a direction in which a track becomes a catalogue and discovery object without becoming a social one, which does not reverse "Tracks are never rated, reviewed, logged or listed".

**Direct messaging and taste overlap left this list on 2026-08-18 by explicit scope decision** — the mechanism this section requires. Both are now recorded direction in `docs/product-spec.md` §10. **Neither is implemented, neither is scheduled, and both carry unresolved product questions that must be asked rather than inferred.** Messaging additionally has a blocking legal-research precondition (§10.4). Nothing here authorises building either one.

## Recorded direction is not scope

`docs/product-spec.md` §10 records product direction that is **decided but deliberately unbuilt**: Want to Listen **beyond the album-level relation**, taste overlap, profile photo/bio/city, direct messaging, **quick actions on a tile and on an upstream search result** (§10.6), and **eventual completion** (§10.7). Dating-specific profile fields are explicitly excluded.

**One part of Want to Listen has since been scheduled and built**, and it is **the only thing in this section that has been built**: the album-level relation and its action-card control, delivered as a Phase 2 slice. Its **profile destination, and any Activity or feed integration, remain unbuilt and unscheduled** — being decided is still not being scheduled, which is the whole point of this section.

**§10.7 has since split, and only one half moved — into decision, not into work.** Its **catalogue-depth** half became decided product principle on 2026-08-23; see the breadth and depth rule above, and `docs/product-spec.md` §8.9. **That is a second exception to "recorded direction is not scope", and it is a different kind from Want to Listen's: nothing has been built, and nothing is scheduled.** A narrow immediate boundary has been **identified and assigned to a Phase 1 reopening**, which names the phase that owns the work rather than putting it in a queue — and the work is **blocked on a curated starting set that does not exist yet**. Its **completion** half did not move at all: how completion is calculated, whether a percentage is even the right framing, and whether it ever surfaces are undecided and must not be inferred. **Deepening a discography is not completion tracking**, and delivering the discography `product-spec.md` §5 already promises is not converting §10.7 into scope.

Every question that section lists under "ask before implementing" is unresolved **by design**. Answering one silently — by taking the obvious default, by following the reference product, or by reasoning from the rest of the spec — is a scope violation, not a judgement call. Stop and ask.

---

## Stack

|                    |                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Frontend / backend | Next.js App Router, TypeScript, colocated server logic                                            |
| Database           | Supabase Postgres                                                                                 |
| Auth               | Supabase Auth — email/password + Google                                                           |
| File storage       | Supabase Storage (artwork)                                                                        |
| Hosting            | Vercel                                                                                            |
| Metadata           | MusicBrainz                                                                                       |
| Artwork            | Cover Art Archive only, by release-group MBID. No fallback source — see `docs/architecture.md` §7 |
| Popularity         | ListenBrainz, behind a `PopularitySource` abstraction                                             |
| Search             | Postgres full-text + `pg_trgm`                                                                    |
| Testing            | Vitest (unit, integration), Playwright (end-to-end)                                               |

---

## Documents

Listed in authority order. When two disagree, the higher one wins.

| File                           | Contents                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `docs/product-spec.md`         | What longplayr is, MVP scope, deferrals, open product decisions              |
| `docs/design-reference.md`     | Letterboxd analysis, what to borrow/adapt/avoid, original design needs       |
| `docs/data-model.md`           | Conceptual entities and relationships                                        |
| `docs/architecture.md`         | Technical decisions with alternatives and reasoning                          |
| `docs/development-plan.md`     | Phased implementation sequence                                               |
| `docs/deployment.md`           | Steps requiring accounts: GitHub, Supabase, Vercel, MusicBrainz contact      |
| `docs/current-state.md`        | **Where we are right now.** Read this first when resuming work               |
| `docs/cycle-log.md`            | Every completed cycle, newest first. Append-only history, no authority       |
| `docs/legal-obligations.md`    | **DSA and German obligations, researched 2026-09-24.** Not legal advice      |
| `docs/claude-code-playbook.md` | How to work in this repo with Claude Code                                    |
| `docs/product-feedback.md`     | **No authority.** Raw product-feedback inbox — observations, never decisions |

**`docs/current-state.md` holds standing sections §1–§12; every cycle checkpoint lives in `docs/cycle-log.md`. [SPLIT 2026-09-26]** A bare `§N` resolves by that rule, and `architecture.md` §20 records why. `docs/current-state.md` is the lowest authority and goes stale fastest — it describes progress, never decisions. Anything it says that contradicts this file or the specs is wrong.

`docs/product-feedback.md` sits **outside** the authority order rather than at the bottom of it. It holds unevaluated observations from using the product and never overrides, amends or reopens anything above it — see [Product feedback](#product-feedback).

`transcript.md` and the three `claude-*` docs are reference material. Do not modify them.

---

## Working in this repo

```bash
npm run db:start && npm run db:env   # local Supabase (Docker), then write .env.local
npm run dev                          # http://localhost:3000
npm run verify                       # fast loop — no database, no browser
npm run verify:full                  # what CI runs — optional locally since 2026-09-15
```

**Two levels of verification, and the difference matters.**

`npm run verify` is the fast development loop: format, lint, typecheck, unit and component tests, and a production build. It touches neither a database nor a browser, deliberately — that is what makes it fast enough to run constantly.

`npm run verify:full` is the CI-equivalent: everything `verify` does, then the integration suite against the local database, then the fixture catalogue seed, then Playwright. It is the same sequence CI runs, in the same order.

**STEP F runs `npm run verify`, and nothing that needs a database or a browser. [AMENDED 2026-09-16]** Integration and end-to-end belong to CI.

**This is the same move made twice, one step further.** On 2026-09-15 `verify:full` left this machine on the reasoning that _"`verify` alone cannot see a broken query, a broken RLS policy or a broken page"_ is **correct and now satisfied by CI rather than by this machine**. That argument does not weaken when the suite is targeted rather than complete — a targeted end-to-end run is the same browser, the same dev server and the same database on the same host.

**The reason is the maintainer's machine, and it is not a preference.** This is the computer they use for everything else, and Playwright makes it unusable while it runs. `architecture.md` §12 measured **eight cycles in which local end-to-end failures never once identified a real defect**; spending the machine on evidence CI produces anyway on a clean runner is a cost with no established benefit.

**What this gives up, stated rather than glossed.** A broken query or a broken page is now found by CI in roughly fifteen minutes rather than locally in two, and finding it there **reopens the cycle** under the rule below — which has happened once, in `cycle-log.md` §79, and was manageable. **That is the trade: slower feedback on a real defect, in exchange for a machine the maintainer can use.**

**Do not run integration or end-to-end locally unless the maintainer asks.** Not as a sanity check, not to chase a flake, and not to compare failure sets — a red CI run is the evidence for that, and `verify:full` is not to be run at all without being asked.

**A direct render probe is the cheap alternative and is usually better.** Starting the dev server and fetching a page with `curl` costs a fraction of a browser suite and has repeatedly produced stronger evidence than Playwright did — §76, §78 and §80 were each verified that way, and §80's two defects were found by it. **Prefer it, keep it to the pages actually changed, and stop the server afterwards.**

> **⚠️ `npm run test:integration` DELETES ALL CATALOGUE DATA.**
>
> The integration suite truncates `albums` and `artists` in `beforeEach` and again in `afterAll`. Running it against a seeded database destroys the catalogue — silently, and in seconds, where re-seeding takes minutes of rate-limited requests.
>
> **Never run catalogue seeding and the integration suite against the same database** without expecting to lose the data. Seed after testing, not before. This has already happened once mid-session.

**Always verify from a clean build.** `rm -rf .next && npm run verify`. This is a standing requirement, not a suggestion: `PageProps` and `LayoutProps` are generated into `.next/types`, so a stale directory can make typecheck pass locally while failing in CI. That exact discrepancy has already put a red commit on `main` once.

**Migrations deploy before the code that needs them. Merging is deploying. [AMENDED 2026-09-15 — this said "Pushing is deploying", which stopped being true when work moved to a branch.]**

Vercel deploys on push, but a migration only reaches the database when someone runs `npx supabase db push --linked`. Push first and the live app queries tables that do not exist. **This has happened twice** — §42 and §46 of `docs/current-state.md` — and the second took **every profile page down for every visitor**, found by opening the site rather than by any check that ran.

**CI cannot catch it, and a green run is not evidence.** CI applies migrations to a _fresh_ database and passes. `verify:full`, CI, and the deployed schema are **three separate things**.

The order is therefore: **CI green on the exact commit, then apply the migration and confirm it, then merge.** That is the gate at **STEP J**.

**This is stricter than the order it replaces, not looser.** Previously a migration was applied _before_ the push and therefore before anything had been verified. Now it is applied only once CI has passed the exact tree that needs it.

A `pre-push` hook still runs `scripts/check-migrations-deployed.mjs` (wired through `core.hooksPath=.githooks`), and `npm run db:pending` runs the same check by hand. **On a branch push that check will now report a pending migration, and that is expected rather than a failure to fix** — the migration is applied at STEP J, not before STEP I. It fails open when Supabase is unreachable, so **it reduces the risk rather than removing it**. `git push --no-verify` bypasses it deliberately.

### Where the full gate runs **[DECIDED 2026-09-15]**

**Work happens on a branch and reaches `main` only through a green CI run.** `ci.yml` already triggers on `pull_request`, and its two jobs carry no `needs:` between them, so the full suite runs in parallel on clean runners **before anything reaches `main`**.

**There is no branch protection**, and that is why this matters rather than why it cannot work. GitHub gates it behind a paid plan for private repositories, and paying or going public purely for that has been declined. **Branch protection would _enforce_ this; its absence does not prevent it.** The previous rule reasoned from that absence to _"`verify:full` before pushing is the actual safety net"_, and the step it skipped is that **a branch does not require protection to be useful.**

**What changed the answer was measurement, not preference.** Across eight cycles on 2026-09-13 the local end-to-end suite failed **9, 5, 2, 9, 7, 14, 19 and 6** times on eight different trees. **Every failing set passed on isolated rerun. CI was green on all eight. Not one was a real defect.** Host load rose 6.15 → 12.51 and runtime 10.5m → 25.3m. On one identical tree: **25.3 minutes locally against 11.2 on CI, with CI absorbing nothing** — zero retries, every test first attempt. The full record is `architecture.md` §12.

**This does not license ignoring a red run.** It moves the run somewhere red means something: **a red CI run blocks a merge.**

**The history that produced the rule this replaces is still worth carrying.** An earlier version named `verify` as the compensating control, which was wrong: `verify` does not run Playwright, so a commit that broke two end-to-end assertions passed the documented pre-push check and **left `main` red for three commits before anyone noticed.** Under the branch model that commit never reaches `main` at all — which is the outcome that rule was reaching for and could not deliver from this host.

### Conventions established in Phase 0

- **Every new table needs explicit `grant` statements** for `anon`, `authenticated` and `service_role`, alongside its RLS policies. Grants are evaluated _before_ RLS — without them you get `permission denied` no matter how permissive the policies are. This is easy to forget and the failure looks like an RLS bug.
- **Granting is not restricting. A table or function is not correctly provisioned until the privileges it should not offer have been explicitly revoked. [AMENDED 2026-09-04]** Postgres grants `EXECUTE` on a new function to `PUBLIC`, and Supabase's default privileges grant table privileges to `anon` and `authenticated`. An explicit `grant … to authenticated` therefore **adds** a grant and removes nothing, so a migration that names its intended audience restricts nobody. **This convention covers functions as well as tables**, which the bullet above does not mention at all. Measured on 2026-09-04, seven of eight project-authored functions were `anon`-executable against migrations that appeared to withhold it. See `docs/architecture.md` §16.5.
- **Migrations are the only way to change schema.** After changing one, run `npm run db:reset` then `npm run db:types`. Never hand-edit `database.types.ts`.
- **Embedding `releases` from `albums` must name the foreign key**: `releases!releases_album_id_fkey(...)`. There are two relationships between those tables — `releases.album_id` and `albums.representative_release_id` — so a bare `releases(...)` embed fails with "more than one relationship was found". The same applies to any future table with two paths to the same relation.
- **Expected failures return `Result`, not exceptions** (`src/services/result.ts`). A taken handle is an outcome the UI renders. Genuinely unexpected failures still throw.
- **Auth goes through `src/services/auth/`**, never directly to Supabase — auth is the most expensive thing here to migrate.
- **`globals.css` holds the project's semantic design-token system.** Two layers, and the separation is load-bearing: raw ramp primitives, and the semantic tokens components actually use. Re-palette the product by editing the semantic block rather than sweeping every file. The warm-neutral ground, the brass accent, the type scale and both container widths all live there, and every surface renders on them.

### Next.js 16 specifics

This version differs from older training data in ways that bite:

- **`middleware.ts` is now `proxy.ts`.** Ours lives at `src/proxy.ts` and only refreshes the session — never authorisation, since proxy runs on prefetches too.
- **Request APIs are async**: `cookies()`, `headers()`, `params`, `searchParams` must all be awaited.
- **`next lint` is removed**; ESLint runs directly and uses flat config.
- Turbopack is the default bundler.

Bundled docs live in `node_modules/next/dist/docs/` — read them before assuming an older API still applies.

---

## Development cycle

Every coherent feature change or product slice follows these steps, in this order, with these exact names. Do not rename, merge, skip or invent steps. At the end of each step, provide a concise summary of what was done, what was learned or decided, and whether the step is complete, blocked or ready for the next step.

### Which steps wait for the maintainer

**Every step still ends with its summary.** What follows governs only which of those summaries stop and wait for an answer.

**Gates — the cycle stops and does not proceed until the maintainer answers.**

| Step                           | Why it gates                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **00, A and B**                | Selection and product decisions. What gets built, and inside what boundary, is the maintainer's to settle, and **STEP B is the last point before a boundary hardens into documentation and code**                                                                                                                                                  |
| **J, always before the merge** | **Merging is deploying.** The merge is what puts code in front of users, and where the cycle carries a migration the migration is applied to the deployed database at this step — the one action in a cycle that no local command undoes. **[MOVED FROM STEP I 2026-09-15]**: a branch push deploys nothing, so there is nothing to gate at STEP I |

**Interrupts — the cycle stops because something happened, not because a step finished.** Raise immediately and wait:

- any step returning a conflict to an earlier step under the rule below;
- **STEP F** producing a red verification state **it cannot attribute away from this cycle's own change** — see below;
- **STEP G** returning anything other than `READY TO COMMIT`;
- anything meeting the urgent bar in **Product feedback** — data integrity, security, authentication, destructive behaviour, or a serious regression on a deployed environment.

**Everything else proceeds without asking.** C, D, E, F, G, H, J and K run through when nothing above applies, because they execute a boundary the maintainer has already approved at STEP B.

**This relaxes when the cycle stops, and nothing else.** Steps still may not be renamed, merged, skipped, reordered or collapsed, and each still produces its own report before the next begins — proceeding without asking is **not** permission to run two steps in one turn. The maintainer may re-gate any step at any time by saying so; the above is the default, not a constraint on them.

#### A red STEP F interrupts only when it cannot be attributed

**[NARROWED AGAIN 2026-09-16.]** With integration and end-to-end on CI, **STEP F is now format, lint, typecheck, unit tests and a build** — none of which flake. So a red STEP F is almost always a real defect, and the attribution machinery below applies chiefly to **a red CI run**, where it is unchanged and still the standard.

**This section narrowed on 2026-09-15 and did not go away.** STEP F now runs `npm run verify` plus targeted suites rather than the whole of `verify:full`, so it produces a red run far less often — but **when it does, the standard below is unchanged and is still the standard.** It also governs any `verify:full` run performed by choice.

**A red run is not by itself the interrupt.** End-to-end flakes under machine load are a known and documented condition — `current-state.md` §8 records seven of nine runs losing between one and seven tests that way — so stopping on every red run would fire the interrupt almost every cycle and make it worthless.

**STEP F proceeds only where it establishes attribution positively, and by measurement rather than assertion.** The established pattern, and the standard to meet:

- the changed code **provably cannot execute** in the failing tests, shown from the run's own output rather than reasoned about;
- those same tests **pass on an isolated rerun**, with nothing modified to make them do so;
- the **failure sets differ across runs on an identical tree**, which is the signature of non-determinism rather than of a defect.

**Where attribution cannot be established, stop and ask.** "It is probably the machine" is not attribution — it is the assumption that attribution exists to test, and it has already been wrong once: the `8.02 ratings` failure in `current-state.md` §8 looked exactly like a flake and was a deterministic failure caused by database residue from an aborted run.

**Proceeding is never reclassification.** A red run is recorded as red, a suite exiting non-zero is never reported as a pass, and the limitation travels into STEP G, the commit and the checkpoint.

**CI is still not the answer to a red local run, and the reason has changed. [AMENDED 2026-09-15]** This previously said CI _"runs **after** the push"_, which was the sharper half of the objection and stopped being true when the gate moved: CI now runs **before the merge**, so it gates rather than reports. **What survives is the other half**: `playwright.config.ts` sets `retries: 2` on CI against `0` locally, **so CI can absorb a flake a local run exposes.** The two remain different signals with different blind spots — which is why a green CI run is recorded with its flaky and retry counts, and why **zero flaky on a first attempt is the figure that makes it corroboration rather than an outvote.**

| Step   | Name                    | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **00** | Cycle Intake and Triage | Establish the actual starting state, reconcile the previous cycle including any gate still pending, triage relevant feedback and existing open work, and prepare a **neutral candidate field** for STEP A. **Never selects or recommends the next cycle**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **A**  | Discover / Reassess     | Rank candidate work from the current project state and any triaged product feedback, then investigate the leading candidate's behaviour, defects, dependencies, scope risks and unanswered questions. No code changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **B**  | Decide                  | Resolve the product, scope and tradeoff decisions the selected slice requires. No implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **C**  | Document                | Record those decisions, their rationale, evidence and boundaries in the authoritative documentation. No implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D**  | Plan / Review           | Produce the implementation and verification plan, then independently challenge its boundary, tests, risks and assumptions before coding. No implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **E**  | Implement               | Implement exactly the approved plan and nothing outside its boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **F**  | Verify                  | Run the required local verification and establish the actual test state of the implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **G**  | Review                  | Independently review the implementation against the approved decision, boundary, tests, evidence and repository state. **No modifications during review**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **H**  | Commit                  | Commit only the reviewed implementation, after STEP G returns **READY TO COMMIT**, **on a working branch rather than on `main`** — branch from current `main` at the start of the cycle. Keep unrelated work and other cycles' documentation out of the commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **I**  | Push                    | Push the branch and open a pull request. **A branch push is not a deploy, so this step no longer gates on migrations.** Record the branch, the commit SHA and the PR number. A push may be deliberately deferred, provided the local commit and repository state are recorded clearly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **J**  | CI and merge            | Establish the external CI state for the exact pushed SHA. **A merge requires a completed successful run on that SHA — `CI PENDING` is never a merge.** **There is no longer an exception. [2026-10-02]** `ci.yml` has no path filter, so **every change runs CI** and `CI SKIPPED` is unreachable — see the states table. **A pull request that touches even one code file runs normally and is never recorded this way**, however much documentation it also carries. Then, and only then: **apply any migration to the deployed database and confirm it**, then merge to `main`, which is the deploy. **The order is CI green → migration applied → merge**, because a migration for a branch that never merges is a schema change with no code to use it. **Never claim CI success without evidence of a completed successful run.** The cycle may still close with an unmerged branch, provided that state is recorded |
| **K**  | Checkpoint              | **Rewrite `docs/current-state.md` so it describes the present**, reconciled against the actual repository, remote and CI state — **it is not appended to**. **Append the cycle's checkpoint to `docs/cycle-log.md`** as `## §N — Title`, newest first, and **regenerate both files' Contents lists**. Record what the completed cycle changed, what was verified, what remains open and any evidence limitations. **A cycle whose CI has not finished may be closed _provisionally pending CI_ under the rules below — never described as fully verified.** **Then close with the plain-language summary below**                                                                                                                                                                                                                                                                                                           |

**When reporting progress, lead with the current step and the cycle name**, on two lines — `STEP D: Plan / Review` then `Cycle: Search reachability` — before anything else.

### STEP K always ends with a plain-language summary

**Every STEP K closes with a short, non-technical overview, written for the maintainer reading it cold.** It comes after the checkpoint reconciliation, not instead of it, and it is separate from the CYCLE HANDOFF below — the handoff carries state for the next session, this explains the cycle to a person.

Three parts, kept brief:

| Part                   | Contents                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What was done**      | The change in ordinary language. No SHAs, no step names, no internal jargon. What was wrong, what was done about it, and what is true now                                                                                                   |
| **How to check it**    | Concretely how the maintainer can see it for themselves — a URL to open, a command to run, a page to look at. If something genuinely cannot be checked without an account, a write or a session, **say so plainly** rather than omitting it |
| **What is still open** | Anything unresolved, split into what the cycle deliberately left, what it found and did not fix, and what pre-existing issues it touched or newly exposed                                                                                   |

**Two rules that make it worth reading.** Never quietly drop an unverified item to make the summary tidier — an honest "this could not be checked, and here is why" is the point. And **name anything the cycle newly exposed even when it was not the cycle's subject**, because a cycle that surfaces a problem it was not looking for is exactly when that problem is most likely to be lost.

**Do not collapse Decide, Document, Plan / Review, Implement, Verify and Review into one turn merely because the implementation looks straightforward.** The separation exists for two reasons: it stops implementation assumptions becoming product decisions by default, and it provides an independent review before anything is committed. A slice that seems obvious is exactly the one where an unexamined assumption travels furthest.

### A step returns a conflict it cannot honestly resolve

**When a step finds that the boundary it was given cannot be honestly satisfied, it names the exact conflict and returns it to the step that owns the decision.** It does not widen scope to make the work fit, does not resolve the conflict by taking the obvious default, and does not proceed while noting a reservation in passing.

**This is the process working, not failing.** A later step routinely holds information the deciding step did not: STEP B decides against the documentation, STEP D inspects the actual code, STEP F runs what it can and CI runs the rest. A boundary that was sound when it was set can be shown impossible two steps later, and surfacing that is the whole reason the steps are separate.

| What was discovered                                                          | Returns to |
| ---------------------------------------------------------------------------- | ---------- |
| The product, scope or tradeoff decision cannot hold as approved              | **STEP B** |
| The decision holds, but the documentation records it wrongly or incompletely | **STEP C** |
| The decision holds, but the plan cannot deliver it within the boundary       | **STEP D** |

**A return is not `BLOCKED`.** `BLOCKED` means a required gate cannot be satisfied and the cycle does not proceed. A return re-enters the cycle at an earlier step carrying new evidence, and the cycle continues from there.

**A return is not a rewind.** Per **Historical integrity** below, the earlier decision is not edited away to match the new one. The new evidence and the revised decision are recorded separately, and the superseded decision is marked at the point of change — so the record shows that the boundary moved, when, and on what evidence.

**The failure this prevents is already named for open questions, and is generalised here to boundaries.** `product-spec.md` §10 holds that answering an open question silently — by taking the obvious default, by following the reference product, or by reasoning from the rest of the spec — is a scope violation rather than a judgement call. The same is true of a boundary conflict discovered mid-cycle.

**Worked example, hypothetical.** STEP B approves a feature inside an explicit no-migration boundary, with a guarantee of _at most once per subject_. STEP D finds that no table carries the state that guarantee needs, and that the only mechanism available infers it from rows another concern owns and may remove. What the code can deliver is therefore _at most once, unless those rows are cleaned_ — narrower than what was approved.

**The correct action is to state that gap precisely and return it to STEP B.** What is not correct is inventing a migration inside a no-migration boundary, or shipping the approximation and mentioning it in passing.

**Returning is not a verdict that the work is wrong.** STEP B may ratify the narrower guarantee deliberately, having seen it stated; it may widen the boundary; or it may change the approach. **All three are valid outcomes**, and the point of the return is that the choice is made rather than defaulted into.

**Examples in this document are hypothetical, or drawn from closed cycles. They never describe work in flight** — a governing document that names an open cycle stops being a rule and becomes a verdict on it, and a later step will read it as one.

### Naming a feedback item, in STEP 00 and STEP A **[ADDED 2026-09-16, at the maintainer's instruction]**

**Never refer to a feedback item by its ID alone.** `F-019` means nothing to a reader who does not have `docs/product-feedback.md` open, and both of these steps exist to be read by the maintainer rather than by the agent that wrote them.

**Every mention carries a short plain description the first time it appears in a report** — the ID, then a few ordinary words for what it actually is. `F-019, MusicBrainz aliases — alternate artist spellings that would make search forgiving of typos` rather than `F-019`. Afterwards in the same report the ID alone is fine.

**Keep the description plain.** It says what the thing is in ordinary language, not what the entry argues, how it would be built, or which sections govern it. One clause is usually enough and a sentence is the ceiling.

**This applies to the candidate field in STEP 00 and to the ranking, investigation and recommendation in STEP A** — the two places where a list of bare IDs is otherwise most likely to appear. It is a reporting rule and changes neither step's responsibilities.

### Choosing the next slice

STEP A owns **discovery, ranking and recommendation of the next slice**, not the final product decision.

At the beginning of STEP A: take STEP 00's candidate field as input **without inheriting its ordering, grouping or emphasis as a recommendation**, review the current project state and any **triaged** product feedback, identify the possible next pieces of work, weigh their dependencies, risks and evidence, rank them, and recommend the strongest candidate with the reason it should be next. Rank on user impact, correctness risk, dependencies, product readiness, technical leverage and unresolved decisions. **STEP B then decides** whether that candidate and its scope are accepted, or picks another.

**Raw feedback is not cycle scope.** An observation becomes a candidate only after deliberate triage, and a candidate becomes scope only at STEP B.

**There is no separate _slice-selection_ step. [CORRECTED 2026-09-04]** Slice selection is the first responsibility of STEP A, and no step may be invented to take it over.

**STEP 00 is not that step, and it is not an exception to this rule.** This line previously read _"Do not create a separate 'slice selection' or 'pre-development' step"_, which contradicted STEP 00 once STEP 00 became part of the workflow. The substance is unchanged and the wording is corrected: **STEP 00 establishes state and prepares a neutral candidate field; it never selects or recommends a slice.** The moment a step ranks candidates or names a recommendation, it is doing STEP A's job.

### Product feedback

`docs/product-feedback.md` is the persistent, **non-authoritative** inbox for observations from manual testing and ordinary product use — bugs, UX observations, feature ideas, questions, design thoughts and larger future ideas, captured raw. The path from an observation to code is deliberate and has no shortcut:

**manual testing / brain dump → `docs/product-feedback.md` → deliberate triage → STEP A ranks it against the other candidates → STEP B decides → A–K cycle**

- **Raw feedback is an observation, not an implementation instruction.** Nothing is built from that file directly.
- **Capturing feedback never interrupts the active cycle** and never changes its approved boundary. Do not silently add feedback to the cycle in flight.
- **Triage is a separate, deliberate pass**, run when the maintainer asks for it. It classifies and recommends; it does not decide.
- **The file has no authority over the authoritative documents.** Decisions belong in the document that owns them; implementation belongs in an A–K cycle.
- **Feedback found after STEP D normally waits for a later cycle** — by then the boundary is closed to new input.
- **One exception, raised out loud rather than filed quietly**: suspected data integrity, security, authentication, destructive behaviour or a serious production regression. Flag it immediately; **the decision to interrupt the current cycle is the maintainer's**, and the current cycle's commit, verification and CI state is recorded before anything is set down.

**In the dedicated product-feedback session, ordinary product observations are entries, not requests.** Record them in `docs/product-feedback.md` rather than treating them as work to implement.

### CI and cycle continuity

**CI is a verification mechanism, not necessarily a development blocker.**

When a cycle has reached STEP H and the implementation commit has passed the required local verification, the next development cycle may begin **without waiting for a long CI run**, provided:

- the implementation commit is complete and identified;
- the working tree is clean apart from explicitly pre-existing or intentionally deferred files;
- the exact commits that are pushed or still local are recorded;
- no new cycle silently modifies, amends, rebases or depends on an unverified implementation;
- CI results from the previous cycle remain explicitly marked as **pending** until STEP J completes;
- STEP K is completed or explicitly deferred only with the outstanding CI state clearly recorded.

**Under the branch model a cycle may also close with its branch unmerged**, and that is a legitimate outcome rather than an unfinished one — provided the branch, the SHA, the CI state and the fact that it is unmerged are all recorded. **An unmerged branch has deployed nothing**, so it blocks nothing; what it must never do is go unrecorded. **[2026-09-15]**

**For documentation-only changes, do not trigger a separate CI wait merely to validate documentation.** Documentation may be committed locally and pushed together with the next implementation push when appropriate.

**When multiple local commits are waiting to be pushed, preserve their separation and review history.** Do not squash, amend or combine them merely to reduce CI runs unless explicitly approved.

A new implementation cycle may therefore begin while the previous cycle's CI is pending, but its starting state must identify the pending commit(s), the expected CI target SHA and any unresolved verification state.

**Once STEP J has verified CI for a pushed commit, that verified state is the next cycle's starting point.** Do not rerun CI merely to re-establish the previous cycle's baseline, and do not wait on the previous cycle's checkpoint before beginning STEP 00 — the CYCLE HANDOFF carries the state a new session needs. CI takes roughly 13 minutes; nothing is gained by spending it twice on the same tree.

**A green run verifies only the commit it ran on.** It establishes the completed previous cycle's state and says nothing about a new cycle's changes, which run their own A–K verification.

#### The CI gate is asynchronous, and PENDING is never PASS

**STEP J and STEP K stay conceptually distinct and are not merged.** STEP J establishes what the external CI evidence says; STEP K decides the cycle's closeout state from the complete evidence available at that moment. The only thing that is asynchronous is the CI gate itself.

**Six states, and they are not interchangeable:**

| State            | Meaning                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`VERIFIED`**   | The implementation passed its required local verification and independent review — STEP F and STEP G. **Says nothing about CI**                                                                                                                                                |
| **`CI PENDING`** | A run exists for the exact pushed SHA and has not reached a terminal state. **This is not a pass and must never be recorded as one**                                                                                                                                           |
| **`CI PASSED`**  | A **completed successful** run on the exact pushed SHA, with the run number and totals recorded as evidence                                                                                                                                                                    |
| **`CI SKIPPED`** | **Historical. No longer reachable.** It meant _no run exists because a path filter excluded every changed file_; `ci.yml` has no path filter since 2026-10-02, so **every change now runs CI** and this state cannot arise. Kept so §115, §116 and §117's records stay legible |
| **`CI FAILED`**  | A completed run that did not succeed                                                                                                                                                                                                                                           |
| **`BLOCKED`**    | A required gate cannot be satisfied, so the cycle does not proceed                                                                                                                                                                                                             |

**STEP J with CI still running.** Record `CI PENDING` with the run number and the exact SHA it is testing, and hand off. **Do not wait purely so the cycle can continue** — waiting is warranted only when the CI result changes what happens next. If no run exists, or a run was cancelled or is incapable of producing a result, that is what STEP J records instead.

**STEP J with no run at all. [SUPERSEDED 2026-10-02 — kept because three checkpoints cite it.]** `ci.yml` carried a `paths-ignore` filter for `docs/**` and markdown, so a documentation-only change fired no run and **`CI SKIPPED` was the record.** **The filter is gone and the state is unreachable**: the repository went public, Actions minutes are unmetered, and **a skipped workflow leaves its required checks pending, which blocks a protected branch from merging at all.** Every change now runs CI. `architecture.md` §12.7.

**The trap is a change that is mostly documentation.** One code file among twenty markdown files is a code change, CI runs on it, and `CI PASSED` is the only state that merges it. **Establish which happened from the absence or presence of a run, never from how the diff looks** — `gh run list` for the SHA answers it and an impression does not. **Never use `CI SKIPPED` to merge past a run that exists**, including one that failed to start.

**STEP K with CI still pending.** The cycle may be closed **provisionally pending CI**, provided all of the following hold:

- the implementation has passed the required verification and review gates;
- the pending CI state is explicitly recorded, naming the exact commit SHA awaiting it;
- no known blocker requires the CI result before the next cycle starts;
- **the cycle is not described as fully verified anywhere** — not in the checkpoint, not in the handoff, not in the plain-language summary.

**Resolving the gate afterwards.** If the pending run **passes**, the gate clears and the cycle becomes fully verified and closed; record that it cleared and nothing else needs reopening. If it **fails**, the cycle is **reopened for investigation and remediation under the normal workflow**, and the failure is assessed **before any new work that could conflict with it or obscure it**.

**The next cycle's intake carries it.** A pending CI result does not by itself prevent the next cycle from beginning. **STEP 00 must identify any previous-cycle gate still pending and carry it as an unresolved state rather than ignoring it silently**. Where the pending run has since passed, STEP 00 records that the gate cleared and does not otherwise revisit the closed cycle.

### Cycle scope

**The full cycle is not required for every tiny bug fix** — use judgment based on scope. However, any **feature, schema change, migration, auth-adjacent change or product decision** goes through all of A–K unless explicitly directed otherwise.

**Do not use the cycle process to manufacture work.** If STEP A establishes that an existing finding is not worth fixing, closing or deferring it with evidence is a valid outcome.

### Historical integrity

**Preserve historical cycle records accurately.** Do not rewrite an earlier decision merely because later evidence changed the conclusion. Mark superseded or refuted decisions explicitly and record the new evidence and decision separately.

**Do not claim that a later green CI run proves an earlier commit was independently tested when both commits were included in a single push.** Distinguish direct verification from transitive coverage.

### CYCLE HANDOFF

Every cycle ends with a **CYCLE HANDOFF**, written for the maintainer rather than for a developer. It must be understandable without reading the STEP A–K reports.

Use exactly these five headings:

| Heading               | Contents                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **What changed**      | The concrete product, code, schema or documentation changes completed in the cycle                                                  |
| **Why**               | The problem addressed, the decision made and the key rationale                                                                      |
| **Evidence**          | The important verification results, including tests, CI, measurements and any evidence limitations                                  |
| **What remains open** | Unresolved defects, decisions, risks, follow-ups and intentionally deferred work                                                    |
| **Next cycle**        | The recommended next slice or investigation, with a concise reason. If CI or checkpoint work remains pending, state that explicitly |

**It must carry enough state for a new session to begin STEP 00 immediately, and STEP A directly after it** — without waiting for another CI run and without reconstructing the repository state from the previous session:

- under **Evidence** — the implementation commit SHA; the CI run number, the exact SHA it verified, its conclusion and the relevant test totals; any retries, flakes or failures; and the local `HEAD` / `origin/main` relationship;
- under **What remains open** — known uncommitted files and which cycle each belongs to, documentation intentionally left uncommitted, and outstanding findings and evidence limitations;
- under **Next cycle** — the recommended candidate if one is already identified, plus any already-settled decisions relevant to it.

State, not narrative. The detail lives in `docs/current-state.md`; the handoff points at it.

---

## Working agreement

**Surface material decisions before acting on them.** Anything affecting product, UX, data model, architecture, security, privacy, or external services gets presented — decision, why it matters, options, recommendation, tradeoffs, consequences, reversibility — and waits for an answer. A permission prompt is not approval of the underlying decision.

Low-risk editorial choices (file names, structure, wording, formatting) don't need approval. If unsure whether something is material, treat it as material.

**Use plan mode** before any non-trivial change, and always for schema changes and auth-adjacent work.

**Where domain logic lives.** **[DECIDED 2026-08-23]** The test is: **if a native client would need this rule to behave correctly, it belongs in `src/services/`. If it only shapes what the web renders, it does not.**

This extends the non-negotiable above it — that rule polices _data access_, this one polices _domain logic_, and they are not the same thing. It exists because a second client is plausible (`architecture.md` §19.3) and because the boundary has already drifted in both directions: `shouldOfferFallback` encodes a product rule in `src/app/search/`, while `collectionPath` builds a web URL inside `src/services/`.

**Neither is a defect and neither is to be refactored.** This is a test for new work, not a cleanup task.

Items marked **[OPEN]** in the docs are unresolved by design — raise them, don't resolve them silently. Items marked **[VERIFY]** in `docs/architecture.md` §18 must be checked against current documentation before the code that depends on them is written.

**No Claude Code infrastructure** — agents, skills, hooks, MCP servers, worktrees — until there's a demonstrated need. See `docs/claude-code-environment.md`.

**Never put content in a fenced code block in a chat response.** Ordinary markdown is fine and wanted — headings, bold, italics and lists all copy normally. The problem is specifically the code snippet box: on mobile it renders as its own separately selectable region, so a reply containing one cannot be captured with a single select-all and has to be copied in pieces.

**This is a copy-paste requirement, not a style preference.** Replies are routinely copied out of a session into other files, frequently on a phone, and a fence in the middle of a reply forces the copy to be gathered section by section.

It applies to **everything that would otherwise be fenced** — shell commands, code, migrations, and drafted text intended for another session. Write them as ordinary text in the flow of the reply, indented or quoted if they need setting apart. **Inline code with single backticks is fine**, since it does not create a separate block. This governs chat responses only; files in `docs/` keep their existing formatting.
