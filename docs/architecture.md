# longplayr — Architecture

Simplest architecture that supports the product properly and can evolve. Every major decision below records the alternatives considered and why the selected approach fits **this** product at **this** stage.

Guiding constraint: **do not optimise for millions of users.** Optimise for correctness, for a small team's velocity, and for keeping the expensive-to-reverse decisions reversible.

Notation: **[DECIDED]** = explicitly chosen. **[INFERRED]** = follows necessarily; flagged for correction. **[VERIFY]** = must be confirmed before implementation.

---

## 1. System shape

```
                    ┌─────────────────────────┐
   Browser ────────▶│  Next.js (App Router)   │
                    │  Vercel                 │
                    │  ├─ pages / RSC         │
                    │  ├─ route handlers      │
                    │  └─ cron endpoint       │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  Supabase    │  │  Supabase    │  │  Supabase    │
      │  Postgres    │  │  Auth        │  │  Storage     │
      │              │  │              │  │  (artwork)   │
      └──────────────┘  └──────────────┘  └──────────────┘
              │
              │  ingestion (rate-limited)
              ▼
      ┌───────────────────────────────────────────────┐
      │  MusicBrainz   — catalogue truth              │
      │  Cover Art Archive  — artwork (by MBID)       │
      │  ListenBrainz  — popularity signal            │
      └───────────────────────────────────────────────┘
```

Two vendors: **Vercel** for the application, **Supabase** for data, identity and files. Three read-only upstream data sources, none of which the product depends on at request time once data is cached.

---

## 2. Frontend

**Decision: Next.js App Router, React Server Components by default.** **[DECIDED]**

_Alternatives considered._ SvelteKit and Remix are both strong and arguably more pleasant to write. Astro would suit the content-heavy album/artist pages well but fights the interactive, personalised parts.

_Why Next.js._ The product is a mix of largely-static catalogue pages and highly personal, interactive surfaces. Server Components handle that split well — album metadata renders on the server with no client JavaScript, while collection controls hydrate as islands. It also has the deepest ecosystem for the specific things we need (auth integration, image optimisation, incremental adoption of caching), and Vercel deployment is a non-decision.

_Risk._ Next.js caching semantics have changed substantially across recent versions and are genuinely easy to get wrong. Caching behaviour must be explicit and tested, not assumed — see §9.

### Rendering strategy per surface

| Surface              | Approach                                                                      | Why                                                          |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Album page           | Server-rendered, catalogue portion cached; personal state and reviews dynamic | Catalogue data changes rarely; your entry changes constantly |
| Artist page          | Same split                                                                    | Discography is stable                                        |
| Discovery            | Server-rendered, revalidated on a schedule                                    | "This week" doesn't need to be second-accurate               |
| Feed                 | Fully dynamic, per-user                                                       | Personal by definition, uncacheable                          |
| Profile / collection | Dynamic, paginated                                                            | Large grids need pagination, not caching                     |
| Search               | Dynamic                                                                       | Query-dependent                                              |

---

## 3. Backend

**Decision: colocated in the Next.js app** — Server Actions for mutations, route handlers for anything needing a URL (webhooks, cron, export). **[DECIDED]**

_Alternatives considered._ A separate API service (NestJS, Fastify, Hono) would give a clean contract and independent scaling, and would be necessary if native mobile apps were planned.

_Why colocated._ There is exactly one client — the web app. A separate API means a second deploy target, a second set of secrets, network hops on every read, and a hand-maintained contract, all to serve a consumer that lives in the same repository. The cost is real and the benefit is currently zero.

_When to revisit._ If native apps are built, or if a public API is offered. Extraction is a genuine refactor but not a rewrite, provided data access stays behind a service layer (§4) rather than being scattered through components.

---

## 4. Code organisation

**Decision: a service layer between UI and database.** No SQL or Supabase client calls inside React components. **[INFERRED]**

This is the single cheapest insurance policy in the architecture. It is what makes several otherwise-expensive future changes tractable:

- Swapping Postgres full-text search for a dedicated engine touches one module.
- Replacing the ListenBrainz popularity source with internally-computed popularity touches one module.
- Extracting a standalone API later becomes a transport change, not a rewrite.

Roughly: `catalogue` (albums, artists, ingestion), `collection` (entries, relistens, reviews, favourites, want-to-listen), `social` (follows, blocks, feed, likes), `lists`, `discovery` (popularity, charts), `search`, `moderation`.

**Some invariants live in one function rather than in the schema, and those functions are mandatory.** The first is `ensure_collection_entry`: it is the only sanctioned way a collection entry comes to exist, because the Want to Listen clearing rule is a property of that path rather than of the tables. Writing to `collection_entries` directly produces a legal-looking row in a wrong state. Migrations and tests are exempt; nothing else is. See `docs/data-model.md`, "The single mutation path".

---

## 5. Database

**Decision: Supabase Postgres.** **[DECIDED — E1]**

_Alternatives considered._ Neon offers per-branch databases, which is a genuinely better testing story and was the strongest argument against Supabase. Vercel Postgres is Neon underneath. Self-hosted Postgres was never seriously in scope.

_Why Supabase._ It supplies Postgres, authentication **and** object storage — three requirements from one vendor, in a project that also needs artwork hosting. Consolidation is the stated principle, and the alternative was four services wired together. The underlying database is standard Postgres, so **the data is portable even though the auth is not**.

_Accepted tradeoff._ We give up Neon's per-PR database branching. §11 mitigates with a shared staging environment.

**Row Level Security: not used as the primary authorisation mechanism.** **[INFERRED]** All access goes through the server-side service layer, which enforces authorisation in application code. RLS may be enabled as defence-in-depth, but a product where nearly everything is public gains little from it, and RLS misconfiguration is a well-known source of subtle data-exposure bugs. Authorisation logic should be readable and unit-testable.

---

## 6. Authentication

**Decision: Supabase Auth — email/password plus Google OAuth.** **[DECIDED — E1]**

_Alternatives considered._ Auth.js (flexible, no lock-in, more surface to own); Clerk (best DX, per-MAU pricing); hand-rolled (rejected outright — the one area where a subtle mistake is a genuine security incident).

_Why Supabase Auth._ It's already present, it handles password hashing, session management, email verification and OAuth, and it removes the highest-risk code we would otherwise write ourselves.

_Risk, stated plainly._ **This is the most expensive decision in the project to reverse.** Migrating identity providers after launch means moving real user accounts, and it cannot be done transparently. The mitigation is that our `User` table holds the profile and is keyed to the provider's identifier, so application data survives a provider change even though credentials wouldn't.

---

## 7. Catalogue and ingestion

### Sources

| Purpose        | Source                | Notes                                                            |
| -------------- | --------------------- | ---------------------------------------------------------------- |
| Metadata truth | **MusicBrainz**       | Release groups, releases, artists, credits                       |
| Artwork        | **Cover Art Archive** | `/release-group/{mbid}/front-{250,500,1200}`. No rate limit      |
| Popularity     | **ListenBrainz**      | `/1/stats/sitewide/release-groups`. Public, MBID-native, no auth |

### Artwork: one source, no fallback **[DECIDED — verified]**

Both candidate fallbacks were rejected on verification:

- **iTunes Search API** — terms permit album art _"only to promote store content and not for entertainment purposes"_ and require assets be _"proximate to a store badge."_ Album art as the visual backbone of a collection grid is neither. Its ~20 requests/minute limit would also have become the binding constraint on catalogue growth, three times tighter than MusicBrainz.
- **Deezer API** — their developer FAQ states plainly that _"images are not allowed to be stored for legal reasons,"_ which is incompatible with our decision to fetch and store rather than hotlink.

So artwork comes from Cover Art Archive alone. This is a better fit than it first appears:

- **Keyed by MBID**, so a cover can never be attached to the wrong album. Both rejected options relied on fuzzy name matching, which produces exactly that class of bug.
- **No rate limit**, unlike every alternative.
- Release-group endpoints match our Album entity directly, needing no extra lookup.

The cost is coverage gaps on obscure releases. Rather than guess at the size of that gap, **ingestion records whether artwork was found**, so coverage is a number we can query after seeding and revisit with evidence. The placeholder is a real design deliverable, not a grey box.

### Rate limiting

MusicBrainz allows **one request per second per IP**, averaged. Exceeding it returns `503` for _all_ requests from that address until the rate drops — not just the excess. A `User-Agent` identifying the application and carrying contact details is mandatory:

```
longplayr/<version> ( <contact-url> )
```

Cover Art Archive imposes no rate limit, so artwork fetching does not compete with metadata for the same budget.

### Ingestion paths

**Decision: inline fast path plus a Postgres-backed job queue.** **[DECIDED — E4]**

```
  User adds a specific album
    └─▶ fetch inline (~1 request, ~1s) ─▶ upsert ─▶ done
        the user-facing path never waits on a queue

  Bulk work: seeding, artwork, editions, re-sync
    └─▶ INSERT into jobs table
        └─▶ cron endpoint drains at a safe rate
```

_Alternatives considered._ A managed job platform (Inngest, Trigger.dev) gives retries, backoff and observability as first-class features — genuinely better tooling, at the cost of another vendor. A dedicated always-on worker (Railway, Fly) removes timeout ceilings entirely, at the cost of a second deploy target.

_Why this approach._ It introduces no new vendor, and it correctly separates the two workloads: a user waiting for one album should not sit behind a queue, while bulk enrichment has no latency requirement at all. The jobs table needs status, attempt count, and backoff columns — modest to build.

_When to revisit._ If job volume or failure-handling complexity grows past what a cron-drained table handles comfortably, move to a managed platform. The service layer means callers don't change.

### Interrupted drains and stale jobs **[DECIDED 2026-08-24]**

**Decision: a durable stale-`running` reclaim, generic across every job kind.**

**The defect.** `drainJobs` claims a whole batch atomically — `claim_ingestion_jobs` marks each row `running` and increments `attempts` in one statement — then processes the batch sequentially in JavaScript. If the process dies mid-loop, every claimed-but-unreached row stays `running`, and **nothing in the system ever transitions a row out of `running`.** There is no lease, no heartbeat, no worker identity and no expiry. The recovery sweeps cannot help either: `enqueueMissingArtwork` skips targets with outstanding work, and `enqueueJob` swallows the `23505` the partial unique index raises, so a stranded row makes its target invisible to **every** existing path.

**It is recurring, not a one-off.** Measured on staging 2026-08-25: 6 rows stranded 2026-08-23, 2 on 2026-08-24, 4 on 2026-08-25 — the latter two matching the `0 4 * * *` cron exactly. The drain route sets `maxDuration = 60` and claims 10; artwork jobs averaged roughly 9 seconds, so a full batch cannot reliably finish inside the ceiling.

**Scope is crash and interruption recovery only.** Detection of stale `running` rows, returning them to `pending`, integration into the normal drain path, tests for the interrupted-worker case, and an evidence-based threshold. **Unchanged: retry parameters, batch size, claim ordering, priorities, artwork cadence, curated ingestion behaviour, and the schema** — the last unless the design proves impossible without it.

**One mechanism for all kinds.** The defect is in the generic claim/drain lifecycle rather than in artwork or curated discovery, and the observed damage already spans both.

**What this does and does not achieve.** Reclaim makes stranded jobs **recoverable**; it does **not prevent new strandings**, because the 60-second execution ceiling is untouched. The outcome is a permanent leak converted into a bounded delay, not an interruption-proof queue.

**Resolved when the mechanism was implemented, 2026-08-24:**

**The threshold is 90 minutes, global, and bounded by worker lifetime rather than job duration.** **[RATIONALE CORRECTED 2026-08-25; the value is unchanged — see _Drain lifecycle: one claim per job_ below.]** Four workers claim, and each is bounded by the process holding the claim: the cron drain at `maxDuration = 60`, the search `after()` drain at the search route's 60, the album-page `after()` drain at whatever its route defaults to — it sets none — and every seed runner that drains at a 3600-second vitest timeout. **Past 60 minutes no such process is alive, so a still-`running` row is abandoned by definition**; 90 is that ceiling plus half again, covering clock skew and teardown lag. A per-kind threshold was rejected: it would be tuned against duration, and nothing retains per-job durations because `updated_at` is overwritten on termination.

**Two statements were removed from that paragraph on 2026-08-25 rather than softened.** It argued that `updated_at` on a `running` row is the moment its _batch_ was claimed, so the tenth job in a batch looks stale before it starts — which per-job claiming makes false, since `updated_at` is now approximately the moment that job itself began. And it said only two workers claim, which was never true of the two `after()` drains. **A duration-derived threshold is therefore now possible, and is still declined**: worker lifetime remains the safer variable, and the durations themselves are still not retained. Leaving either statement in place would have left a reader unable to tell which of the code and the record was wrong.

**`attempts` is the fencing token, and `markSucceeded`/`markFailed` now settle only their own execution.** Both were bare updates on `id`. They now also require `status = 'running'` and the claimed `attempts`, so a worker returning after its claim was reclaimed and re-taken matches nothing. **`attempts` needs no new column to serve this**: `claim_ingestion_jobs` increments it and returns the incremented row, making it a natural monotonic claim counter. Both conditions earn their place — status catches a row reclaimed but not yet re-claimed, attempts catches one that has been. A discarded completion is reported as **`superseded`** in `DrainSummary` rather than being silently dropped.

**Reclaim preserves `attempts`.** It counts execution _starts_, and a stranded job did start, so preserving is the reading that changes retry semantics least. The cost runs the other way: a job stranded twice gets one real attempt before terminal failure — bounded by a reclaimed row keeping its `id`, since claiming is ordered `priority asc, id asc` and it therefore returns to the **front** of the queue. And a marker is written to `last_error`, so a job exhausted this way says so.

**One claim in that paragraph was false, and is corrected rather than dropped. [OPEN]** It read that preserving `attempts` _"can never produce more than `max_attempts` starts"_. Nothing enforces that. `max_attempts` is consulted in exactly one place — `markFailed` — which runs only when a job throws inside a live process; neither `claim_ingestion_jobs` nor the reclaim consults it. A job claimed, stranded and reclaimed repeatedly therefore has `attempts` incremented on every claim, past `max_attempts`, with **no terminal state ever reached** — neither retried to exhaustion nor surfaced as failed. **The behaviour is unchanged by this correction.** A second statement went stale on 2026-08-25: stranding no longer "only ever hits the **tail** of a batch", because per-job claiming leaves no batch tail — it hits the one job in flight.

**Reclaim is a single `UPDATE` and needs no migration, RPC or `skip locked`.** Postgres evaluates the predicate under the row lock, so a concurrent reclaimer blocks, re-reads, finds `pending` and takes nothing. It cannot race `claim_ingestion_jobs` either: that touches only `pending` rows and this only `running` ones, so the predicates are disjoint.

**One thing implementation corrected in the plan. `run_after` is left untouched rather than set to `now()`.** The row was claimed, which required `run_after <= now()`, so it is already in the past and immediately eligible. Writing `now()` proved actively harmful: `run_after` is computed from the app clock and compared against the database clock, and **milliseconds of skew were enough to make a reclaimed job invisible to the very next claim** — caught by the terminal-failure test. `markFailed` already carried this warning for delays near zero; reclaim is that case.

**Duplicate execution from a reclaim race** remains idempotent at the data level — artwork refetches, `ingest_release_group` upserts, curated discovery converges through the per-album existence check — but the loser of an insert race throws and consumes an attempt.

**Current staging rows must not be repaired by hand.** Twelve jobs are stale as of 2026-08-25 — 4 `discover_curated_artist` and 8 `fetch_artwork` — and the count grows with each interrupted cron. They are to be recovered **through the implemented mechanism** once it is reviewed and verified, then verified from the database and queue. The 4 `fetch_artwork` rows in terminal `failed` are a different condition and are not reclaim's concern.

