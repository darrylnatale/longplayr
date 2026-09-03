# longplayr

A social music platform: users record the albums they've listened to, rate and review them, build lists, follow each other, and discover music through that activity.

**Current state: Phase 2 complete to its definition of done. Phase 3 is feature-complete — all five slices are built, pushed and CI-verified: 1 Follows, 2 Activity writes, 3 the following feed, 4 review likes, 5 Notifications. The last CI-verified commit is `fffbc46` (run #78).** See `docs/current-state.md` for exactly where things stand and what to do next. `docs/development-plan.md` defines what belongs to which phase — do not build ahead of the current phase without saying so.

---

## Non-negotiable rules

These are decided. Do not change them without raising the decision explicitly first.

- **One collection entry per user per album, permanently.** longplayr is a collection, not a dated diary. An album appears in a collection exactly once no matter how many times it's played.
- **Profiles never display dates.** Timestamps exist in the data and drive sort order and feed eligibility. They are not rendered on profiles or collections.
- **Feed events record interactions, not history.** An event is generated when a user acts, at the moment they act — that is the whole invariant. **A user-supplied `listened_on` never decides it**: an album added by hand is an interaction whether the listen was last night or in 1997. **Historical and backfilled collection data must never generate events** — a collection arriving in bulk is history being recorded, not hundreds of interactions, and treating it as the latter floods every follower's feed and cannot be undone. Adding to Want to Listen is an interaction and does generate an event. This sentence is the rule, **not the list of event types**; `docs/product-spec.md` and the owning phase define those, and the list grows.
- **Singles are outside the current catalogue boundary, and that boundary is not permanent.** **[AMENDED 2026-08-23]** Catalogue scope today is albums, EPs and mixtapes — including live albums, compilations and soundtracks. Still enforced at ingest, not at query time, and **no code changed with this amendment**. This line previously read _"Singles are never ingested"_, and the permanence was wrong: completionism does not exclude material by release type as a matter of principle, and a singles-only artist is presently unreachable by **every** route including self-service — a known, temporary exception to the breadth rule below. **The eventual treatment of singles is undecided and must be asked**, in particular whether a single becomes a catalogue release, a discovery object, or is represented only through the unique recordings it contains, such as a standalone track or a B-side that appears nowhere else. See `docs/product-spec.md` §8.9.
- **The catalogue is open-ended in breadth and completion-oriented in depth. Membership never depends on popularity.** **[DECIDED 2026-08-23]** There is no fixed universe of artists and no artist is permanently outside the catalogue. Once an artist is included, the goal is eventual completion of their in-scope body of work rather than a popularity-based sample, so **there is no permanent per-artist cap** — and a larger arbitrary cap is not the mechanism. Popularity is a **separate signal from membership**, and the absence of an external popularity signal says nothing about an album's merit. **The initial boundary is deliberately narrower than the principle** — albums, EPs and mixtapes, a curated starting set, and a temporary cap of 2 on the cold-start popularity seed — and that boundary must never be read as the model. See `docs/product-spec.md` §8.9.
- **The catalogue is read-only downstream of MusicBrainz.** No user-authored metadata, ever.
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
| `docs/claude-code-playbook.md` | How to work in this repo with Claude Code                                    |
| `docs/product-feedback.md`     | **No authority.** Raw product-feedback inbox — observations, never decisions |

`docs/current-state.md` is the lowest authority and goes stale fastest — it describes progress, never decisions. Anything it says that contradicts this file or the specs is wrong.

`docs/product-feedback.md` sits **outside** the authority order rather than at the bottom of it. It holds unevaluated observations from using the product and never overrides, amends or reopens anything above it — see [Product feedback](#product-feedback).

`transcript.md` and the three `claude-*` docs are reference material. Do not modify them.

---

## Working in this repo

```bash
npm run db:start && npm run db:env   # local Supabase (Docker), then write .env.local
npm run dev                          # http://localhost:3000
npm run verify                       # fast loop — no database, no browser
npm run verify:full                  # what CI runs — use before commit and push
```

**Two levels of verification, and the difference matters.**

`npm run verify` is the fast development loop: format, lint, typecheck, unit and component tests, and a production build. It touches neither a database nor a browser, deliberately — that is what makes it fast enough to run constantly.

`npm run verify:full` is the CI-equivalent: everything `verify` does, then the integration suite against the local database, then the fixture catalogue seed, then Playwright. It is the same sequence CI runs, in the same order.

**Substantive changes go through `verify:full` before commit and push.** `verify` alone is not sufficient evidence that a change is safe to land — it cannot see a broken query, a broken RLS policy or a broken page. Both suites can also still be run on their own: `npm run test:integration`, `npm run test:e2e`.

> **⚠️ `npm run test:integration` DELETES ALL CATALOGUE DATA.**
>
> The integration suite truncates `albums` and `artists` in `beforeEach` and again in `afterAll`. Running it against a seeded database destroys the catalogue — silently, and in seconds, where re-seeding takes minutes of rate-limited requests.
>
> **Never run catalogue seeding and the integration suite against the same database** without expecting to lose the data. Seed after testing, not before. This has already happened once mid-session.

**Always verify from a clean build.** `rm -rf .next && npm run verify`. This is a standing requirement, not a suggestion: `PageProps` and `LayoutProps` are generated into `.next/types`, so a stale directory can make typecheck pass locally while failing in CI. That exact discrepancy has already put a red commit on `main` once.

**There is no branch protection.** GitHub gates it behind a paid plan for private repositories, and paying or going public purely for that has been declined. Nothing mechanically prevents a red commit landing on `main`, so **`rm -rf .next && npm run verify:full` before pushing is the actual safety net.** Treat it accordingly.

This was learned the expensive way. The rule here previously named `verify` as the compensating control, which was wrong: `verify` does not run Playwright, so a commit that broke two end-to-end assertions passed the documented pre-push check and left `main` red for three commits before anyone noticed.

### Conventions established in Phase 0

- **Every new table needs explicit `grant` statements** for `anon`, `authenticated` and `service_role`, alongside its RLS policies. Grants are evaluated _before_ RLS — without them you get `permission denied` no matter how permissive the policies are. This is easy to forget and the failure looks like an RLS bug.
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

Every coherent feature change or product slice follows these steps, in this order, with these exact names. Do not rename, merge, skip or invent steps. At the end of each step, provide a concise summary of what was done, what was learned or decided, and whether the step is complete, blocked or ready for the next step. Do not proceed to the next step without asking the user.

| Step  | Name                | Responsibility                                                                                                                                                                                                                                      |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Discover / Reassess | Rank candidate work from the current project state and any triaged product feedback, then investigate the leading candidate's behaviour, defects, dependencies, scope risks and unanswered questions. No code changes                               |
| **B** | Decide              | Resolve the product, scope and tradeoff decisions the selected slice requires. No implementation                                                                                                                                                    |
| **C** | Document            | Record those decisions, their rationale, evidence and boundaries in the authoritative documentation. No implementation                                                                                                                              |
| **D** | Plan / Review       | Produce the implementation and verification plan, then independently challenge its boundary, tests, risks and assumptions before coding. No implementation                                                                                          |
| **E** | Implement           | Implement exactly the approved plan and nothing outside its boundary                                                                                                                                                                                |
| **F** | Verify              | Run the required local verification and establish the actual test state of the implementation                                                                                                                                                       |
| **G** | Review              | Independently review the implementation against the approved decision, boundary, tests, evidence and repository state. **No modifications during review**                                                                                           |
| **H** | Commit              | Commit only the reviewed implementation, after STEP G returns **READY TO COMMIT**. Keep unrelated work and other cycles' documentation out of the commit                                                                                            |
| **I** | Push                | Push only the reviewed commit. A push may be deliberately deferred, provided the local commit and repository state are recorded clearly                                                                                                             |
| **J** | CI                  | Verify CI against the exact pushed SHA to a terminal state where possible. **Never claim CI success without evidence of a completed successful run**                                                                                                |
| **K** | Checkpoint          | Reconcile `docs/current-state.md` with the actual repository, remote and CI state. Record what the completed cycle changed, what was verified, what remains open and any evidence limitations. **Then close with the plain-language summary below** |

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

### Choosing the next slice

STEP A owns **discovery, ranking and recommendation of the next slice**, not the final product decision.

At the beginning of STEP A: review the current project state and any **triaged** product feedback, identify the possible next pieces of work, weigh their dependencies, risks and evidence, rank them, and recommend the strongest candidate with the reason it should be next. Rank on user impact, correctness risk, dependencies, product readiness, technical leverage and unresolved decisions. **STEP B then decides** whether that candidate and its scope are accepted, or picks another.

**Raw feedback is not cycle scope.** An observation becomes a candidate only after deliberate triage, and a candidate becomes scope only at STEP B.

**Do not create a separate "slice selection" or "pre-development" step.** Slice selection is the first responsibility of STEP A.

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

**For documentation-only changes, do not trigger a separate CI wait merely to validate documentation.** Documentation may be committed locally and pushed together with the next implementation push when appropriate.

**When multiple local commits are waiting to be pushed, preserve their separation and review history.** Do not squash, amend or combine them merely to reduce CI runs unless explicitly approved.

A new implementation cycle may therefore begin while the previous cycle's CI is pending, but its starting state must identify the pending commit(s), the expected CI target SHA and any unresolved verification state.

**Once STEP J has verified CI for a pushed commit, that verified state is the next cycle's starting point.** Do not rerun CI merely to re-establish the previous cycle's baseline, and do not wait on the previous cycle's checkpoint before beginning STEP A — the CYCLE HANDOFF carries the state a new session needs. CI takes roughly 13 minutes; nothing is gained by spending it twice on the same tree.

**A green run verifies only the commit it ran on.** It establishes the completed previous cycle's state and says nothing about a new cycle's changes, which run their own A–K verification.

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

**It must carry enough state for a new session to begin STEP A immediately** — without waiting for another CI run and without reconstructing the repository state from the previous session:

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
