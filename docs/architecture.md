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
- **Catalogue scope** — singles must not enter the catalogue under any input shape. **The test requirement is unchanged and must not be weakened**; only its justification is now a current boundary rather than a permanent principle (§7, `product-spec.md` §8.9).
- **Authorisation** — since RLS isn't the primary mechanism, application checks are the only barrier and must be tested directly.

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