**Partial writes within one artist stay as they are.** A write failing mid-loop leaves the albums already written. **Making artist ingestion transactional is explicitly not attempted here**, and remains `[OPEN]` — reconsidered and rejected again on 2026-08-25 for a new and better reason, recorded under _Credit reconciliation and the completeness test_ below.

> **⚠️ One sentence of that paragraph was false, and is corrected rather than dropped. [CORRECTED 2026-08-25]**
>
> It read that _"the existence check heals it on a later run — the Durutti Column holds 32 of 37 on staging and converges without damage."_ **It does not heal it, and it did not converge.**
>
> The existence check reads `albums.mbid` and nothing else, so it heals a **missing** album and silently skips a **partially written** one — the case where the album row was committed and its `album_artists` credits were not. The album is then counted as already held, forever, by every path that looks.
>
> **The Durutti Column is the counterexample, and the sentence cited it as reassurance.** The 32-of-37 figure was accurate when written, before the staging recovery; all 37 album rows are present now and **36 are linked**. The 37th has sat in the catalogue since 2026-08-24 with no credit at all, reachable by MBID and unreachable from its own artist page. **The convergence claim is the reason nobody looked for it.**
>
> Superseded by _Credit reconciliation and the completeness test_ below, which makes the statement true by changing the check rather than by softening the sentence.

**Queue fairness is a separate `[OPEN]` problem and is not addressed.** `claim_ingestion_jobs` has no kind filter, so older artwork and tracklist jobs precede newly queued curated work. That is a scheduling question; this is a crash-recovery one. They interacted once — the backlog made a run long enough to be killed — but neither fixes the other.

### Drain lifecycle: one claim per job **[DECIDED 2026-08-25]**

**Decision: `drainJobs` claims one job immediately before executing it, rather than claiming a batch and then working through it.**

**This supersedes the claim mechanics of the section above and nothing else in it.** The reclaim, the fencing, the 90-minute threshold and the `attempts` semantics are unchanged; only the shape of the loop that claims work changes.

**The defect is the one that section named and did not solve.** `claim_ingestion_jobs` marks all N rows `running` and increments `attempts` in one statement, before any of them has run. At millisecond zero of a drain nothing distinguishes the job being executed from the N−1 not yet touched, so a killed worker abandons all of them. Reclaim converted a permanent leak into a bounded delay; it did not reduce how many rows leak per interruption.

**The invariant, stated exactly: at any instant, at most one row is `running` on behalf of a given worker.** An interruption can therefore abandon at most one row instead of N.

**This is prevention of _multi-job_ stranding, and it is structural rather than probabilistic. It is not prevention of stranding.** A job individually longer than its worker's remaining life still strands, is still reclaimed, and still returns to the head of the queue.

`claim_ingestion_jobs` is unchanged — no migration, no ordering change, no new RPC. It is called with `batch_size = 1` in a loop, and `for update skip locked` gives the same divide-not-duplicate guarantee at one row as at ten.

**A job enqueued during a drain may therefore be claimed later in the same invocation — an approved consequence of per-job claiming rather than a separate decision — so `maxJobs` bounds the jobs an invocation actually processes rather than only those pending when it began**, and preventing it would need a high-water mark inside `claim_ingestion_jobs`, which this boundary forbids.

**Why not simply reduce the batch size.** It lowers the frequency without removing the mechanism, and it cannot help where a single job exceeds the ceiling — at `N = 1` such a job still strands. It also reaches only the cron: `drainJobs` has four callers, and the four `discover_curated_artist` rows stranded on staging were stranded by a **seed runner** at the same batch size, not by the cron. Batch size is a number callers pick; the defect is in the loop they call.

#### The time budget

**An optional, caller-supplied wall-clock budget, checked before each claim. There is no default.**

|                        |                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **When it is checked** | Before each claim, never between claim and execution. A claimed job is always run                                                                                   |
| **What it never does** | Interrupt work already in progress. A job that crosses the budget runs to completion — the budget governs only whether to _start_ more                              |
| **Default**            | **None.** An absent budget means no deadline                                                                                                                        |
| **`maxJobs`**          | Retained as a secondary cap, demoted from safety mechanism. The loop ends at the first of: `maxJobs` reached, budget says do not start another, or nothing to claim |

**Why there is no default.** No single value is correct for both a 60-second function that has already spent 55 of them and a 3600-second test runner, and a wrong default fails silently in either direction — premature stopping is invisible throughput loss, absence of protection is invisible stranding.

**Why an optional budget is safe here, when it would not have been before.** Prevention lives in the claiming, not in the budget. A caller supplying no budget still has a worst case of one stranded row. The budget refines a floor that already holds, which is exactly why the two are separable.

**Exactly one of the four callers supplies a budget.**

| Caller                   | Worker ceiling                                 | Budget   | Why                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cron drain route**     | 60s, explicit `maxDuration`                    | **45s**  | The caller that demonstrably strands rows nightly, and the only one whose ceiling the repository states                                                                                                                                                                                             |
| **search `after()`**     | 60s, inherited from the search page route      | **none** | An add was measured at about a minute against that same ceiling, so a remaining-time budget would frequently be zero and would silently disable the `after()` cover fetch it exists for. Trading a shipped improvement for a probability reduction is wrong where the worst case is already one row |
| **album page `after()`** | **unstated** — the route sets no `maxDuration` | **none** | No defensible number exists without inventing one, and it claims a single job, so its worst case is already the irreducible one                                                                                                                                                                     |
| **seed runners**         | 3600s vitest timeout                           | **none** | A per-pass budget silently halves throughput: the runner loops a fixed number of passes and breaks only on an empty claim, so a truncated pass does not break early                                                                                                                                 |

**The cron's 45 seconds is derived from its own `maxDuration`, in one place, with 15 seconds of headroom.** The headroom is **not** sized for the post-drain `queueDepth` counts and the response, which are sub-second. It is sized for the in-flight job's overrun: a job started at the deadline must still fit inside the ceiling, and at the measured ~9-second artwork figure a job starting at 45s finishes near 54s. A 50-second budget would leave about a second and is a bet on the mean rather than the tail. **This is a derived number, not a measured one, and it remains a bet on a tail that cannot be eliminated.**

#### What the tests must establish, and one thing they cannot

**Two properties are under test, and only one is reachable by exhausting a budget.** An in-process test cannot kill its own worker, and throwing from inside a job runner is not an interruption — the failure path settles the row.

- **The structural invariant is asserted from inside the runner, mid-drain.** A stub queries `ingestion_jobs` while it is executing and asserts that exactly one row is `running`. This is the only honest proof of the invariant, and it fails immediately under batched claiming.
- **The deadline is asserted after the drain, on row state.** The jobs that were started are `succeeded`, the rest are `pending` with `attempts = 0`, and no row is left `running`. **`attempts` is the discriminator** — a never-claimed row carries 0 and a claimed-then-abandoned row carries 1; status alone cannot tell them apart.

Also required: the deadline check precedes the claim, and moving it after must fail a test; a job already claimed finishes beyond the budget, pinning the accepted limitation as intended behaviour rather than leaving it untested; `maxJobs` still caps; the existing concurrency, reclaim and fencing tests pass unchanged; the deadline guard is mutation-tested; and the cron's budget is asserted strictly below its `maxDuration`, so the two cannot drift.

**No test can establish that no job ever strands**, and the "finishes beyond the budget" test is the evidence that none can.

#### Open and deferred, stated so none of it reads as solved

**[OPEN] — `attempts` can exceed `max_attempts` through repeated interruption.** Recorded in full in the corrected paragraph above. Closing it means deciding whether a strand should consume an attempt at all, which reopens retry semantics settled on 2026-08-24. **Not reopened here.**

**[OPEN] — an individually oversized job.** Longer than its worker's life, so it strands, is reclaimed, returns to the front of the queue by `id`, and strands again. This cycle reduces its blast radius from the whole batch to itself; it does not make such a job complete or fail. Splitting `fetch_artwork` per size and making curated discovery resumable per browse page are candidate treatments, and **neither is decided**.

**[OPEN] — the album page route states no `maxDuration`.** Its worker ceiling is unknown to the repository. Not set here: that is a page route contract change.

**[OPEN] — the search `after()` drain may run with little or no remaining budget**, given an add measured at about a minute against a 60-second ceiling. Suspected, unquantified, not measured in this cycle. It is capped at one row by the claiming change regardless, which is the useful demonstration that the invariant protects callers we cannot measure.

**Queue fairness remains `[OPEN]` and is untouched.** `claim_ingestion_jobs` still has no kind filter and still orders `priority asc, id asc`, so older artwork jobs precede newly queued curated work. One consequence deserves recording because it is not obvious: **reclaim returns a stranded row to `pending` with its original `id`, so a row reclaimed today lands behind every job enqueued before it.** The four reclaimed curated-discovery rows on staging sit behind roughly 288 artwork jobs. Reclaim works exactly as designed and still leaves them weeks away.

**Deferred, unchanged, and not to be inferred from anything above:** kind-aware claiming and kind-specific batch sizes — both of which need the fairness question answered first, since a batch is an arbitrary mixture of kinds; artwork decomposition; resumable curated discovery; managed queue infrastructure, whose revisit criterion is still the one recorded under _Ingestion paths_ above; and **cron frequency, unchanged at daily and capped there by the hosting plan**.

**Staging recovery is not part of this cycle.** The rows stranded on staging remain recoverable through the mechanism already deployed, and remain unrecovered. No staging execution belongs in a code cycle — mixing them would make the resulting queue state unattributable to either.

**Provider integration is untouched.** Nothing here reads, writes or contemplates a Spotify identifier; §19.1 is unaffected.

### The claim boundary has a cardinality contract, and the drain enforces it **[DECIDED 2026-08-31 — after a demonstrated defect]**

**Contract: `claim_ingestion_jobs(batch_size)` marks and returns at most `batch_size` rows, and `drainJobs` settles every row it causes to enter `running`.**

**This was written because both halves were broken at once, in production code.** The claim function selected rows with `where id in (select … for update skip locked limit batch_size)` — the unsafe spelling. `IN (subquery)` may be planned as a semi-join and the subquery re-evaluated, and a `language sql` body can be inlined into the caller's plan, so `limit` bounds each evaluation rather than the total. The row-selecting query is now a **`materialized` CTE**, evaluated once, which is what makes the limit bind. Nothing else about the claim changed: the `pending` predicate, `run_after`, priority ordering with the `id` tie-break, `for update skip locked`, the attempt increment and the return shape are as they were, and concurrent claimers still skip locked rows.

**Observed rather than reasoned about.** CI logged the function called with `batch_size := 1` returning **three** rows, ten times in a single run. `drainJobs` consumed only the first, so two jobs stayed `running` with their attempt already spent — no retry path sees them, no failure metric counts them, and nothing recovers them for ninety minutes. That is §17's "work that stops silently", and it reached the cron drain and both `after()` drains equally.

**The caller does not trust the contract.** If a claim returns more than one row, `drainJobs` attempts to release **every** returned row back to `pending`, then throws. All of them, not only the surplus: it throws without running anything, so the first row is no more settled than the rest. **Every release is attempted even if one fails** — failures are accumulated and named in the error the drain raises, rather than stopping the loop at the first and stranding the rows behind it, which would be the very failure this guard exists to prevent. The release is fenced on `(id, status = 'running', attempts = <the value the claim returned>)`, which identifies one specific claim execution — a row re-enters `running` only through another claim, and claiming increments `attempts` — so a job another worker has legitimately advanced is left alone. The attempt increment is kept, because it really was spent.

**It throws rather than absorbing.** A database function violating its own cardinality is not an outcome the interface renders; it is the unexpected failure exceptions exist for. Processing the extras instead would breach `maxJobs`, which the cron's 60-second ceiling depends on.

**Three things are deliberately deferred, recorded so they are not rediscovered as surprises.** `claim_ingestion_jobs` has no guard against a null `batch_size` — `limit null` is unbounded, which contradicts the contract above; it is unreachable today because every caller passes the constant, and the same was true of the previous implementation, so this is not a regression. There is no concurrency test above `batch_size = 1`. And whether a claim that never executed should return its attempt is an open question that applies equally to `reclaimStaleJobs`, which behaves the same way — so it belongs to both paths or neither.

**What exposed it is not the same as what caused it, and only one is understood.** The condition reproduced on CI only when one particular integration test file preceded the affected suite; an inert file of identical byte size in the same position did not reproduce it. **Why that neighbour changes PostgreSQL's behaviour is unresolved and is not claimed here.** The cardinality defect is demonstrated independently of it.

---

### Credit reconciliation and the completeness test **[DECIDED 2026-08-25]**

**Decision: an album counts as already held only if its row exists _and_ it carries at least one `album_artists` credit. An album that fails that test is reconciled from its stored upstream payload.**

**This supersedes the _Partial writes within one artist_ paragraph above and nothing else in that section.** The reclaim, the fencing, the 90-minute threshold, the `attempts` semantics and per-job claiming are all unchanged.

**Two defects, and only one of them makes damage permanent.** A write sequence interrupted between the album row and its credits is the **window**. Three callers then reading `albums.mbid` alone and skipping is the **skip**. The window is narrow and its damage is trivially repairable; the skip is what converts a moment's interruption into a permanent wrong answer, because nothing in the system ever looks again. **The skip is the defect being fixed.**

**The false assumption was repository-wide, not curated-specific.** `discoverAndIngestArtist`, `seedCatalogue` and `addAlbumFromUpstream` each independently encode _album row exists ⇒ album fully written_. Fixing only the path where the damage was observed would leave the identical latent defect in the other two, so the completeness test is written **once** and shared by all three.

**`replaceCredits` changes from delete-then-upsert to upsert-then-delete**, and this is the load-bearing change:

| Order                      | An interruption mid-way leaves                                      |
| -------------------------- | ------------------------------------------------------------------- |
| delete → upsert _(before)_ | `old ∩ new` — a **strict non-empty subset** when a credit was added |
| upsert → delete _(after)_  | `old ∪ new` ⊇ `new` — **complete**, possibly with one stale extra   |

The final state on success is identical, and the delete's predicate does not depend on the pre-state, so this is a reordering rather than a behaviour change. **What it buys is a provable test.** Credit rows are written in **one** upsert statement, which is atomic, so after the reorder the only reachable incomplete state is **zero credits** — a strict non-empty subset becomes unreachable. That is what promotes _"does this album have any credit?"_ from a heuristic to a **complete** completeness test, and it is why the check can be this cheap.

**The stale-extra-link trade is deliberate and is not a free win.** The reorder can leave an album carrying one credit too many where the old order could leave it one too few. An extra credit puts an album on one artist page it does not belong on; a missing credit makes an album unreachable from the artist who made it. The first is visible, harmless and corrected by the next successful ingest; the second is silent and permanent. **The trade is taken knowingly, in that direction.**

**Reconciliation reads the stored payload and writes only credits.** `upstream_payloads` holds a verbatim `release_group` snapshot for every album — 707 of 707 on staging — because `storeUpstreamPayload` runs **before** any album row is written, so an album cannot exist without one. Reconciliation maps that snapshot and performs `upsertArtists` + `replaceCredits` and nothing else: it does not touch `hydration_status`, `representative_release_id`, releases, tracks, artwork, or `upstream_payloads.fetched_at`. **Callers holding a fresh payload pass it in** — curated discovery has one in hand from the browse — **and callers that do not, read it from disk.**

**Cost is zero in the normal case, and that is why a blanket re-ingest was rejected.** The three callers sit at very different cost points: curated discovery holds the payload already, while the seed and self-service both perform their existence check **before** fetching, so unconditional re-ingestion would cost two rate-limited MusicBrainz requests per already-held album — roughly twelve minutes across a 353-album tranche, and a live upstream fetch on an interactive path. The completeness check instead folds into the single-row lookup those callers already make, and the repair runs only against genuinely broken rows.

