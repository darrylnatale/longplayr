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

**Partial writes within one artist stay as they are.** A write failing mid-loop leaves the albums already written; the existence check heals it on a later run — the Durutti Column holds 32 of 37 on staging and converges without damage. **Making artist ingestion transactional is explicitly not attempted here**, and remains `[OPEN]`.

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
