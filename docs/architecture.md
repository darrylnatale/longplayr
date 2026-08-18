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

### Scope enforcement

Albums, EPs and mixtapes are ingested; singles are not. **Enforced at ingest** — an out-of-scope release group should never become a row, rather than being filtered at query time in perpetuity.

### Self-service additions

Users search MusicBrainz in-app and add any in-scope release directly, with **no admin approval**. Guarded by the scope filter and a per-user rate limit, with every addition recorded in `CatalogueAddition` for audit. **[DECIDED — C4]**

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
- **Catalogue scope** — singles must never enter the catalogue.
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

1. **Ingestion throughput.** The one-request-per-second ceiling is the hardest constraint in the system. Seeding a large catalogue takes real time. _Mitigation: seed a modest subset; grow on demand._
2. **Search relevance.** Degrades with catalogue size before it degrades with traffic. _Mitigation: the service-layer boundary makes swapping engines contained._
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