**Transactional ingestion was reconsidered and rejected again, for a stronger reason than before.** It is not merely unattempted — **it is impossible in the current sequence.** `ingestReleaseGroupPayload` makes a rate-limited HTTP request for the representative release's tracklist **between** the album write and the tracklist write, and no Postgres transaction can be held open across it. Closing the window that way would require restructuring to fetch-everything-then-write-everything. That may be the right long-term shape and is **not** foreclosed here; it repairs no existing data, and it does not by itself address the skip, which is the defect that made this permanent.

**No schema-level constraint is introduced, because none is available.** A `CHECK` cannot span tables. A constraint trigger deferred to commit gains nothing, because the client issues each write in its own implicit transaction — it would fire inside the legitimate window between the album row and its credits and break ingestion outright. **Enforcement at the database is unreachable without transactional ingestion**, which is precisely why the guarantee is written in the service layer. This explanation lives here rather than in `data-model.md` §2, which describes what `AlbumArtist` _means_ and makes no integrity claim; the reason enforcement is architectural is that it is a property of how writes are sequenced, not of the entity. **`data-model.md` is unchanged by this decision.**

**One latent state is detected and deliberately left unrepaired. `[OPEN]`** The same window exists one step later: an interruption between the album write and the representative-release write can leave `hydration_status = 'fetched'` with `representative_release_id` null. Unlike the credit case it does **not** self-heal, because nothing re-triggers ingestion for a `fetched` album. **It has never occurred** — zero rows on staging, in both directions of the pair. It is out of scope here because its repair needs upstream fetches and therefore a different mechanism, and because closing its window means moving the hydration upgrade to the end of the write sequence, which changes semantics two earlier cycles reasoned about deliberately. **An invariant test detects it; nothing repairs it.** Named as a follow-up, not folded in.

**Deliberately unchanged, and not to be inferred from anything above:** no migration and no schema change; the queue, cron, drain, artwork and job code; progressive hydration and its two-state model; scope and depth policy; the artwork re-enqueue question, which remains `[OPEN]`; and the equivalent unaudited window in `upsertReleases` and `storeTracklist`.

### Progressive hydration **[DECIDED 2026-08-24]**

**A third ingestion path, for expanding an artist's discography.** The two paths above are release-group-first: something already names a release group, and we fetch it. Neither can answer "give me everything by this artist", which is what a curated catalogue needs.

```
  Curated artist, by verified MBID
    └─▶ browse release groups (1 request per 100)
        └─▶ create minimal album rows        ─▶ grid renders immediately
        └─▶ enqueue artwork                  ─▶ Cover Art Archive, no rate limit
        └─▶ full detail deferred until an album is opened
```

**The saving is large because the deferred work buys nothing the grid displays.** A browse response carries every column the album card needs — `title`, `display_credit`, `primary_type`, `first_release_date` and the MBID — so a discography becomes visible after one request per hundred release groups. The full two-request ingestion costs two more requests per album for a tracklist no grid shows. Measured across the first curated tranche: **33 requests against 723**.

**Identity is complete from the first write.** A minimally hydrated album is an _incomplete record_, never a _provisional identity_ — its MBID is MusicBrainz's, exactly as any other album's. Nothing provisional is minted, so §19.1 is satisfied by construction rather than by policy.

**The states are explicit, because the distinction is load-bearing.** A browse response is deliberately partial and a full fetch is not, but both leave `representative_release_id` null when a release group holds no releases. Inferring which happened from the shape of a stored payload would be exactly the kind of state that nothing points at — the failure class already recorded in §13 and in the artwork lifecycle. `Album.hydration_status` records it instead; see `data-model.md` §2.

**Cover Art Archive is not rate-limited and needs only the release-group MBID**, so artwork is available for a minimally hydrated album at no MusicBrainz cost. The visual catalogue does not wait on enrichment.

**What this does not decide.** Which release types a curated artist's discography admits is a depth-policy question (`product-spec.md` §8.9), enforced separately from the scope filter below and deliberately narrower than it.

### Scope enforcement

Albums, EPs and mixtapes are ingested; singles are not. **Enforced at ingest** — an out-of-scope release group should never become a row, rather than the exclusion being carried in every read.

**The rationale previously ended "rather than being filtered at query time in perpetuity", and that permanence claim is now wrong. [AMENDED 2026-08-23]** The enforcement _point_ is unchanged and still correct; what changed is that the singles exclusion is a **current boundary rather than a permanent principle** (`product-spec.md` §8.9). No code changed with this amendment.

**The filter conflates two kinds of exclusion, and they are no longer the same kind of thing:**

| Class                                            | Types                                                              | Status                 |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------- |
| **Not music in the sense this product is about** | `audiobook`, `audio drama`, `interview`, `spokenword`              | Principled, unaffected |
| **Outside the current boundary**                 | `single`, and **`broadcast`, which appears in no document at all** | Explicitly temporary   |

They read as one list in `scope.ts`, which is exactly how a future session would take both as permanent. Two related precisions so they are not mis-assumed: **remix and demo _albums_ are already in scope** as accepted secondary types — it is remix _singles_ that are excluded, by primary type.

**Enforcing here discards upstream records outright** — no row, no payload, and no ledger of what was rejected. That is the opposite of the position §7a buys for every other field, so admitting singles later means a full upstream re-traversal per artist rather than a local reshape. **Recorded as a cost, not as a reason to build a ledger.**

### Self-service additions

Users search MusicBrainz in-app and add any in-scope release directly, with **no admin approval**. Guarded by the scope filter and a per-user rate limit, with every addition recorded in `CatalogueAddition` for audit. **[DECIDED — C4]**

---

## 7a. Upstream payload capture

**Decision: keep every upstream response verbatim, beside the columns mapped out of it. [DECIDED 2026-08-21]**

Ingestion maps a deliberate subset of each MusicBrainz response and discards the rest. That is the right shape for the columns and the wrong one for the response: **label MBIDs, recording MBIDs, external links and relationship credits all arrive in requests we already make**, and every one of them was being thrown away. Recovering any single field later costs one round trip per album against a one-request-per-second ceiling — minutes for the catalogue as it stands, hours for the catalogue as it is intended to be.

`upstream_payloads` is keyed `(source, source_id, kind)` and holds the raw `jsonb`.

**Three things this decision deliberately is not:**

- **Not a mirror.** A payload records what a source said at `fetched_at`. Upstream corrections do not flow in, and **no refresh policy exists** — the column is recorded so one can be keyed on it when something needs it, rather than inventing a cadence for a staleness nobody has felt.
- **Not a query surface.** Nothing reads these, and product code must not start selecting `payload->>'…'`. Storing is not modelling. When a feature needs a field it gets a column, mapped at ingest like every other — the payload is what makes adding that column free rather than a re-fetch.
- **Not multi-source support.** The key is source-agnostic because Discogs is recorded direction and the shape costs nothing today. It does **not** make a second source workable: `albums.mbid` is `not null unique`, so a record existing only on Discogs still has no home. That is a larger decision this table does not settle.

**Alternatives rejected.** A `jsonb` column on `albums` — payloads exist for releases and artists too, and a wide column on the hottest table costs reads for data nothing queries. Modelling labels, links and credits immediately — the shape of each depends on a feature that does not exist, and browse-by-label in particular needs decisions about multiple labels per release, catalogue numbers and sublabel hierarchies that only become clear when designing the page.

**Widened `inc` parameters.** Capture only preserves what was requested, so the release group now asks for `url-rels` and the release for `artist-rels+url-rels` — both riding requests already made. `genres` and `tags` are **excluded**: genre data is deferred, tags are upstream user noise, and both inflate every response on a path whose latency is already a recorded complaint. **Verified against the live API on 2026-08-22**, which local cannot do because `MUSICBRAINZ_CONTACT` is a placeholder there by design: a self-service add on staging succeeded under the widened parameters and took **about as long as before**, so MusicBrainz accepts the combinations and the larger responses cost no measurable latency on the path that would have shown it.

---

## 8. Popularity

**Decision: a popularity abstraction with ListenBrainz as the first implementation.** **[DECIDED — E2]**

This was explicitly requested and is the right shape. Popularity is consumed by three things — catalogue seeding, cold-start discovery, and search ranking — and its source will change:

```
  PopularitySource (interface)
    ├─ ListenBrainzSource     ← launch: external signal
    ├─ InternalActivitySource ← later: longplayr's own activity
    └─ BlendedSource          ← eventually: weighted combination
```

**The blend is needed at launch, not "eventually."** Per `product-spec.md` §8.3, both discovery charts fall back to the external source when internal activity yields fewer than 20 albums — which on day one is every chart, every hour. The abstraction is load-bearing from the first deploy rather than a future convenience.

_Why an abstraction rather than direct calls._ At launch there is no internal activity to rank by, so an external signal is unavoidable. As usage accumulates, longplayr's own data becomes both more relevant and more defensible than a third party's. Callers should never need to know which is in play.

**A tension this model does not currently hold. [RECORDED 2026-08-23]** The diagram above treats sources as **successive occupants of one slot** — one active source writing one `albums.popularity_score`, callers never learning which. `product-spec.md` §8.9 decided that **external source prominence and longplayr's own engagement popularity are two distinct concepts that may eventually be separate signals**, and two coexisting signals cannot share one nullable column written by one active source. `InternalActivitySource` is drawn as a _replacement_ for `ListenBrainzSource`, not a companion to it.

**Nothing is being changed here, and `popularity_score` is not being redefined.** Whether these become one field or two is undecided. It is recorded because the interface reads as though the question were already settled, and it is not.

**One measured consequence, already visible.** On 2026-08-23 all 335 seeded albums carried a score and all 27 self-service albums carried `null` — an exact correlation. Null is legitimate: the source genuinely has nothing to say about an album outside its top-N, and `topReleaseGroups` cannot be asked about a specific MBID. **What is not legitimate is null acting as a visibility gate** — `getPopularAlbums` filters `.not('popularity_score', 'is', null)`, so an album no external source has heard of cannot appear on Browse at all. §8.9 decides the principle; **what Browse Popular should do instead is a Phase 5 question and is not decided.**

_Risk._ ListenBrainz has a smaller dataset than commercial alternatives, so early rankings may look unfamiliar for popular music. **[VERIFY — confirm available statistics endpoints and their shape during implementation.]**

---

## 9. Caching

Deliberately minimal. Correctness first; caching added where measurement justifies it.

| Layer                  | Approach                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Catalogue pages        | Cached server-side with periodic revalidation — catalogue data changes rarely                 |
| Artwork                | Served from Supabase Storage behind a CDN, immutable URLs                                     |
| Discovery charts       | Recomputed hourly into a cached table, not per request. Definitions in `product-spec.md` §8.3 |
| Feed, profiles, search | Not cached — personal or query-dependent                                                      |

**No Redis, no separate cache layer at MVP.** Adding one before there's a measured problem means operating infrastructure to solve a hypothetical.

**Explicit risk.** Next.js caching defaults have changed meaningfully between versions and are easy to misconfigure — the classic failure being a personalised page served from a shared cache. **Caching behaviour must be explicitly configured and covered by tests**, not inherited from defaults.

---

## 10. Search

**Decision: Postgres full-text search plus `pg_trgm`.** **[DECIDED — E3]**

_Alternatives considered._ Typesense or Meilisearch (much better typo tolerance and instant-search feel, at the cost of a service to run and an index to keep in sync); Algolia (best relevance tooling, per-operation pricing that suits a browse-heavy product poorly).

_Why Postgres._ No additional service, no index-sync failure mode, and it's adequate well past MVP scale. The real difficulty in this product is **disambiguation, not matching** — many albums share a title, so the work is in ranking. That's addressed by combining text match with artist-name weighting and the popularity signal from §8, none of which requires a dedicated engine.

_Behind the service layer_, so replacement is contained if search quality becomes a limiting factor.

### ~~Precision: article-leading queries and the credit fuzzy tier~~ **[SUPERSEDED 2026-08-28 — REFUTED BY MEASUREMENT; see _Article normalisation in the fuzzy operands_ below]**

> **⚠️ This decision was made, then refuted before any code was written. It is left standing rather than deleted.**
>
> **Both halves failed, for different reasons, and the sequence matters:**
>
> 1. **STEP A** identified an apparent article-leading FTS fault and a fuzzy-credit flood.
> 2. **STEP B** proposed `display_credit > 0.5` plus stripping a leading article from the tsquery — chosen from a **four-artist sample**.
> 3. **STEP D** ran an **883-query corpus-wide sweep** across all 317 artists and **refuted the threshold**: at `> 0.5` only **55%** of legitimate partial-prefix queries survive.
> 4. Direct measurement then showed **tsquery article-stripping changes none of the demonstrated results**, and that the apparent FTS fault was **misattributed** — see the correction below.
> 5. **STEP B was reopened.**
> 6. The replacement is leading-article normalisation **inside the fuzzy similarity operands**, threshold unchanged at `> 0.3`.
> 7. **That replacement was validated against the full 883-query corpus _before_ being selected** — which is the discipline this block did not have.
>
> **The lesson is not that the number was wrong; it is that it was chosen from four artists and defended by a regression case (`radioh`, 0.545) that would have _passed_ at `> 0.5`.** A test designed as the safety net would have shipped green over the defect.

**Decision: raise the fuzzy threshold on `display_credit` to `> 0.5`, leave the `title` threshold at `> 0.3`, and strip a leading `the`/`a`/`an` from the query used to build the FTS `tsquery` only. `search_vector` is unchanged.**

**Not yet implemented.** This section records a decision; the migration does not exist, and nothing below describes shipped behaviour.

#### The two defects, measured at 707 albums

`product-spec.md` §8.10 recorded two faults at roughly 362 albums. Both reproduce at the current size, and one was **attributed to the wrong predicate** in the original record.

**Fault 1 — stopwords disable the full-text tier.** `websearch_to_tsquery('simple','the warning')` yields `'the' & 'warning'`, requiring both lexemes. Measured across every article-leading query tried, **tier 3 returned 0 rows**.

**Fault 2 — the fuzzy tier floods, and it is the _credit_ predicate, not the title one.** The original record named `similarity(title, query)`. Attribution for `the warning` at 707 albums: **11 albums admitted via `display_credit`, 2 via `title`, 1 via full-text.** The mechanism is `similarity('The Wake','the warning') = 0.400` — every album by an artist whose name begins with an article is admitted. **30 of 317 artists and 88 of 707 albums (12.4%) carry a leading article**, so the affected population scales with the catalogue.

**The clearest single observation:** `warning` returns **1** clean result; `the warning` returns **13**, of which 12 are noise.

#### Why the thresholds are asymmetric

Title and credit have opposite noise profiles, so one number cannot serve both.

|                                     | Measured                        |
| ----------------------------------- | ------------------------------- |
| Credit noise (article collisions)   | **0.300 – 0.417**               |
| Legitimate partial-credit recall    | **0.545 – 0.750**               |
| Title fuzzy admissions per query    | 2 – 4 rows                      |
| Mean title similarity to `the wall` | 0.010 – 0.066, all length bands |

**Raising the title threshold too was rejected**: title fuzzy is not the noise source, and raising it would threaten typo recall (`thriler` → `Thriller` is 0.700) for no measured gain.

**Removing the credit fuzzy predicate was rejected, on evidence that reversed the intuition.** It looks redundant because tier 2 already matches credit exactly — but **tier 2 has no credit _prefix_ predicate**, only equality. Partial artist names therefore reach albums _only_ through fuzzy credit: `radioh` 0.545, `radiohe` 0.636, `pink fl` 0.583, `hot chi` 0.700, and **0.000 against every unrelated artist**. Removing it would mean typing `radioh` returned no albums at all.

**`> 0.5` is chosen because `similarity('The Wake','the wall') = 0.500`**, so a strict comparison excludes the demonstrated collision while retaining the lowest measured legitimate value, 0.545.

> **⚠️ The margin is narrow and the threshold is not corpus-validated.** 0.500 against 0.545 is a gap of 0.045, established across **four artists**. STEP A did **not** establish a corpus-wide separation. A larger sample could contain a legitimate partial name below 0.545 or an article collision above 0.5. **This value is supported by the current evidence, not proven universally**, and the regression case for `radioh` exists to catch it.

#### Why leading-article stripping rather than `english`

The article is removed from the query used for the `tsquery` **only**. `n.q` is untouched, so **exact title, exact credit and title-prefix behaviour are all unchanged** — only the FTS tier sees the stripped form.

**This is deliberately narrower than general stopword handling.** It addresses leading articles, which is the measured fault, and leaves a query whose _interior_ stopwords are absent from the target title still failing tier 3. That case was not observed and is not fixed here.

**`english` was rejected for this cycle, and not because it is worse.** It is the more general fix and remains available. It was declined because:

- `search_vector` is `GENERATED ALWAYS AS … STORED` on **both** `albums` and `artists`, so changing the configuration means **dropping and re-adding both generated columns and rebuilding both GIN indexes** — a full-table rewrite for a precision defect.
- It introduces **stemming**, with measured examples `warning → warn`, `Volume → volum`, `Dry → dri`, `Supreme → suprem`. That trades a measured false-positive class for an **unmeasured** one.
- The measured defect can be addressed without touching schema at all.
- **CJK gave no reason to prefer it**: `恍惚の世界` tokenises identically under both configurations.

#### Boundary

**One migration replacing `search_albums` and `search_artists` via `create or replace function`, plus additive regression tests in `tests/integration/search.test.ts`. Nothing else.**

Explicitly excluded: generated columns, GIN indexes, any schema change, the service layer, the UI, any production application code, upstream MusicBrainz artist matching, upstream "show more", and any broader relevance redesign.

#### Regression contract

Nine cases, all deterministic at the database-function level: `the warning`; `the wall`; `the wake` (guarding **over**-correction — the artist's own albums must still return); `thriler` typo recall; **`radioh` partial-credit recall**; credit-side article noise absent; exact/prefix precedence; artist article noise; and the existing ordering and limit contracts. **Every existing behaviour is preserved except the two demonstrated defects.**

#### Success criteria — for STEP E/F to be judged against, not guarantees

Article-leading queries fall from the observed 13–15 rows to **no more than 4** in the demonstrated cases, with the intended result ranked first; `radioh`, `thriler`, `radiohead`, `in rainbows` and `warning` return **exactly what they return today**; tier 1–3 ordering is unchanged; existing tests are added to rather than rewritten.

A STEP B simulation against the live 707-album corpus projected `the warning` 13 → 2, `the wall` 15 → 4, with `radioh`, `thriler` and `radiohead` unchanged. **That is a simulation of the proposed predicate, not a measurement of shipped code.**

#### Deferred, and not resolved here

Whether upstream search should match artists; upstream "show more"; broader relevance policy; general stopword semantics; and the `english` migration. All remain `[OPEN]` in `product-spec.md` §8.10.

---

### Article normalisation in the fuzzy operands **[DECIDED 2026-08-28 — replaces the superseded block above]**

**Decision: strip a leading `the`/`a`/`an` from _both operands_ of the fuzzy similarity comparison, and change nothing else. The `> 0.3` threshold is unchanged.**

**Implemented and CI-verified.** Migration `20260828120000_refine_search_precision.sql`, commit `52de586`, **CI run #62 green on that exact SHA** — attempt 1, both jobs, 266 unit and component, **447 integration**, 1 seed, 75 end-to-end, zero retries and zero flaky. The migration applies cleanly on a **fresh** CI database, so this is not a local-only result.

> **⚠️ What CI verified, and what it did not.** CI runs against a clean fixture database. **The 707-album corpus effect was never observed post-change on staging** — the migration has not been deployed there, and the figures below remain the **read-only simulation** performed before implementation. The same applies to the 5-point recall trade. CI establishes that the implementation is correct and its regression contract holds; it says nothing about how the change behaves across the real catalogue, and nothing about future catalogue data.

#### What changes

| Function         | Current                                   | Decided                                                 |
| ---------------- | ----------------------------------------- | ------------------------------------------------------- |
| `search_albums`  | `similarity(a.display_credit, n.q) > 0.3` | same, with a leading article removed from **each side** |
| `search_artists` | `similarity(ar.name, n.q) > 0.3`          | same, with a leading article removed from **each side** |

**The normalisation applies to the fuzzy comparison only. `n.q` itself is untouched.** Therefore exact title matching, exact credit matching, title-prefix matching, `search_vector` / FTS behaviour and tier ordering are **all unchanged**, and there is **no generated-column, GIN-index or schema change** — the migration replaces the two functions and alters only the two similarity expressions.

**`search_artists` is included on its own evidence, not for symmetry.** It has no credit predicate, but `search_artists('the wall')` returns The Wake, The Weeknd, The Who and The xx — all tier 4, none relevant — through the identical article-inflation mechanism on `name`.

#### Why: the mechanism

A shared leading article inflates trigram overlap between otherwise unrelated strings. Removing it from both sides removes the shared trigrams and leaves the discriminating content:

| Case                                     | Current | Normalised |
| ---------------------------------------- | ------- | ---------- |
| The Wake / `the warning` — noise         | 0.400   | **0.182**  |
| The Who / `the wall` — noise             | 0.417   | **0.125**  |
| The Offspring / `the warning` — noise    | 0.300   | **0.125**  |
| The Wake / `the wake` — legitimate       | 1.000   | **1.000**  |
| Arctic Monkeys / `arctic m` — legitimate | 0.500   | **0.500**  |
| The Weeknd / `the week` — legitimate     | 0.667   | **0.500**  |

All three demonstrated collisions fall below the **existing** threshold; all three legitimate cases stay above it.

#### Corpus-wide evidence — 883 queries, generated across the 317-artist corpus

Prefixes of length 6–9 from every artist name of ≥8 characters, at **unchanged `> 0.3`**:

> **[CLARIFIED 2026-09-03 — wording only; no number below has changed.]** This heading read "**883 queries, all 317 artists**", which sits awkwardly against the rule stated directly beneath it: **only 243 of the 317 artists have names reaching 8 characters**, so 74 contributed no query. The sweep **scanned** the whole corpus; it **generated from** the eligible subset. **The two statements together do not pin a unique query set**, and a 2026-09-03 reconstruction applying the stated rule produced **943** queries rather than 883 — the deduplication that closes that gap was never recorded. The 883 figures remain the historical evidence exactly as measured; they are simply **not reproducible byte-for-byte**, and should not be treated as interchangeable with a later count.

|                                  | Current             | Normalised          |
| -------------------------------- | ------------------- | ------------------- |
| Legitimate self-matches retained | 858 / 883 (**97%**) | 812 / 883 (**92%**) |
| False positives admitted         | 189 / 883 (**21%**) | 109 / 883 (**12%**) |

**This is a tradeoff, not a free precision improvement:** roughly **42% fewer false-positive admissions** for roughly **5 percentage points** of legitimate partial-prefix recall. The loss concentrates on short prefixes of article-leading artist names (`the wa` → `wa` against `wake`), and is partially compensated because `search_artists` retains its `lower(name) like q||'%'` prefix predicate, so the artist stays discoverable even when its albums drop out.

**It is not proof the mechanism is universally optimal.** It removes the _article_ collision class specifically; the remaining 109 false positives are collisions between genuinely similar names, which this does not address and does not attempt to.

#### The accepted cost, stated as a product decision

> **The product accepts a 5 percentage point reduction in legitimate partial-prefix album recall in exchange for materially reducing article-driven fuzzy-credit noise.**

**Context that bears on how severe this defect actually is:** in every measured article-leading example the **intended result still ranked first** — `the warning` returns _The Warning_ at tier 1 with the noise strictly below it; `michael ` returns Michael Jackson at tier 3; `arctic m` returns Arctic Monkeys with no noise at all. **The defect being addressed is clutter beneath a correct top result, not an incorrect top result.** Accepting the status quo was a defensible alternative and is recorded as such.

#### The deployed function, measured on the real corpus — **2026-09-03**

**[MEASURED AND RULED 2026-09-03. The trade above is RETAINED.]**

Everything above this heading was measured against **candidate SQL, before the deployed function existed**. This block is the first measurement of **what actually shipped**, run read-only against the real **707-album / 317-artist** staging corpus. **The two are separate measurements and must not be merged**: different SQL, different sets, and the historical one is not reproducible byte-for-byte (see the clarification above).

On a reconstructed **943-query** set — prefix lengths 6–9 across the **243** eligible artists:

|                                   |                       |
| --------------------------------- | --------------------- |
| Pre-change reconstructed baseline | **890 / 943 (94.4%)** |
| Deployed function                 | **854 / 943 (90.6%)** |
| **Change-caused misses**          | **36**                |
| **Pre-existing misses**           | **53**                |
| **Gained**                        | **0**                 |

**All 36 change-caused misses are short partial prefixes of article-leading artist names, and the complete artist name always succeeds.** Recovery occurs at 7–9 characters — The Killers `the kil` (7), The Weeknd `the wee` (7), The Beach Boys `the beac` (8), The Rolling Stones `the rolli` (9), A Perfect Circle `a perfe` (7).

**Every miss is predicate exclusion, not limit truncation.** All 89 were re-run at limit 100 and **none recovered**, so no relevant album is present-but-buried.

**A separate 211-query curated set found no plausible false negatives** — full titles, article-stripped titles, single-word titles, character-dropped misspellings and one-album artists all pass, and the original `the warning` collision returns _The Warning_ in 2 rows.

> **Ruling: the 36 misses are not material. The trade is retained, and no search implementation change was made** — no revert, no threshold change, no ranking change.

**The ruling's scope is a condition, not a footnote.** It rests on the failure window being confined to short, deliberately submitted prefixes, and **search is submit-driven with no autocomplete** — verified in code, not assumed. **Building as-you-type search would fire these prefixes on the way to every longer query and requires revisiting this**, as would a substantially larger catalogue: this was judged on 707 albums and 317 artists.

#### Why `> 0.5` was rejected — preserved so it is not re-proposed

The same 883-query sweep:

|                                |           |
| ------------------------------ | --------- |
| Legitimate self-match minimum  | **0.231** |
| 5th percentile legitimate      | 0.318     |
| 95th percentile false positive | 0.429     |
| Maximum false positive         | **0.667** |

The distributions **materially overlap**, so no global threshold separates them. At `> 0.5` only **55%** of legitimate partial-prefix queries survive, and these ordinary queries score exactly **0.500** and are therefore excluded:

`michael ` → Michael Jackson · `arctic m` → Arctic Monkeys · `olivia r` → Olivia Rodrigo · `imagine ` → Imagine Dragons · `nine inc` → Nine Inch Nails

**The proposed `radioh` regression case scores 0.545 and would have survived `> 0.5`** — it was insufficient protection, and any future decision touching partial-artist matching must test the first-word prefixes above instead.

#### The article-leading FTS fault: measured, and not reproducible

**Do not ship tsquery article stripping.** The original finding does not hold as a current user-visible defect:

- `websearch_to_tsquery('simple','the wake')` **already matches** the relevant 8 albums — `The Wake` contributes both `the` and `wake` lexemes at credit weight B.
- Its apparent absence from tier 3 was **tier precedence**, not suppression: those rows received tier 1 or 2 from exact title or exact credit matching, which the `CASE` evaluates first.
- Stripping the leading article from the tsquery produced **identical results** on every demonstrated query — 13, 15, 15 and 3 rows before and after.

**This is not broadened into general stopword handling**, and `english` remains rejected for the reasons in the superseded block.

> **The word "article" appears in both decisions and they are not the same thing.** The rejected change stripped articles from the **tsquery**, altering which rows the _full-text_ tier matched — and altered nothing. The adopted change strips them from the **similarity operands**, altering which rows the _fuzzy_ tier admits — which is where the mechanism actually operates.

#### Regression contract for STEP E

**Album search:** `michael `, `arctic m`, `olivia r`, `imagine `, `nine inc` each return that artist's albums; `radioh` retains existing recall; `the wake` retains The Wake's own albums; `the warning` ranks _The Warning_ first **and** excludes the measured article-noise albums; `the wall` shows the corresponding precision behaviour; the existing `thriler` typo test is unmodified; exact/prefix precedence and tier 1–3 ordering unchanged; ordering and limit contracts unchanged; and **one explicit accepted-loss case** — a short article-leading prefix that no longer returns an album, asserting the artist remains discoverable through `search_artists`.

**Artist search:** `search_artists('the wall')` no longer returns the unrelated `The …` artists, with its prefix and ordering behaviour preserved.

**Assertions must be on identity and rank, never counts alone.**

#### Boundary

**Allowed:** one migration using `create or replace function`; additive coverage in `tests/integration/search.test.ts`.

**Not allowed:** changing the threshold; changing tsquery construction; `search_vector`; generated columns; GIN indexes; schema changes; service layer; UI; upstream MusicBrainz search; "show more"; broader ranking redesign. **The migration alters only the two fuzzy similarity expressions.**

---

---

## 11. Environments and deployment

**Decision: local → shared staging → production.** **[DECIDED — E7]**

| Environment | Database                | Purpose                                                             |
| ----------- | ----------------------- | ------------------------------------------------------------------- |
| Local       | Local Supabase          | Development                                                         |
| Staging     | Shared Supabase project | Preview deploys; migrations rehearsed against realistic seeded data |
| Production  | Production Supabase     | Real users                                                          |

_Alternatives considered._ Production-and-local-only (cheapest, but every migration meets real data for the first time in production); per-PR ephemeral databases (most rigorous, but self-built work on Supabase).

_Why this._ The main thing environments buy is **rehearsing migrations before they touch real users**. A shared staging environment delivers that at low cost. Its known weakness — concurrent pull requests share one database and can interfere — is acceptable at this team size and revisitable later.

**CI: GitHub Actions on every pull request** — lint, typecheck, unit and integration tests, build. **[INFERRED]** This is ordinary practice rather than a course-derived recommendation, and it's what makes every other quality mechanism trustworthy.

---

## 12. Testing

Proportionate to risk, not uniform coverage.

| Layer       | Tool                   | What it covers                                                                             |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| Unit        | Vitest                 | Rating aggregation, scope filters, feed eligibility rules, popularity abstraction          |
| Integration | Vitest + test database | Service layer against real Postgres — collection semantics, feed queries, cascade deletion |
| End-to-end  | Playwright             | The core loop only: sign up → search → add → rate → review → follow → see feed             |
| Visual      | Screenshot comparison  | UI work, per `docs/design-reference.md` §9                                                 |

**Areas that specifically warrant tests**, because they're where quiet, hard-to-notice bugs live:

- **Feed eligibility** — the anti-flood rule is a single condition whose failure floods every follower's feed. Test both directions: a backfill generates nothing, and an interactive add with a backdated `listened_on` still generates an event.
- **Hard deletion** — cascades must be complete; an orphan is a privacy failure, not a bug.
- **Rating aggregation** — nulls excluded, one-decimal rounding, thin-data behaviour.
- **Interrupted workers** — a job left `running` by a killed process must be reclaimed and must run again. **Covered since 2026-08-24**: stale detection and its boundary, concurrent reclaimers, reclaim racing a normal claim, attempt preservation, terminal exhaustion after stranding, and untouched `pending`/`succeeded`/`failed` rows — plus the two that matter most, a late worker's success and a late worker's _failure_ both being unable to overwrite a newer execution. The race that matters is a **legitimate worker against the reclaim**, not two claimants (§7).
- **Catalogue scope** — singles must not enter the catalogue under any input shape. **The test requirement is unchanged and must not be weakened**; only its justification is now a current boundary rather than a permanent principle (§7, `product-spec.md` §8.9).
- **Authorisation** — since RLS isn't the primary mechanism, application checks are the only barrier and must be tested directly.
- **One job at a time** — the drain's structural invariant, asserted from _inside_ an executing job by counting `running` rows mid-drain, not inferred from what a drain produced. An in-process test cannot kill its own worker and a throwing runner is not an interruption, so observing the table while work is in flight is the only honest proof (§7).

### Integration isolation is a contract the runner must actually enforce **[2026-08-25]**

The integration project shares one database and its config has always said so — `fileParallelism: false`, with the comment that running these files in parallel would let them see each other's rows. **That project-level setting was demonstrably not sufficient to guarantee the intended isolation**, so `npm run test:integration` now passes `--no-file-parallelism` explicitly. The contract is unchanged; only its enforcement moved to the command, where it is observable.

**What that change is not.** During one window of sustained back-to-back heavy local runs, 14 integration tests failed, including pre-existing ones in `curated-recovery.test.ts`; two single-file runs failed in the same window. **The failures then stopped reproducing — including without the flag** — across eight subsequent focused runs and two full-suite runs. So the flag **must not be described as the proven cause or the proven fix** of that window. It is not, and an earlier report in this cycle said so with more confidence than the evidence supported.

**What is inference rather than explanation.** Per-job claiming replaces one claim round trip per drain with one per job, which plausibly increases the number of interleaving points between any two concurrent drains. That is a reasonable mechanism and it is unrefuted; it is **not** an established causal account of the observed failures. The `claim_ingestion_jobs` RPC itself was probed directly and honours `batch_size = 1` correctly.

**The load-sensitivity finding in `docs/current-state.md` §8 stays `[OPEN]` and is not closed by any of this.** These observations belong to it as further data points, on the integration suite rather than only on Playwright.

### End-to-end fixture cost, and a rejected hypothesis **[2026-08-28]**

**Two of the suite's most expensive tests now build their prerequisite state through the database instead of the browser. The reasoning that led there is worth more than the change itself, because the first hypothesis was wrong and the second is narrower than it looks.**

#### The dev-server hypothesis, investigated and rejected

Playwright runs against `npm run dev` (`playwright.config.ts`), and CI's end-to-end job **never builds** — `next build` runs only in the other job, on another runner, with no `.next` shared. So every CI run starts from a completely cold compilation cache, and on-demand route compilation looked like an obvious cause of timeouts.

**Measured, it is not.** Against a cold server:

|                                               |                    |
| --------------------------------------------- | ------------------ |
| Server startup                                | **388ms**          |
| Worst single route compile (`/albums/[mbid]`) | **1.42s**          |
| Total across all ~8 route patterns            | **≈3s, paid once** |
| Warm per-request cost                         | **39–110ms**       |

And the test that prompted the investigation, `collection-sort.spec.ts:391`, took **16.9s on a warm server on an idle machine** — with no compilation at all. A production server would have saved perhaps 30–60ms per request against a 13-second gap.

**So the e2e server stays on `npm run dev` and no production-server mode was implemented.** Recorded because the change was proposed, looked plausible, and would have produced a green run or two while fixing nothing.

#### Whether the end-to-end gate should run the production build — **[OPEN 2026-09-04. The rejection above stands.]**

**The 2026-08-28 rejection above is not superseded, and this note does not supersede it.** It measured compilation latency on an idle machine — 388ms startup, ~3s of compilation paid once, 39–110ms warm per request — and concluded that a production server would save "perhaps 30–60ms per request against a 13-second gap". **That reasoning is unchallenged on its own terms.**

**A later measurement appeared to contradict it and does not, because it is confounded.** On 2026-09-04 the same thirteen tests ran in **48.4s against `next dev` and 28.7s against `next start`**. But the two batches ran under **different memory conditions**: the dev server was killed before the production server started, and swap fell from 11,848 MB to 9,384 MB across the comparison. **The production batch therefore had roughly 2.4 GB more memory available**, and the result cannot be attributed to the server type.

**A reconciliation exists but is not established.** The 2026-08-28 work measured _compilation latency_; the memory finding above concerns _resident footprint_ — the dev server held ~270 MB under load against ~108 MB for the production server. On a host with essentially no free memory, footprint could matter where latency does not. **Both records could be correct about different mechanisms. That is a hypothesis, and it has not been tested.**

**Two separate questions are entangled here and should not be answered together.** Whether the production build is the _correct_ verification target is a **correctness** question — Vercel serves that artifact and the local gate does not currently exercise it. Whether it is _faster_ is a performance question, and it is the one the evidence cannot presently answer.

**What would settle the performance half:** an A/B under identical memory conditions — start one server, measure, stop it, start the other, measure, with free memory and swap recorded at every point and the order reversed on a second pass. **That experiment has since been run — see below. The question remains `[OPEN]` regardless, because the experiment addresses only the performance half.**

##### The controlled A/B, as run **[MEASURED 2026-09-04. Still not a decision.]**

Conducted on the exhausted host described below in this section — free physical memory ≈0.01 GB, swap already ~9–11 GB consumed. Thirteen tests (`follows.spec.ts`, `search.spec.ts`), one build produced up front so build time was charged to neither arm, database reseeded identically between arms, free memory and swap recorded at every stage, and the order reversed on the second pass.

| Pass | Order            | `next dev` | `next start` | Swap at arm start (dev / prod) |
| ---- | ---------------- | ---------- | ------------ | ------------------------------ |
| 1    | dev → production | **51.5s**  | **26.7s**    | 10,558M / 8,970M               |
| 2    | production → dev | **44.4s**  | **29.8s**    | 9,219M / **8,928M**            |

**Production was faster in both execution orders.** Arithmetic means: **48.0s dev against 28.2s production**, an observed mean difference of **≈41%**.

> **That 41% is the observed mean of this experiment. It is not an established general performance magnitude, and must not be quoted as one.**

**Swap growth during each arm, measured directly:**

| Arm          | Pass 1    | Pass 2    |
| ------------ | --------- | --------- |
| `next dev`   | **+587M** | **+395M** |
| `next start` | **+148M** | **+210M** |

Aggregated, **≈+491M for dev against ≈+178M for production** — roughly 2.8×. The per-pass figures above are the measurements; the aggregate is derived from them.

##### The residual confound, recorded because reversal did not remove it

**Production began from the lower-swap state in _both_ passes** — 8,970M and 8,928M, against dev's 10,558M and 9,219M. Each run leaves swap higher than it found it, so **the arm running second inherited worse memory pressure**, and in pass 1 dev additionally started at the session's high-water mark. **Reversing the execution order therefore did not isolate order from memory state.**

**What this does and does not license.** The **direction** of the result is supported: production won under both orders, and in pass 2 the starting gap was only **291M** yet production still won by 33%. The **magnitude is not established** — the 41% mean rests on comparisons where production consistently held the better memory position.

**The swap-growth measurement is mechanistic rather than inferred from timing**, so it is not subject to the ordering confound and is independent evidence that the dev server's resident cost during a run is materially higher. **It does not eliminate the timing confound**, and it should not be read as doing so.

##### What this changes, and what it does not

**It does not overturn the 2026-08-28 rejection, and does not reopen it.** That work measured **compilation latency on an idle machine** — 388ms startup, ~3s paid once, 30–60ms per warm request — and its reasoning is unaffected. This experiment measures **memory footprint and host-pressure behaviour on an exhausted machine**. **Both observations can be valid simultaneously**, which is the reconciliation this section previously offered as a hypothesis and which now has supporting evidence.

**The correctness question is untouched by all of it.** Whether the deployed artifact ought to be the verification target is an architectural argument that timing cannot settle. **No production-build change has been approved, none has been made, and the target remains `[OPEN]`.**

#### The end-to-end suite is memory-sensitive, and that is the supported explanation **[DECIDED 2026-09-04]**

**The local suite fails under memory pressure, not under CPU load.** Measured on the maintainer's host while the suite was failing: **free physical memory ≈0.01 GB**, swap **11.5 GB of 12.3 GB consumed before any test ran**, with the top twenty processes totalling only 2.2 GB against 8 GB installed. Concurrently the suite requires a Docker VM (allocated 3.8 GB), a Next server and a Chromium instance.

**The failure signature follows from that and from nothing else.** Every failure is a timeout, `net::ERR_ABORTED` or `session closed` — **never an assertion about wrong output** — and per-test duration degrades monotonically through a run, measured at 7.9s for tests 1–20 against 24.5s for tests 81+. The identical commit passed **108/108 in 12.4m on CI**, and the local run's first forty tests match CI's per-test average before diverging.

**Two candidate causes were eliminated by measurement rather than by reasoning:** file descriptors (12,831 open against a 30,720 system limit) and database connections (17 of 100). Test parallelism was never available as a remedy — the suite is already `workers: 1`, `fullyParallel: false`.

> **The load-average correlation recorded previously is incidental, not causal.** Load average counts processes blocked on I/O, which is exactly what swapping produces. A deliberate experiment removing external load left the failure rate essentially unchanged — **28% against 30%** — while load rose from 4.4 to 16.5 during a run with nothing external running. **The earlier characterisation is superseded in its causal claim and retained as history**; it was a reasonable reading of the measurements available then.

**This is an environmental limitation, not a repository defect.** No application defect was established, and CI provides an independent full-suite environment that runs the same code successfully.

**No minimum RAM figure is stated, deliberately.** The evidence is one host at one configuration, and "8 GB is insufficient" is an observation about that machine rather than a measured threshold. **The diagnostic to reach for is free memory and swap usage — not CPU or load average.**

#### A fresh server per local run **[DECIDED and IMPLEMENTED 2026-09-04]**

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, so a local run attaches to whatever is already listening on the port. **An orphaned server from an interrupted run is silently reused** — observed directly, when a stale `next dev` process survived an aborted run and had to be killed by hand before the next run could start.

**A fresh server is now started for every local verification run.** `reuseExistingServer: false`, verified by execution: with a server already listening, Playwright refuses to run — _"http://localhost:3000 is already used"_ — rather than adopting it. Reuse makes a run's result depend on invisible state, and a stale process can serve stale code while the run reports success. CI is unaffected; it already runs with reuse disabled. The cost is server startup per run, which is noise against a suite measured in tens of minutes.

#### What the cost actually is

UI-driven **prerequisite** setup. `collection-sort.spec.ts:391` spent roughly 74% of its runtime on one signup, four collects and two ratings — none of which it asserts anything about. Measured across `want-to-listen.spec.ts`, tests calling `signUp` ran 2.6–6.1s while the one signed-out test ran **511ms**.

**Prerequisite state can be built faithfully rather than approximately.** `ensure_collection_entry` is a Postgres function, documented as the single path by which an entry comes to exist, and it owns the Want to Listen clearing rule. Its signature takes `p_user_id` explicitly and it contains no `auth.uid()`, so an admin client can call **the same function the server action calls**, for any user, with no session. Ratings are the same `update` the service layer performs. Compared side by side, API-created state was **byte-identical** to UI-created state — entries, order, ratings, `liked`, `relisten_count`, `listened_on`, favourites and wishes — including the implicit collection creation that rating an uncollected album performs.

**The rule this follows:** a UI operation stays in the UI when the test asserts something about that operation; it moves to the API only when it is constructing a precondition another test already covers as its subject. `auth.spec.ts` and `collection.spec.ts` remain the deliberate owners of signup and collection UI flows and were not touched.

**An API fixture must assert its own postconditions.** This is not ceremony, and it was learned rather than anticipated. A UI helper verifies itself for free — every `collect` waits on "In your collection" — so a setup that silently did nothing cannot reach the test body. An API fixture has no such property, and the pilot's first version was **vacuous**: with its writes removed the test still passed, comparing an empty state to an empty state. Postconditions must also order deterministically — a first attempt ordered on `rating`, which has two nulls and no tiebreaker, and returned a different sequence on consecutive runs.

#### What was measured

| Test                             | Before (median of 5) | After (median of 5) |
| -------------------------------- | -------------------- | ------------------- |
| `collection-sort.spec.ts:391`    | 14.1s (13.8–16.0)    | **6.6s**            |
| `profile-collection.spec.ts:312` | 12.2s (11.5–17.6)    | **7.7s** (6.0–9.9)  |

All original behavioural assertions were preserved **byte-for-byte** in both tests. Two negative controls per conversion: removing a fixture write fails the test at its postcondition in under 600ms, and removing the `user_id` predicate from `listCollection` fails `:312` on its cross-user isolation assertion. Production was restored byte-identically by checksum after every control.

#### ⚠️ The causal claim, corrected — this is the part that matters

**The model behind this cycle was "slow tests have less headroom against the 30s timeout, so they are the ones that fail." The evidence does not support it.**

One local full-suite run went red on its own under sustained load: 64 of 75 passing, 13.3 minutes against 5.6, with **14 timeouts, 2 `net::ERR_ABORTED`, 2 `session closed` and 2 protocol errors**. Cross-referencing those failures against their durations in a clean run:

| Clean duration                                              | Outcome under load |
| ----------------------------------------------------------- | ------------------ |
| **1.8s**                                                    | **failed**         |
| 2.8s, 3.0s, 3.6s, 3.8s, 4.6s, 5.9s, 6.5s, 6.9s, 9.1s, 11.8s | all failed         |
| **12.9s — the slowest remaining test**                      | **passed**         |

The failing tests had a **median clean duration of about 4.6s**. A 1.8-second test exceeded 30 seconds while the slowest surviving test did not fail at all. **Baseline duration did not predict failure**, and inflation under load was neither uniform nor proportional to cost — the 1.62× ratio derived from suite totals holds only under moderate load and breaks down entirely in the pathological case.

**Therefore:**

- **It is not claimed that more headroom reduces flake probability.** That effect is **unproven**.
- **It is not claimed that these two tests caused the observed failures.** They were the slowest; that is a different statement.
- The conversion **is** a valid runtime and headroom improvement, verified. Its effect on the flake is **unknown**.

#### Three failure signatures, and what this addressed

`docs/current-state.md` §8 records three, all of which appeared in the red run: the **30s test timeout**, **`net::ERR_ABORTED`**, and **`session closed` / protocol-level browser-process failure**. **This cycle addressed the runtime of two expensive tests. It did not explain or fix any of the three signatures**, and the latter two remain entirely unexplained. They co-occurred under the same load, which is consistent with a shared cause and establishes none.

#### No further conversion, and why the reason changed

**No further tests should be converted on the current evidence.** The slowest remaining, `collection-sort.spec.ts:228`, has roughly 9.1s of projected headroom under the old model — but that model has now been shown not to predict failures, so converting further would be optimisation with no evidence that it addresses the mechanism. **The earlier justification for stopping — "nothing is near the budget" — was also simply wrong**, and is corrected here rather than quietly dropped.

**Verification limitation.** Full-suite local verification became unreliable under sustained load: suite duration degraded 5.6m → 13.3m → 19.4m across one session as the machine saturated. A post-conversion full-suite distribution was therefore **not obtained**. That is neither evidence that the implementation is broken nor evidence that it is safe. **CI, running from a clean checkout, remains the honest verification environment.**

> **⚠️ One factual correction, recorded rather than silently amended. [2026-08-28]** The plan for this cycle stated that all three browser contexts in `profile-collection.spec.ts:312` are part of the test's subject. **That was wrong.** Only `page` and `secondPage` are asserted from; **nothing is ever asserted from `thirdPage`**, which exists solely because a UI signup needs a browser to happen in. Once the third user is created through the API that context has no remaining purpose. **It is retained unchanged for this cycle** — signed in through the real login form so it still holds a genuine session — because removing it would change the shape of the test rather than its setup. Recorded so a later reader does not mistake it for a deliberate part of the subject.

**Unchanged:** `playwright.config.ts`, the 30s default, `retries: CI ? 2 : 0`, `workers: 1`, the CI workflow, `package.json`, and all production code. No timeout was raised, no retry added, no assertion weakened.

---

---

## 13. Observability

Minimal and honest at this stage:

- **Errors** — Sentry or equivalent, on both server and client.
- **Ingestion health** — job queue depth, failure counts, upstream error rates. This is the most likely thing to break silently, since it fails without any user reporting it.
- **Structured logs** for ingestion and moderation actions.
- **Uptime check** on the app and a representative album page.

No custom metrics pipeline, no dashboards beyond what the platforms provide. Add them when a real question needs answering.

---

## 14. Security

- **Auth is delegated** to Supabase — we hash nothing and mint no sessions.
- **Authorisation in the service layer**, tested directly (§12).
- **Secrets** in Vercel and Supabase environment configuration; never in the repository. The service-role database key is server-only and must never reach the client.
- **Rate limits** on the abuse-prone write paths. Catalogue additions are capped at **30 per hour and 100 per day per user** — protecting both search quality and the shared MusicBrainz request budget. Reviews, follows and reports need ceilings too; their numbers are not yet set.
- **Input validation** at every server boundary via a schema validator; review bodies sanitised on render.
- **Admin surface** gated by a role check and separated from user-facing routes.
- **Database privileges are set by revoking, not only by granting. [DECIDED 2026-09-04]** Postgres and Supabase both hand out defaults that an explicit `grant` does not remove, so a migration naming its intended audience restricts nobody. Measured on 2026-09-04, before correction: `anon` held `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` on all 20 `public` tables, and `PUBLIC` held `EXECUTE` on 9 of 10 project-authored functions. **Not a leak and not exploitable** — see `§16.5`, which holds the evidence, the per-function intent and the boundary.

Per `docs/claude-course-analysis.md` §10, the course's own advice — don't put unaudited authentication in front of real user data — is taken at its stated standard: **a security review before launch**, focused on auth flows, authorisation checks, and the admin surface.

---

## 15. Privacy

- **Everything user-generated is public** by decision. No viewer-permission filtering anywhere, which is a substantial simplification of every read path — and a deliberate bet, since retrofitting private accounts later is expensive.
- **Hard deletion** removes all user-authored rows. Because averages are computed on read (§16), no recomputation is required.
- **Export** produces the user's collection, ratings, reviews and lists in a portable format.
- **Email addresses are never public**, and blocking is labelled truthfully — it prevents interaction, it does not hide content.

---

## 16. Data access patterns

Confirmations of decisions made in `docs/data-model.md`, recorded here for architectural completeness:

- **Averages computed on read** from non-null ratings. No stored aggregates, so no drift, and deletion needs no cleanup.
- **Feed is a query over the materialised `Activity` table**, filtered by the follow graph, ordered by time. **Not fan-out-on-write** — no per-follower copies are written. Fan-out becomes worth considering only when feed queries measurably degrade under real load, and that threshold is far away.
- **Events reference live data**, so edits propagate and undone actions remove events.
- **Follower and following counts are computed on read**, not denormalised. **[DECIDED 2026-08-30, built]** The same reasoning as averages: no stored aggregate, no drift, and account deletion needs no decrement pass. `collection_entries.relisten_count` is the one denormalised counter in the product and is not a precedent for this — it exists because the insert and the increment must be one transaction for the counter to be trustworthy at all, which is not true of a count anyone can recompute exactly from an indexed column. Two `head: true` counts per profile render, each served by its own index.
- **A count and the list it links to must apply the same filter.** Both follow counts exclude suspended and banned accounts, because the count is the navigation into the list and a count of five above a list of four is a discrepancy the reader cannot explain. Recorded because the tempting implementation counts rows and filters only the list.

### 16.1 The feed query — where the follow-graph filter lives

**[DECIDED 2026-09-01. Built 2026-09-01 — see the correction below.]** This resolves the bullet above into a concrete shape. The bullet's decisions are unchanged: still a query over the materialised `Activity` table, still filtered by the follow graph, still ordered by time, still **not fan-out-on-write**.

**`/feed` is fully dynamic, per-user and uncacheable**, which §7 already records for the feed surface and which nothing here changes.

**The query is a `security invoker` Postgres function, `feed_activity`, returning the full joined feed payload in one round trip.** Its body uses the simple global-filter shape:

```sql
where a.actor_id in (select followee_id from follows where follower_id = p_viewer)
```

**Why a function rather than the PostgREST client the rest of the read path uses.** PostgREST cannot express a subquery in a filter, so the alternative is fetching the follow graph first and passing the followee ids as literal UUIDs in the URL. Measured against the local stack on 2026-08-31: that request succeeds at **207 followed accounts and returns `HTTP 414` at 209**, and the ceiling falls further as the `select` grows, because the id list and the select string share one URL budget. **That is a cliff, not a curve** — the surface simply breaks for that user, with no degraded mode and no warning as they approach it, which is unlike every other scaling limit in this system. The function keeps the filter in SQL, where no URL is involved.

**`security invoker` is a correctness requirement, not a style choice.** `reviews_public_read` restricts a review with `status = 'removed'` to its author, and RLS is what makes that true. `security definer` would bypass it and leak moderation-removed reviews into every follower's feed.

**What is deliberately not fixed here.** In every measured plan the database materialises all activity belonging to the followed set and then top-N sorts it, so cost scales with that set's whole history rather than with page size — `activity_actor_idx` serves the filter, not the ordering. **That curve is left alone**, consistent with §17 below, which ranks feed queries third among things that break and names fan-out-on-write as the mitigation _if measurement ever justifies it_. A per-actor `LATERAL` top-N shape measured better on synthetic data and **is not rejected** — it is simply not the shape chosen now, and because the query lives behind the function it can be swapped by `create or replace function`, with no contract change and no data migration.

**Pagination is keyset on `(created_at desc, id desc)`, forward-only — a deliberate departure from the numbered `?page=` convention** used by the collection and the two relationship destinations. Three reasons:

- **Drift.** A collection grows at its owner's pace; a feed grows at the top, at the pace of everyone the reader follows, while they are reading. Numbered offsets then re-show rows already passed. This appears with two active follows, so it is not a scale problem.
- **No total.** Offset pages want `count: 'exact'` to render "page 3 of 12". For a feed that label is meaningless, and the count would scan the followed set's entire history on every request — a cost no other paginated surface pays.
- **It preserves the optimisation path above.** `LATERAL` composes with keyset and bounds at _(following × page size)_; with offset it degrades as the reader pages deeper.

The cursor parser and path builder belong in the **app layer**, not `src/services/` — §19.3's test, since a native client has no query string.

**A cursor that returns zero rows is an end-of-feed state, never a 404. [DECIDED 2026-09-01]** This follows from the two properties above rather than from presentation, which is why it is recorded here as well as in `product-spec.md` §6:

- **No total is computed**, so the route cannot establish that a cursor is past the end. All it observes is an empty result, which it cannot distinguish from a cursor pointing at a since-deleted row.
- **The sequence is mutable.** Events are ordered by write time, but the _set_ is the follow graph's, and that changes: following someone new inserts their older events below a position the reader has already passed. A cursor yielding nothing today can legitimately yield rows tomorrow.

Together those make "past the end" **unavailable as a permanent route fact**, so the offset destinations' `page > totalPages` → `notFound()` convention cannot be reproduced — it depends on a count this surface deliberately does not have. The behaviour is therefore an explicit end-of-feed state carrying its own route back to the first page.

**This changes nothing about the query or the pagination shape.** No look-ahead is introduced: `nextCursor` is still emitted whenever a page comes back full, so an exactly-full final page still offers `Older →` and still lands on the end state. Fetching `limit + 1` to suppress that link is a possible later refinement, **not adopted here** — it would reduce how often the state is reached without changing what happens when it is, since stale, shared and hand-edited cursors reach it regardless.

**[CORRECTED 2026-09-02] This section is built.** It opened "Recorded before implementation; nothing below is built", which was true when written on 2026-09-01 and stopped being true the same day: the feed shipped in `0b73851` and was verified by CI run #71 on that exact SHA. **The decisions above are unchanged** — only the claim about their build state was stale, and it is corrected rather than deleted so the sequence stays legible.

**Who keeps such markers current across cycles is unresolved**, and this correction does not settle it. STEP C records decisions before implementation and correctly marks them unbuilt; nothing in the cycle flips them afterwards. That is a process question for `CLAUDE.md`, raised here rather than answered.

### 16.2 The counting contract — what a count may and may not mean

**[DECIDED 2026-09-03. Built 2026-09-03]** Counts are load-bearing here because of the bullets above: follower and following counts, averages and collection totals are all **computed on read** rather than stored, so a count is not a cached convenience that can be stale — it is the answer.

**The contract, in four lines:**

| State                                      | Meaning                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `count === 0`, no error                    | **A legitimate empty result.** Nobody follows you, nobody has collected this album, the queue is drained                   |
| `count === n`, no error                    | The answer                                                                                                                 |
| **`count === null` with `error === null`** | **Not a legitimate successful state.** An infrastructure or query failure, and it must never be silently converted to zero |
| `error` set                                | A real failure, and it stays a failure                                                                                     |

**Why this needs stating at all, rather than being obvious.** A `head: true` count is issued as an HTTP `HEAD` request, and a HEAD response carries no body. The Supabase client rewrites a **404 with an empty body** into a success-shaped result — status `204`, `error` left null, `count` null — so the idiomatic `count ?? 0` reports a **confident zero** for a relation the database could not resolve. A missing, renamed or **not-yet-cached** relation therefore reads as "none", and the caller cannot tell it apart from an honest empty result. This was not reasoned about: it was reproduced against a real database, and observed in production on a profile page that reported "0 followers" while the relation was absent.

**The invariant is centralised in one shared counting boundary in `src/services/`, not repeated at each call site.** Two reasons, and the second is the load-bearing one: the invariant is uniform, so per-site checks would duplicate the same four lines with no gain; and **a boundary protects counts that do not exist yet**, where a convention protects only the ones someone remembered. The boundary is responsible for rejecting the null/null state, for preserving a legitimate zero unchanged, for letting real errors stay errors, and for **useful diagnostics** — a non-404 HEAD failure otherwise raises an error whose message is the empty string, which is thrown but untraceable.

**Every service-layer `head: true` count must go through that boundary**, enforced by lint rather than by reviewer memory, and scoped to `src/services/**` with the boundary itself exempt — **and colocated `*.test.ts` files exempt too, since unit tests live inside that same glob**. **Test-suite counts are deliberately outside it** — they assert against a schema they control, and a silent zero there fails the test rather than misinforming a reader.

**The boundary's exact API is deliberately not specified here.** That is an implementation decision, and fixing a signature in the architecture document before the code exists would be recording a guess as a constraint.

**One class of count is explicitly outside this contract as written:** a count returned alongside rows from an ordinary range query, where an error check already precedes any use of the count. Those do not exhibit the HEAD-specific failure and are excluded deliberately, not overlooked. If the same failure mode is ever demonstrated there, this line is what should be revisited.

### 16.3 Notifications — directed, private, and disjoint from the feed

**[DECIDED 2026-09-03. NOT BUILT — Phase 3 slice 5, decisions recorded before implementation.]** `Notification` is the counterpart to §16.1's feed: `Activity` is **broadcast** — things you did, shown to whoever follows you — while a notification is **directed**, something another person did to you. The two carry disjoint event types and neither writes the other's rows.

**Phase 3 ships exactly two types: `followed` and `review_liked`.** `list_liked` is **deferred until Lists and `ListLike` exist**, and this is a phase boundary rather than a product rejection — `product-spec.md` §5 and §6 both keep list likes in the finished surface. The reason is concrete rather than cautious: there is no table for `list_like_id` to reference, **so the foreign key cannot be created at all**, and an enum member no code can write is speculative schema. `activity_type` shipped with exactly the values its slice used; this follows that precedent.

**`list_liked` is now decided and is the third type. [DECIDED 2026-09-04 — Phase 4 slice 2, not built.]** The deferral above is discharged: `ListLike` is decided in `data-model.md` §5, so the foreign key has something to reference. `Notification` therefore gains a third subject column, `list_like_id`, alongside `follow_id` and `review_like_id`, on the same terms — nullable, cascading, and carrying its own one-per-source uniqueness.

**This is the case the `else false` was written for, and it is the slice that must extend it.** The `CASE` rejects a `list_liked` row until it gains a matching `WHEN`, which is the intended fail-closed behaviour rather than an obstacle. **Adding a third subject column also changes what the two existing branches must assert** — each must now exclude the new column as well — and that is a property of the constraint's shape, not an implementation detail.

**Nothing about `Activity` changes.** A list like remains a notification trigger and never a feed event, unchanged from §4's standing decision. `list_created` and `list_updated` belong to slice 3 and are not decided here.

**A notification represents the current existence of its source action. It is not a historical audit event.** Undoing the source removes the notification; re-creating the source produces a **new** one; nothing is retained as history. `data-model.md` §7 requires that the page never report something that has been undone, and that requirement is what settles this.

#### Integrity, and why uniqueness is not optional here

**The source writes are idempotent in a way that would otherwise duplicate notifications.** `followUser` and `likeReview` both return the **pre-existing row** when they hit a unique violation, and neither can distinguish "I created this" from "this already existed". A write path that created a notification after every apparently successful call would therefore emit a second one on a double-submit or a retry.

**`unique (follow_id)` and `unique (review_like_id)` make that ambiguity irrelevant** — the write can insert unconditionally and tolerate the violation, exactly as `activity.ts`'s `record()` already does. Both columns are nullable and Postgres permits many NULLs under a unique constraint, so `followed` and `review_liked` rows coexist without a partial index.

**The subject/type consistency constraint carries an explicit `ELSE false`.** `activity_subject_matches_type` has no `ELSE`, so a `CASE` with no matching branch returns `NULL`, `NULL` satisfies a `CHECK`, and a future enum value is **silently unconstrained**. That gap is tolerated on `activity` and deliberately not reproduced here — this table is expected to gain `list_liked` later, which is precisely the case that would slip through.

**Every lifecycle transition is a cascade, not a second write.** Unfollow, unlike, review deletion, and actor or recipient account deletion all remove notifications through foreign keys.

#### Privacy — the first genuinely private table in this schema

**A notification's existence is private to its recipient.** The actor's identity may be displayed, because profiles are already public; the row itself must never be queryable by anyone else.

> **This is a material departure from every social table built so far, and it is the slice's highest-risk detail.** `follows`, `activity` and `review_likes` are all `*_public_read` with `qual = true`, which is correct for them — everything user-generated is public. **A read policy copied from any of them would expose every user's notifications.** The read policy is `recipient_id = (select auth.uid())`, and `anon` gets nothing.
>
> **Read and write are scoped to different people**, which is unusual enough to state: the **actor** inserts, the **recipient** reads. The insert policy is `actor_id = (select auth.uid())` and the two must not be collapsed into one.
>
> Clearing unread state needs an update, and RLS cannot restrict columns — so it is bounded by a **column-level `grant update (read_at)`**, letting a recipient clear their own state without rewriting `type` or `actor_id`. No delete grant exists; cascade does that work.

#### The query is a direct table read, not a function

**§16.1's rationale does not transfer, and inheriting its machinery without its reason would be cargo-culting.** The feed needed a Postgres function because _PostgREST cannot express a subquery in a filter_ — `actor_id in (select followee_id …)`. A notification query has no subquery: `recipient_id = auth.uid()` is a single-column equality that RLS expresses natively and PostgREST filters trivially.

**If a concrete payload-join limitation appears during implementation, that is a new decision to raise, not a function to introduce quietly.**

**Pagination is keyset on `(created_at desc, id desc)`, forward-only**, matching the feed rather than the numbered pagination used by the collection and the two relationship destinations. §16.1's reasons apply almost verbatim: a notification list grows at the top while it is being read, so numbered offsets re-show rows already passed, and an offset page wants `count: 'exact'` on every request.

#### Read semantics and the unread count

**Read state is per item.** A notification stays unread until that specific notification is interacted with; **rendering the page marks nothing**. New arrivals while the page is open remain unread, and pagination cannot clear items the reader never saw — a property model A ("opening marks everything read") cannot offer, since its correctness depends on the unread set fitting one page. **No mark-all-read control in this slice.**

**Navigation must never depend on the read write succeeding.** A recipient who could not reach a review because a `read_at` update failed would be a worse outcome than a notification that stays bold. Marking read is idempotent, so a lost write costs one stale unread and nothing more.

**The unread count is computed on read** — `read_at is null`, for the authenticated recipient, **through `countRows` with `COUNT_ONLY`** per §16.2, which lint enforces. **No denormalised counter**, following the same reasoning §16 gives for follower and following counts: no stored aggregate, so no drift, and none of the four cascade paths needs a decrement. **No query at all for signed-out visitors.**

Note the count renders in global navigation, so it executes on **every page render for a signed-in user** — a third query in a header component that already awaits the user and profile. That cost is accepted rather than optimised away, because there is currently **no volume evidence anywhere** to optimise against. If measurement later shows a real problem, that is its own decision.

#### Surface

`/notifications` — already a reserved handle — newest first, follower and review-like items, a read/unread visual distinction, items navigating to their target, an unread count in global navigation for signed-in users, and an empty state. **No email, no push, no per-type preferences, and no list-like notifications in Phase 3.**

#### Trigger and atomicity boundary

A successful follow creates one notification for the followee; a successful review like creates one for the review's author — **available without an extra query**, since `likeReview` already reads it for the self-like check. **Self-follow is impossible** (`follows_no_self_follow` is a check constraint). **Self-like remains a service-layer guarantee only** — the database permits it by design — so a user never receives a notification for their own review because the service refuses the like, not because the schema forbids it. **No Activity row is written.**

**Activity's write-pair atomicity `[OPEN]` is not a prerequisite**, and the failure modes differ in kind:

- **Source fails → no notification, guaranteed twice** — the write path returns first, and the foreign key cannot reference a row that does not exist.
- **Source succeeds, notification write fails → the source stands and the notification may be missing.** Under-delivery, not a false claim.

Activity's sharp case — a `rated` event outliving a cleared rating — has no analogue here, because deletion is the database's job rather than a second write's.

#### Notification delivery is best-effort, and the source action is authoritative

**[DECIDED 2026-09-03, after the section above.]** A follow or a review like is the thing the user asked for. **A notification is secondary delivery on top of it**, so a notification failure must never turn a succeeded source action into an error the caller reports.

- **Source succeeds, notification write fails → the source still succeeds from the caller's perspective.** The failure is caught at the integration boundary, not propagated out of `followUser` or `likeReview`.
- **It is not silently discarded.** The error is logged server-side with enough context to diagnose it — the notification type, the source row id, and the error itself.
- **Source fails → no notification is attempted.** Unchanged.

**This deliberately diverges from Activity**, whose write pair propagates. The reason is the asymmetry §16.3 already records: an Activity failure can leave a _claim that has stopped being true_, while a missing notification is only under-delivery. Divergence is the point, not an inconsistency to reconcile later.

> **Do not let this read as guaranteed delivery.** The contract is **best-effort secondary delivery after a successful source mutation**. Nothing here weakens a constraint, a policy or a grant to achieve it — the failure is caught above the database, never designed around it.

**Logging note, recorded because it sets a small precedent.** `src/` currently contains no `console.*` calls at all; the only logging in the repository is in `scripts/*.mjs`, and `albums/[mbid]/page.tsx`'s `after()` catch swallows with a comment and no log. This uses `console.error` — the minimal mechanism the platform already captures — rather than introducing logging infrastructure for one call site.

#### Mobile navigation carries the unread indicator on **You**, not a fifth tab

**[DECIDED 2026-09-03, after the section above.]** `MobileTabBar` keeps its four tabs — Browse, Search, Feed, You. **The unread indicator attaches to the existing "You" tab**, and notifications are reached on mobile through the user's personal surface.

Notifications remain a **desktop and global navigation destination** with their own link and count. The mobile treatment is the minimal badge required to expose unread state; **the tab bar is not otherwise redesigned**, and adding a fifth tab — which would narrow every tab and alter a component the design foundation locked — is rejected.

#### `[OPEN]` — resolved at implementation review, recorded for the trail

The four questions this section originally deferred were resolved during STEP D, against the code rather than by guess. **The mark-read dispatch** is a real link to a route that marks read and then redirects, with the write awaited inside `try`/`catch` so navigation proceeds regardless — and `prefetch` disabled, since a prefetched item would otherwise be marked read on hover. **The payload embed** works directly: every hop from notification to album is a single foreign key, so the two-FK trap does not apply — but the subject embeds must not use `!inner`, or every notification of the other type is silently filtered out. **Badge presentation** is a capped numeric count, and **empty-state copy** follows the feed's existing tone; both are implementation-level.

#### The pagination cursor is canonicalized before it reaches the filter

**[DECIDED 2026-09-03, after a defect found at implementation verification. NOT BUILT.]**

**The defect.** `cursorFrom` validated its timestamp with `Date.parse`, which accepts strings PostgREST cannot parse — `"2020-01-01,"` among them. The value was then interpolated into the `.or()` keyset filter, where a comma is **grammar rather than data**, producing `PGRST100 "failed to parse logic tree"`. `listNotifications` threw and `/notifications` returned **500** for a hand-edited URL, contradicting the documented rule that a malformed cursor falls back to the first page.

**Not a security hole, and it should not be described as one.** Row-level security is enforced by Postgres independently of the filter text, so no row belonging to anyone else was reachable. This is PostgREST grammar breakage, not SQL injection.

**Why the feed never had it.** `listFeed` passes its cursor as **named RPC parameters**, which never enter a filter grammar. The identical validation is harmless there and unsafe here, and copying it without noticing the different consumer is the actual mistake.

**Why the fix is not "bind the values".** `.or()` is the only disjunction the query builder offers, and it takes grammar as a string; `(a < x) OR (a = x AND b < y)` cannot be expressed by `.lt()`, `.eq()`, `.not()` or `.filter()` in any combination. Percent-encoding does not help either — the transport encodes both positions identically, and PostgREST decodes the `or=(…)` payload back into grammar before parsing it. **The only construct in this stack that genuinely binds a cursor value is an RPC**, which is disproportionate database infrastructure for one list.

**The decision: strict validation, then canonicalization, and only canonical values reach the filter.** Both cursor halves are validated and then **re-emitted from the validated representation** rather than passed through as user text. The admitted alphabet contains no `,`, `(`, `)` or `"`, so arbitrary text cannot become grammar.

> **This is a correctness and security boundary, not formatting.** And it is **not equivalent to a bound SQL parameter** — the safety property is narrower and worth stating exactly: only machine-checked values over a closed alphabet enter the PostgREST grammar. Anything failing validation never reaches the database at all; it falls back to page one.

**The timestamp is canonicalized by validated re-emission, not by a `Date` round trip. [AMENDED before implementation, and the amendment is compelled by measurement.]** The decision as first written specified `new Date(parsed).toISOString()`. That was checked against the real stack before building anything and **must not be used**:

|                                        |                                                       |
| -------------------------------------- | ----------------------------------------------------- |
| Postgres stores, and PostgREST returns | **microseconds** — `2026-09-03T08:40:31.106813+00:00` |
| `new Date(…).toISOString()` emits      | **milliseconds** — `2026-09-03T08:40:31.106Z`         |

The cursor would land **813µs earlier than the boundary row**, so rows older than that row but inside the same millisecond fall outside both branches of the predicate — **silently skipped, never shown on either page.** It would also make the tie-break branch effectively dead, since a real row rarely ends in exactly `.xxx000`. That is the same silent-skipping failure the over-fetching alternative was rejected for, reintroduced through the canonicalizer.

**Re-emitting the regex-matched text instead preserves the microseconds exactly while keeping the alphabet closed** — the identical technique the UUID half already uses.

**The validator must accept every cursor this implementation emits**, and PostgREST's rendering is more variable than it looks: trailing zeros are trimmed, so the fractional part carries **anywhere from zero to six digits** — `.106813`, `.10681`, `.5`, `.1`, or no fractional part at all for a whole second. A regex tighter than that would reject legitimate cursors and silently strand readers on page one.

**Unchanged by this amendment:** the keyset semantics remain exactly `created_at < before OR (created_at = before AND id < before_id)`, ordered `created_at desc, id desc`; the cursor format and page size are untouched; and no RPC, function, view, migration or schema change is introduced.

---

### 16.4 Lists — identity first, consumers later

**[DECIDED 2026-09-03 — Phase 4 slice 1. Nothing here is built.]** This records the decisions an implementation needs in order to be unambiguous. Where something is deliberately left open, it says so.

#### Routes, and why the identifier is a UUID

| Route             | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `/lists/[id]`     | The public list page. **`[id]` is the List's database UUID** |
| `/[handle]/lists` | A profile's lists                                            |

**`lists` has been a reserved handle since Phase 0**, alongside `feed`, `notifications`, `albums`, `artists` and `search` — **every one of which is a top-level route**. The reservation anticipated this route rather than coinciding with it, so the top-level shape is the existing convention, not a new choice. `/[handle]/lists` matches the existing `collection`, `followers` and `following` sub-routes.

**No slug in slice 1, and this is a decision rather than a deferral.** A list already has database identity; a slug would add generation, uniqueness, and mutation-on-rename semantics to buy readability no authoritative document has asked for. A UUID also gives a list exactly **one** address, avoiding the two-URLs-one-page problem the notifications first page was designed around. **A human-readable slug is reconsiderable as a new product decision on demonstrated need** — it is not an outstanding obligation.

#### Ownership, visibility and access

**Lists are public** (`product-spec.md` §Lists, decided 2026-09-03) and **carry no visibility column** — see `data-model.md` §5.

**The access model follows `review_likes` rather than `notifications`.** Public read for `anon` and `authenticated`; write restricted to the owner via `auth.uid() = user_id` in both `USING` and `WITH CHECK`. **Grants are required alongside the policies** — they are evaluated first, and their absence looks like an RLS bug.

**Unlike a review like, a list is editable**, so `lists` and `list_items` need `update` grants that `review_likes` deliberately withholds. That difference is the reason to state it: the review-like precedent is being followed for read/write scoping, **not** for its no-update stance.

#### Deletion

Hard delete, per `CLAUDE.md`. Profile → lists → items cascade downward. **Album deletion removes the `ListItem` and never the List**, so catalogue maintenance cannot destroy user-authored curation.

#### Ordering

**`position` is meaningful only when `is_ranked`, and reordering leaves positions contiguous.** That invariant is decided.

**Positions are maintained on every list, ranked or not**, so that toggling ranking preserves the order in both directions — see `data-model.md` §5, which owns the field semantics. **"Meaningful only when ranked" is not "maintained only when ranked"**, and building it as the latter would silently lose a user's curation the first time they toggled the flag.

> **The mechanism that maintains it is explicitly an implementation decision, and is not made here.** Whether reordering is a single database function or a client-computed rewrite, how concurrent reorders are handled, and what is indexed are STEP D questions. **Sparse or fractional positioning is not to be introduced speculatively** — the invariant above is a contiguity guarantee, not a hint toward a gap-based scheme.

#### Two constraint seams the later slices must not miss

**These are recorded together because they fail in opposite directions, and only one fails loudly.**

| Seam                                                         | Behaviour on a new enum value                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications_subject_matches_type` — ends **`else false`** | **Fails loudly.** A `list_liked` row is rejected until the `CASE` gains a matching `WHEN`                                                      |
| `activity_subject_matches_type` — has **no `ELSE`**          | **Fails silently.** A `CASE` with no matching branch returns `NULL`, `NULL` satisfies a `CHECK`, so the new type is **entirely unconstrained** |

**Slice 1 adds no activity type and no notification type, so it closes neither seam and must add no speculative enum value.** The obligation falls to the first slice that adds one: the activity slice must close the `ELSE` gap in the same migration that adds `list_created`, and the likes slice must extend the notifications `CASE` when it adds `list_liked`.

#### Sequencing

**Slice 1 establishes identity; the later slices consume it.**

1. **Slice 1 — identity and surfaces.** `lists`, `list_items`, CRUD, membership, ranking, reordering, the list page and profile surfacing.
2. **Slice 2 — list likes.** Needs `lists.id` for `list_likes.list_id`, then `notifications.list_like_id`, the enum value, and the `else false` extension. ~~**`ListLike` is still `[INFERRED]` in `data-model.md` §5 and requires its own product decision first.**~~ **DECIDED 2026-09-04** — `ListLike` and the no-self-like rule are settled in `data-model.md` §5, so that precondition is discharged. **Nothing is built.**
3. **Slice 3 — list activity.** Needs `lists.id` for `activity.list_id`, the enum values, the `ELSE`-gap closure, and the undecided feed-worthiness and debounce semantics.

**The dependency is one-directional and mechanical**, which is why slice 1 is worth doing alone: `list_liked` was deferred in Phase 3 because there was no table for the foreign key to reference at all, and slice 1 removes exactly that blocker without pre-empting either decision that follows it.

### 16.5 The privilege boundary — a grant states intent, only a revoke enforces it

**[DECIDED 2026-09-04. Nothing here is built.]** This records a boundary the repository already believed it had. It is a **grants decision only** — no RLS policy, no schema and no application code changes.

#### The finding, measured rather than reasoned

Measured against the local database on 2026-09-04, and reproduced over HTTP:

| Measurement                                                            | Result                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anon` privileges on the 20 tables in `public`                         | **`TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` on every one**                                                                                                                                                          |
| Project-authored functions in `public` carrying `EXECUTE` for `PUBLIC` | **9 of 10** — `add_list_item`, `remove_list_item`, `reorder_list_item`, `ensure_collection_entry`, `feed_activity`, `search_albums`, `search_artists`, and the two trigger functions `set_updated_at`, `sync_relisten_count` |
| The exception                                                          | **`claim_ingestion_jobs`**, the only function carrying an explicit `revoke`                                                                                                                                                  |
| `POST /rest/v1/rpc/feed_activity` with the `anon` key                  | **HTTP 200**                                                                                                                                                                                                                 |

That last row is the one that matters, because `create_feed_activity.sql` grants execute to `authenticated` alone and says in a comment: _"there is nothing here for `anon` to read."_ **The comment states an intent the database does not enforce.**

> **Two figures in this table were wrong when first written, and are corrected rather than quietly replaced. [CORRECTED 2026-09-04 during STEP D]**
>
> It read **"7 of 8"** and **"`TRUNCATE`, `TRIGGER` and `REFERENCES`"**. Both understated the finding, and both for the same kind of reason — a measurement that could not see what it was looking for.
>
> **The function count missed the two trigger functions.** `set_updated_at` and `sync_relisten_count` carry a **null `proacl`**, and a null ACL does not mean owner-only — it means the built-in default applies, which for a function includes `EXECUTE` to `PUBLIC`. The original count matched on the ACL string `=X/`, which a null ACL does not contain. `sync_relisten_count` is additionally `security definer`.
>
> **The privilege list missed `MAINTAIN`.** On Postgres 17 the default ACL is `Dxtm` — the `m` is `MAINTAIN`, and `information_schema.role_table_grants` does not report it. Raw `relacl` does: `anon=rDxtm/postgres` on `albums`.

#### Why it happens, and why the existing convention produces it

**Postgres grants `EXECUTE` on a newly created function to `PUBLIC`**, and Supabase's default privileges grant table privileges to `anon` and `authenticated`. An explicit `grant … to authenticated` therefore **adds** a grant and removes nothing.

So a migration that names its intended audience **restricts nobody**. Seven migrations in this repository read as though they close a boundary and do not close it, and two further functions were never given an audience at all — they simply inherited `PUBLIC`. `claim_ingestion_jobs` is the sole counter-example, and it is correct precisely because it carries `revoke all on function … from public, anon, authenticated` — the pattern was known and applied once.

**`CLAUDE.md`'s Phase 0 convention produces this outcome as written.** It requires explicit grants and says nothing about revoking defaults, and it is written about tables rather than functions. It is amended in the same cycle as this section, and the amendment is the part that stops the defect recurring.

#### What this is not

**Not a data leak.** The seven reachable functions are all `security invoker`, so RLS decides what they can see. `feed_activity` aggregates rows that are world-readable anyway, so its response contains nothing `anon` could not already select directly.

**Not exploitable for destruction.** PostgREST exposes no verb for `TRUNCATE` or `CREATE TRIGGER`, and no `security definer` function is `anon`-executable, so the table-level privileges have no reachable path through the API.

**Not urgent, and it must not be written up as an incident.** The honest description is a **defence-in-depth gap plus a false statement in the record**. The second half is the reason to act: a future security judgement made by reading those grant lines would be wrong.

#### The decision

**Both halves are corrected together, as one boundary.** They differ in severity — the function grants contradict a written claim and are reachable, the table privileges are unexamined inherited defaults that are not — but they share one root cause and one fix, and the convention being amended covers tables and functions alike. Correcting only the functions would leave `CLAUDE.md` describing a table-side state the database does not have, which is the same false-record failure at one remove.

Per-function intent, decided rather than pattern-matched:

| Function                                                                            | Intended audience                   | Why                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_albums`, `search_artists`                                                   | **`anon` retained, explicitly**     | Signed-out search is a shipped feature. The access is deliberate, so it is granted rather than inherited                                                                                                                                                                                                                                                                                                  |
| `feed_activity`                                                                     | **`authenticated` only**            | Confirms the intent its own migration already records. A feed is a per-viewer query, not public content                                                                                                                                                                                                                                                                                                   |
| `add_list_item`, `remove_list_item`, `reorder_list_item`, `ensure_collection_entry` | **`authenticated`, `service_role`** | Each is a mutation. `anon` holds no DML grant on the underlying tables, so execution already fails — the revoke makes the boundary true rather than incidental                                                                                                                                                                                                                                            |
| `set_updated_at`, `sync_relisten_count`                                             | **No role**                         | Trigger functions. Unreachable through PostgREST, which does not expose `trigger`-returning functions, so the gain is principle rather than exposure — but `sync_relisten_count` is `security definer`, and that combination with `PUBLIC EXECUTE` is worth removing. **`EXECUTE` is checked when a trigger is created, not when it fires**, so the triggers keep working; verified by test, not inferred |
| `claim_ingestion_jobs`                                                              | **`service_role` only, unchanged**  | Already correct. Re-revoking it would imply it was not                                                                                                                                                                                                                                                                                                                                                    |

**Table privileges.** `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` are revoked from `anon` and `authenticated` across `public`. **`service_role` keeps everything**, which is what makes this safe for the test suite: integration tests truncate through a `service_role` admin client (`tests/integration/count.test.ts`), never as `anon` or `authenticated`.

**Future objects still inherit all of it, and that is deliberate. [DECIDED 2026-09-04]** The systemic cause is `pg_default_acl`: the `postgres`-owned default for schema `public` grants `Dxtm` on new tables to `anon`, `authenticated` and `service_role`, so **every table a future migration creates arrives with the same four unwanted privileges**. Changing default ACLs is a separate decision and is **out of scope here** — it is a broader change whose interaction with Supabase's own provisioning is unexamined. **Until it is taken, the control is the amended `CLAUDE.md` convention**, which is process rather than mechanism, and that difference should not be blurred: this section describes **observed current privileges**, not a guarantee about objects that do not exist yet.

**Every privilege the application uses is preserved.** The explicit `select` / `insert` / `update` / `delete` grants are untouched.

#### Deliberately outside this boundary

**`feed_activity` still takes a caller-supplied `p_viewer`.** It is `security invoker`, so **any authenticated caller can request any other user's feed**, and revoking `anon` does not change that. It is not a leak — the underlying rows are world-readable — but it is a real observation and **this decision must not be read as having addressed it**. It needs its own decision.

Also excluded: RLS policies of any kind; `auth`, `storage` and other non-`public` schemas; extension-owned functions such as `pg_trgm`'s, which are not project-authored and raise a different question.

#### Reversibility

**A revoke is undone by the corresponding grant**, so this is among the more reversible changes in the project. The risk is not permanence but blast radius: the failure mode is `permission denied`, which `CLAUDE.md` warns reads like an RLS bug, and **this cycle carries no application code**, so the entire effect lands on the database at the moment the migration is applied.

---

## 17. Scalability — what breaks first, and when

Honest ordering of what would need attention, rather than premature optimisation:

1. **Ingestion throughput.** The one-request-per-second ceiling is the hardest constraint in the system. Seeding a large catalogue takes real time. _Mitigation: bounded, additive expansion runs, and a job queue that absorbs enrichment._ **The former mitigation read "seed a modest subset; grow on demand", and that is superseded (`product-spec.md` §8.9, 2026-08-23):** the catalogue is open-ended in breadth and completion-oriented in depth, so growth is deliberate rather than demand-driven, and this is the constraint it lands on hardest.
2. **Search relevance.** Degrades with catalogue size before it degrades with traffic. _Mitigation: the service-layer boundary makes swapping engines contained._ **Now the load-bearing one.** §10 justifies Postgres on the grounds that the hard problem is disambiguation, naming the popularity signal as one of three levers; §8.9 confirms that lever is **legitimately sparse**, and `product-spec.md` §8.10 faults 1 and 2 leave the other two with known defects. Catalogue depth pushes on all three at once. **Whether search precision is settled before or after expansion is a planning question, deliberately unanswered here.**
3. **Feed queries.** Fine for a long time; a user following thousands of very active people is the first stress case. _Mitigation: fan-out-on-write, if measurement ever justifies it._
4. **Discovery aggregation.** Computing "this week" over all activity gets expensive eventually. _Mitigation: scheduled precomputation, already the plan._
5. **Artwork storage.** Grows linearly with catalogue; cheap for a long time.

None of these need addressing before launch. All are listed so that when something slows down, the cause is already understood.

---

## 18. Verification required before implementation

Claims in this document that must be confirmed against current documentation rather than assumed:

| Item                                             | Status                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple / iTunes Search API terms**              | ✅ **Resolved.** Terms do not permit our use, and ~20 req/min is too tight. Rejected — see §7                                                                                   |
| **Deezer API terms**                             | ✅ **Resolved.** Prohibits storing images. Rejected — see §7                                                                                                                    |
| **MusicBrainz rate limit and User-Agent policy** | ✅ **Confirmed.** 1 req/sec per IP; `503` on all requests when exceeded; User-Agent with contact details mandatory                                                              |
| **Cover Art Archive**                            | ✅ **Confirmed.** Release-group front endpoints at 250/500/1200px, `404` when absent, no rate limit                                                                             |
| **ListenBrainz statistics endpoints**            | ✅ **Confirmed.** `/1/stats/sitewide/release-groups`, public, `range` and `count` parameters. ⚠️ **MBIDs are optional in responses** — entries without one must be filtered out |
| **Supabase Auth capabilities**                   | ✅ **Confirmed in Phase 0.** Email/password working. Google OAuth still unbuilt — see `docs/deployment.md` §4                                                                   |
| **Next.js caching semantics**                    | ⏳ Outstanding. Matters from Phase 1, when album pages become the first genuinely cacheable surface                                                                             |

---

## 19. Long-term architectural constraints

**Recorded 2026-08-22.** Defensive constraints, not a roadmap. Each exists so that a direction recorded in `product-spec.md` §10 stays **possible** rather than becoming expensive by accident. **None authorises building anything**, and none is a product decision.

They are stated because the cheapest moment to preserve an option is before the first thing that would foreclose it.

### 19.1 Canonical identity stays MusicBrainz-shaped; providers are enrichment

**Constraint: no catalogue entity is ever keyed, primarily or uniquely, by a streaming provider's identifier.** **Promoted to a non-negotiable rule in `CLAUDE.md` on 2026-08-23** — free to state, expensive to violate, and the first integration is where it would go wrong casually.

longplayr owns music identity and user relationships. It does not own the streaming catalogue. A Spotify, Apple Music or YouTube identifier is an **attribute attached to** an album or track we already identify by MBID — never the thing that identifies it.

**Currently true by absence**, and verified: no `spotify`, `apple_music`, `provider_id` or `external_id` appears anywhere in `src/` or `supabase/`. The constraint is recorded now because the first integration is exactly where it would be violated casually.

This is consistent with what already exists: `upstream_payloads` is keyed `(source, source_id, kind)` rather than assuming MusicBrainz, and `product-spec.md` §6 already places **outbound streaming links** on the album page. Links out are in scope; identity is not.

**A provider cross-link is evidence about identity, never a determination of it. [DECIDED 2026-08-24]**

The constraint above says a provider identifier may never _be_ an identity. This is the operational half: a provider identifier may not _establish_ one either.

When MusicBrainz asserts that a Spotify, Discogs or other provider URL belongs to an artist, that is an upstream claim of exactly the same standing as any other upstream field — editable by anyone, occasionally wrong, and **not self-verifying**. Treating it as proof is how a name collision becomes a wrong catalogue row.

**Three facts must be kept distinct. They are not interchangeable, and they do not rank equally:**

| Fact                                                                 | Provenance | Standing                     |
| -------------------------------------------------------------------- | ---------- | ---------------------------- |
| **A** — MusicBrainz asserts provider URL X belongs to artist Y       | upstream   | a fallible claim             |
| **B** — we checked that provider artist X corresponds to MB artist Y | ours       | only as strong as the method |
| **C** — a human deliberately selected artist Y for the catalogue     | human      | **authoritative**            |

**C outranks B, which outranks A.** A conflicting upstream cross-link must **never** silently override a human-confirmed curated identity. Conflicts are recorded and surfaced for review, never resolved automatically.

**Correspondence must be evidenced by the works, not by the link.** Where an automated check is used, comparing discographies is strong evidence and a matching cross-link is weak. A name match alone is not evidence at all. **Automated corroboration may inform a decision; it must never reassign an artist**, because a false conflict is as easy to produce as a true one — two arose during this investigation from a title-normalisation bug alone.

**The case that established this.** Four artists named "The Wake" exist upstream. The curated artist is the Scottish band, `c2314623-e863-4fde-af8c-d6e00fec5f2c`. MusicBrainz's US-goth entity claims the Spotify URL that actually carries the Scottish band's Factory and Sarah Records discography, while the Scottish entity claims a URL belonging to a Finnish death-metal band. **Two upstream links wrong, pointing in opposite directions.** Resolution by cross-link alone would have produced a confident, wrong answer; comparing the works and then a human decision is what settled it.

**This adds no provider identifier to the data model.** longplayr stores none, and the rule exists so that the first integration does not introduce one as identity by accident. Provenance for curated identities lives in the curation workspace, outside this repository.

### 19.2 Listening sources are plural from the first one

**Constraint: any future listening-ingestion model carries a source discriminator from its first row, not from its second provider.**

Ingestion is **not decided** — see `product-spec.md` §8.11, where it remains an open question and passive scrobbling remains a §2 non-goal. This constraint applies only if it is ever built.

The reason is that providers will not behave alike. YouTube may offer nothing resembling what Spotify or Last.fm offer, so a schema shaped around one provider's semantics would need migrating on contact with the second. A single-provider design is wrong at the moment it is written, not later.

### 19.3 Domain rules live in the service layer, because a second client is plausible

**Constraint: business rules belong in `src/services/`, not in React components, page components or other client-specific presentation code.**

**The operative test, decided 2026-08-23 and recorded in `CLAUDE.md`:** _if a native client would need this rule to behave correctly, it belongs in `src/services/`; if it only shapes what the web renders, it does not._ Before that, "domain logic belongs in services" had no definition, which is precisely what lets a boundary drift.

This is not new — §4 already decided it, and §5 already records that extracting a standalone API is _"a genuine refactor but not a rewrite, provided data access stays behind a service layer rather than being scattered through components."_

What is new is the reason it matters. §4 justified it for testability; the possibility of iOS and Android clients makes it structural. **Currently honoured** — no component imports the Supabase client.

**This is not a licence to build a generic REST API now.** There is one client, and §5's reasoning that a separate API service costs real money for currently zero benefit is unchanged.

**First application to new work, 2026-08-30.** The follows slice needed a `?page=` parser and a path builder for the two relationship destinations. Both went to `src/app/[handle]/pagination.ts` rather than into `src/services/social/`, because a native client has no query string — the test doing its job on exactly the case where copying `collectionPath` would have been the path of least resistance. `FOLLOW_PAGE_SIZE` did go to the service layer: how many rows a page requests is a data-access concern any client would need, where the page number comes from is not.

### 19.4 The collection would need provenance before ingestion, not after

**Constraint: if listening ingestion is ever built, the distinction between a deliberate collection action and an automatically detected listen must exist in the model before the first imported row is written.**

`collection_entries` currently carries **no origin or provenance column**. That cuts both ways: nothing prevents an imported write, and nothing distinguishes one. Retrofitting provenance onto rows already written is materially harder than carrying it from the start — the information is simply gone.

**This does not require adding a column now.** Nothing imports listening, so there is nothing to distinguish. It is recorded so the requirement is not discovered late.

### 19.5 The catalogue model should not foreclose deeper structure

**Constraint: catalogue objects and user–object relationships stay separable, and the catalogue side should remain extensible to release-level, track-level and appearance-level structure.**

`product-spec.md` §10.7 records the direction. The domain already separates these correctly — `albums`, `releases`, `tracks`, `artists`, `album_artists` on one side; `collection_entries`, `reviews`, `relisten_events`, `favourite_albums`, `want_to_listen` on the other.

**One concrete gap, and its cost is lower than it first appeared.** `tracks` stores `id, release_id, position, medium_position, title, length_ms` — **no recording MBID and no track MBID** — so a track has no upstream identity: it cannot be reconciled when MusicBrainz corrects or merges a recording, cannot be recognised as the same recording across releases, and cannot be counted toward anything.

**But the identifiers are no longer being discarded.** `inc=recordings` returns them, and §7a keeps the response verbatim, so a stored release payload carries `$.media[*].tracks[*].recording.id`. **Verified against staging on 2026-08-23.** Adding a `recording_mbid` column later is therefore a **local reshape of stored data**, not a re-fetch of the catalogue — provided the payload backfill has run. This remains an **open decision**, not a constraint (`data-model.md` §11.10); what changed is that deferring it is now cheap.

**What this constraint does not do:** it does not make tracks social objects, does not reverse _"Not track-level"_, and does not decide how completion would ever be calculated.
