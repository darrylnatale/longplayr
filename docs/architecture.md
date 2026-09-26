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

_Accepted tradeoff._ We give up Neon's per-PR database branching. ~~§11 mitigates with a shared staging environment.~~ **[CORRECTED 2026-09-24 — that mitigation does not exist. See §11.1.]**

**Row Level Security: not used as the primary authorisation mechanism.** **[INFERRED]** All access goes through the server-side service layer, which enforces authorisation in application code. RLS may be enabled as defence-in-depth, but a product where nearly everything is public gains little from it, and RLS misconfiguration is a well-known source of subtle data-exposure bugs. Authorisation logic should be readable and unit-testable.

---

## 6. Authentication

**Decision: Supabase Auth — email/password plus Google OAuth.** **[DECIDED — E1]**

_Alternatives considered._ Auth.js (flexible, no lock-in, more surface to own); Clerk (best DX, per-MAU pricing); hand-rolled (rejected outright — the one area where a subtle mistake is a genuine security incident).

_Why Supabase Auth._ It's already present, it handles password hashing, session management, email verification and OAuth, and it removes the highest-risk code we would otherwise write ourselves.

_Risk, stated plainly._ **This is the most expensive decision in the project to reverse.** Migrating identity providers after launch means moving real user accounts, and it cannot be done transparently. The mitigation is that our `User` table holds the profile and is keyed to the provider's identifier, so application data survives a provider change even though credentials wouldn't.

### Email confirmation: the path exists, the switch stays off **[DECIDED 2026-09-15]**

**Decision: the signup action honours `needsEmailConfirmation` and sends an unconfirmed account to a dedicated page. `enable_confirmations` is left `false` everywhere.**

**The defect this fixes exists today, independently of whether confirmation is ever turned on.** `signUpWithPassword` already computes `data.session === null` and returns it as `needsEmailConfirmation`; **the action discards the value** and redirects to `/onboarding` regardless. With confirmation enabled there is no session, so `/onboarding` bounces the user to a sign-in form. **Somebody who has just created an account is asked to sign in, with no mention of an email and no explanation.** The information needed to do better was already being produced and thrown away.

**Why the switch stays off.** `enable_confirmations` lives in `supabase/config.toml`, which is version-controlled, so **flipping it changes the local stack and CI together** — and **roughly sixteen end-to-end specs sign up and expect a session.** That is the same blast radius as the confirm-password field, for a setting whose real home is production.

**So the code becomes correct for both states and the configuration is left alone.** Enabling confirmation then becomes a deployment change the code already handles, rather than a code change made under time pressure at launch. **`current-state.md` already records that production must have it on**; this removes the code work from that critical path.

**The cost, stated rather than discovered: the confirmed path stays untested end to end.** A service-layer test can assert the branch, and **only flipping the switch exercises the whole journey.** No coverage is claimed beyond that.

**Two things deliberately out of scope.**

~~**An SMTP provider is not chosen.**~~ **[RESOLVED 2026-09-24 — Resend.]** Sending from `noreply@longplayr.dev-guides.com`, region `eu-west-1`, with the auth email limit raised to 60 per hour and **confirmation now ON in production**. The domain is a placeholder on an existing personal domain; `longplayr.com` is unpurchased and switching later is a dashboard change. `deployment.md` holds the settings. **The line above was right that it was the maintainer's decision, and it was theirs to make — this records the outcome, not a change of ownership.**

~~**There is no resend-verification path, and that is a real hole rather than an omission. [OPEN]**~~ **[RESOLVED 2026-09-15 — and one half of the reasoning was wrong.]** Without a resend, a user whose email never arrives is **permanently stuck**: they cannot sign in, and signing up again returns _"that email is already registered."_ That much held. **What did not hold was the claim that a resend "needs rate-limiting or it becomes a mail-bombing vector"** — Supabase already applies a 60-second per-address window to `/auth/v1/resend`, so the unbounded vector that sentence describes does not exist. **The warning against enabling confirmation in production stands, for a different and larger reason** — see below.

### Resend, and the limit that actually matters **[DECIDED 2026-09-15]**

**Decision: use `supabase.auth.resend()` and add no rate limiting of our own.**

**Verified against Supabase's own documentation rather than assumed** — the class of claim §18 exists for, and recorded there with its date:

| Scope                          | Limit                                                |
| ------------------------------ | ---------------------------------------------------- |
| Built-in email provider        | **2 emails per hour, project-wide**                  |
| `/auth/v1/resend`              | **60-second window per user**, whatever the provider |
| Custom SMTP or Send Email hook | The 2/hour cap becomes **configurable**              |

**Building our own limiting was considered and rejected.** It would mean **inventing an anonymous-keyed rate limiter this codebase does not have** — `product-spec.md` §8.4's limits are per _user_, and a resend request comes from someone who is not signed in — **in order to duplicate a control the vendor already applies.**

**Relying on a vendor default is acceptable only because it is written down and dated.** These are defaults that can change; §18 is where that gets re-checked rather than remembered.

**The response is identical whether or not the address has an account**, at a real cost to helpfulness. _"No account with that address"_ is the more useful sentence and **tells an attacker which addresses are registered.** longplayr is otherwise all-public — **but a handle is public and an email address is not**, which is why enumeration matters here despite that.

#### ~~The built-in email provider cannot support a launched product~~ **[CLOSED 2026-09-24 — custom SMTP configured]**

**The analysis below stands and is preserved rather than deleted**, because it is the reasoning that made the SMTP choice a prerequisite rather than an optional improvement — and because it is what the 60-per-hour limit now in place exists to answer.

**Two emails per hour is project-wide, not per user.** With confirmation enabled on the built-in provider, **the third person to sign up in any hour receives nothing** — and no resend can help them, because the bucket is empty for everyone.

**So custom SMTP is a prerequisite for enabling confirmation at all**, not an improvement to it. `deployment.md` records verification email as a launch prerequisite; **this is the constraint that makes the SMTP choice part of it rather than adjacent to it.** No provider is chosen here.

### 6.1 Password reset, and the callback route that never existed **[DECIDED 2026-09-24]**

**There was no way back into an account.** `src/services/auth/` held sign up, resend confirmation, sign in and sign out — no recovery, no route, no link on the login form. `product-spec.md` §5 lists accounts as _"sign up, sign in, sign out, delete account, export data"_: **reset was never scoped rather than deferred.**

**The consequence was total.** Someone who forgot their password could not sign in, could not delete their account — that needs a session — and could not export their data. **The account and its collection were simply gone.** For a product whose value is an accumulated collection, that is the worst available failure, and unlike every other Phase 7 item it is **certain** rather than contingent: some proportion of people forget passwords, always.

#### ⚠️ The prerequisite was missing too, and it was already affecting confirmation

**No auth callback route existed anywhere** — no `/auth/confirm`, no `exchangeCodeForSession`, no `verifyOtp`. `proxy.ts` only refreshes an existing session.

**Confirmation was therefore already half-working**, from the moment it was enabled on 2026-09-24. Supabase's verify endpoint marks the account confirmed, so signing up is not broken — but the redirect lands on `/` **carrying a `?code=` nothing consumes**, so the user arrives signed-out on the home page with no explanation and has to find the sign-in form themselves.

**For recovery the same gap is fatal rather than untidy.** A recovery link exists to establish a session so a new password can be set; with nothing exchanging the code there is no session, and **the flow cannot complete at all.**

**So the callback route is part of this slice, and it is not scope creep** — it is the thing without which nothing else here functions. That it also repairs the confirmation dead-end is the correct outcome rather than a coincidence.

#### The decisions

**The reset form is reachable only with a recovery session.** No token in the URL and no separate state: Supabase's link is what grants access, and without a session the page redirects to login.

**The password policy is shared, not copied.** The same schema signup uses — §6's twelve characters, no composition rules. **A second copy would drift**, and the sign-in/signup split recorded above is the same lesson: two schemas that should agree eventually do not.

**The response to a reset request is identical whether or not the address exists.** The reasoning `resendConfirmation` already carries: _"no account with that address"_ is the more useful sentence **and tells an attacker which addresses are registered.** A handle is public; an email address is not.

**A Google-authenticated account gets that same identical response**, and the cost is recorded rather than solved. Supabase sends no recovery mail for an account with no password, and **distinguishing the case would leak which addresses use Google.** Someone who signed up with Google and has forgotten that will wait for mail that never arrives. **The fix is telling people on the login page which methods exist**, which belongs with Google sign-in rather than here.

**Rate limiting stays Supabase's**, for the reason recorded above: `/auth/v1/recover` carries its own per-address window, and duplicating it would mean **inventing an anonymous-keyed limiter this codebase does not have** to reproduce a control the vendor already applies.

### Password policy: length, and deliberately nothing else **[DECIDED 2026-09-15]**

**Decision: a 12-character minimum on signup, no composition rules, and a breach-list check deliberately not built.**

**Composition rules are absent by decision, not by oversight**, and that is the part worth recording — otherwise someone adds them later believing the gap accidental. **Requiring a digit, a symbol or a capital is counterproductive**: it pushes people towards predictable substitutions — `Password1!` satisfies every such rule — while adding little real entropy, and it is the reason password requirements are widely resented and widely worked around. **Length is the lever that works.**

**Sign-in and signup no longer share a validation schema, and that split is a prerequisite rather than a refinement.** Both ran `parseCredentials` with the same 8-character rule, so **raising the minimum would have locked out every existing account with a shorter password** — not with a wrong-password error, but with a validation message before the credentials were ever checked. Three test accounts on staging were created under the old rule.

**Sign-in validates only that an email is well-formed and a password is present.** Whether it is the _right_ password is Supabase's job, and **whether it meets today's policy is nobody's** — a policy is a rule for choosing a password, not a rule for presenting one you already have. Applying it at sign-in would mean a policy change silently revoking credentials.

**A breach-list check is the genuinely effective addition and is deliberately out of scope. [OPEN]** Checking a candidate password against a corpus of known-breached ones catches the failure length does not: a long password that is already public. **It means an external API call on every signup, a new third-party dependency, and a privacy question** — even under k-anonymity, a hash prefix of a user's password leaves the system. **That deserves its own decision rather than riding along with a form change.**

**The minimum is not claimed to be optimal.** Twelve is a considered number, not a measured one; no dictionary, entropy estimate or breach corpus informed it. **What is decided is the shape — length only — and the shape is what should be argued with if it is wrong.**

**Unchanged:** Supabase Auth owns hashing, session management and verification; `src/services/auth/` remains the only route to it; and no existing stored credential is touched.

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

#### Store only the sizes that are served **[DECIDED 2026-09-13]**

**Decision: `ARTWORK_SIZES` becomes `[250, 500]`.** 1200 is no longer fetched or stored.

**Measured cause, not a tidy-up.** Each artwork job loops its sizes **sequentially**, and per size does a Cover Art Archive fetch — which `307`-redirects to archive.org, so two round trips — followed by a separate Storage upload. **Three sizes meant six serial round trips per album, at roughly 9–10.6 seconds, measured twice.** Against the cron's 45-second budget that is about **four covers a night**.

**Which sizes are actually served, established from the call sites. [CORRECTED 2026-09-13 — the first version of this section claimed 250 and 1200 were both unserved, which was wrong.]**

| Size   | Served by                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `250`  | `lists/[id]`, `search`, `CollectionTile`, `FeedItem`, and `AlbumGrid` at `standard` and `dense` — `SOURCE = { standard: 250, dense: 250, relaxed: 500 }`. **The dominant size** |
| `500`  | the album page, `FavouriteRow`, `AlbumGrid` at `relaxed`                                                                                                                        |
| `1200` | **Nothing.** It appears only in comments                                                                                                                                        |

**So the saving is one size of three, not two.** Roughly **7 seconds a job** instead of 10.6, giving about **six covers a night** rather than four. **That is a ~30% cut in per-job cost, and it is an improvement rather than a fix** — see the open item below.

**This supersedes a recorded intent, deliberately.** The constant's comment read _"500 is our display size; 1200 is for detail."_ **That intent was never wired up** — the album page, the one surface where a detail size would live, passes `size={500}` explicitly.

**Why dropping a size is safe here and would not be for user data.** **Artwork is re-fetchable from Cover Art Archive at any time.** The catalogue is read-only downstream, CAA is canonical and imposes no rate limit, and `enqueueMissingArtwork` already sweeps the whole catalogue. **So this defers a size rather than forecloses it** — if a detail size is ever wired up, one sweep backfills every album. The reversal cost is a single run. **Files already stored are untouched** and cost nothing.

**`ArtworkSize` derives from the array, so the type narrows with it — and that is load-bearing rather than tidy.** A request for a size we no longer store becomes a compile error instead of a runtime 404. **It is also what caught the error this section had to be corrected for**: narrowing to `[500]` failed typecheck in four places, which is how the six `size={250}` call sites were found after a grep had missed them.

**Concurrency is not superseded and remains a live candidate. [CORRECTED 2026-09-13]** An earlier draft of this section claimed `product-feedback.md` F-031's parallel-fetch proposal was made redundant by dropping sizes. **That was true only of the one-size version.** With two sizes there are still two independent fetches and two independent uploads, so **F-031's mechanism stays available on top of this change** and would plausibly bring a job nearer the cost of its slower size.

**The cron's count cap is deliberately unchanged.** `DEFAULT_BATCH_SIZE` stays 10. An earlier draft raised it to 25 on the reasoning that at 3.5 seconds a job the count would bind before the budget; **at 7 seconds ten jobs cost about 70 seconds, so the budget still binds first and the count never mattered for artwork.** Raising it would only help runs of cheap jobs, which is a different argument and is not made here.

**What this does not fix, recorded so six a night is never read as a solution. [OPEN]** **Per-job cost is necessary and nowhere near sufficient.** Measured 2026-09-13: **211 of 932 albums — 22.6% of the catalogue — held no cover**, with pending artwork jobs growing 54 → 174 → 207 over six days. Six a night clears 207 in about thirty-five nights _if nothing is added_, and every discography expansion adds more. **The harder ceiling is cadence** — and see _Cadence is per cron, not per day_ below. **[CORRECTED 2026-09-13: this item originally read "once a day, capped by the hosting plan", which drew the wrong inference from a real constraint.** One cron expression is capped at once a day; the number of cron entries never was. The ceiling was self-imposed.**]** It sits beside the deferred kind-aware claiming above rather than replacing it.

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

**Queue fairness remains `[OPEN]` and is untouched. [RESOLVED 2026-09-07 — see _Queue fairness: artwork nobody is waiting for drops below metered work_ below. This paragraph is preserved exactly as written, because its prediction was correct: the failure it describes is the one that occurred.]** `claim_ingestion_jobs` still has no kind filter and still orders `priority asc, id asc`, so older artwork jobs precede newly queued curated work. One consequence deserves recording because it is not obvious: **reclaim returns a stranded row to `pending` with its original `id`, so a row reclaimed today lands behind every job enqueued before it.** The four reclaimed curated-discovery rows on staging sit behind roughly 288 artwork jobs. Reclaim works exactly as designed and still leaves them weeks away.

**Deferred, unchanged, and not to be inferred from anything above: [AMENDED 2026-09-07 — the precondition named here is now discharged; the deferral stands on cost instead]** kind-aware claiming and kind-specific batch sizes — both of which need the fairness question answered first, since a batch is an arbitrary mixture of kinds; artwork decomposition; resumable curated discovery; managed queue infrastructure, whose revisit criterion is still the one recorded under _Ingestion paths_ above; and **cron frequency — at the time, unchanged at daily. [CORRECTED 2026-09-13: "capped there by the hosting plan" was the wrong inference; see _Cadence is per cron, not per day_ below.]**

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

### Queue fairness: artwork nobody is waiting for drops below metered work **[DECIDED 2026-09-07 — resolves the `[OPEN]` queue fairness item above]**

**Decision: a third priority band, `BULK_ARTWORK_PRIORITY = 200`, for artwork no reader is waiting on.**

**The rule, and it is not "artwork is background work".** **Artwork created by a job more urgent than the background band inherits that urgency; artwork created by background or bulk work goes to the bulk band.** Self-service artwork stays at `INTERACTIVE_JOB_PRIORITY` under it — someone went and found a record longplayr did not hold, and the cover is the difference between a page that looks finished and one that looks broken. That is the case the interactive band was created for, and `tests/integration/self-service.test.ts` asserts it.

**Five artwork enqueue sites; four change, one is deliberately exempt, and they are not treated alike. [CORRECTED 2026-09-07 — this section first described three uniformly bulk sites, which was wrong; see below.]**

| Site                                               | Treatment                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Curated tranche, on album creation                 | **Bulk band.** This is the mechanism the measurement below identifies          |
| Seed                                               | **Bulk band**                                                                  |
| Post-ingest, inside the drain's `runJob`           | **Conditional** — inherits when the parent job is more urgent than background  |
| `enqueueMissingArtwork`, when no priority is given | **Bulk band** by default; an explicit priority from a caller is still honoured |
| Self-service add                                   | **Untouched.** Remains `INTERACTIVE_JOB_PRIORITY`                              |

**Why the post-ingest site is conditional rather than bulk, and why that half is an improvement rather than a fix.** That site sits inside the `ingest_release_group` case, and **the album page enqueues that kind at `INTERACTIVE_JOB_PRIORITY` when a reader opens an unhydrated album.** Demoting it uniformly would have made the cover for an album someone is looking at arrive _later_ than before — the opposite of the rule this section states. Under the rule it instead inherits the parent's urgency, so **album-page artwork moves from the background band to the interactive one: sooner than it was, not merely no later.** That is a deliberate behaviour change, taken because it makes the two paths where a reader is waiting consistent — self-service artwork was already interactive, and the album page was the outlier.

**`enqueueMissingArtwork` is included for a specific reason.** Its only caller, the artwork backfill utility, passes no priority, and its default mode queues without draining — up to 500 rows. Left at the background band, **the repository's own recovery tool would have recreated the starvation this decision removes.**

**What made the open item urgent rather than theoretical.** On-demand artist depth (`aba3a07`) put `discover_curated_artist` into the same band as artwork. Each successful expansion creates one artwork row per created album — roughly eight — every one carrying a lower `id` than the next artist page's discovery job, so every one is claimed first. A page view drains one job. **The queue therefore diverged: success generated the backlog that starved the next success.** Measured on the deployed database after three artist pages were opened: 20 pending, 18 `fetch_artwork` and 2 `discover_curated_artist`, the latter still at `attempts = 0`.

**This is the failure the item above predicted.** It recorded that "older artwork jobs precede newly queued curated work", and that four reclaimed discovery rows on staging sat behind roughly 288 artwork jobs. The prediction was correct; what changed is that a user-facing surface now depends on the starved kind.

**Why a priority band rather than the alternatives, each rejected for a stated reason.**

| Rejected                                  | Why                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind-aware claiming / per-kind batch size | Needs a kind filter on `claim_ingestion_jobs` — a change to the claim boundary itself, and the heavier of the two. **Still deferred below**                                                     |
| A larger page-view drain count            | Increases concurrent MusicBrainz requests across serverless invocations, each holding its own module-level limiter. That exposure is unaddressed and this must not widen it                     |
| A larger cron batch                       | `DEFAULT_BATCH_SIZE` is sized for metered jobs at about a second against a 60-second ceiling; raising it globally overruns the invocation, which is the stranding class this section fixed once |
| More frequent cron                        | Capped at daily by the hosting plan, and **cadence is a separate ceiling from batch size** — it changes how often a run happens, never what one run can do                                      |

**The accepted tradeoff, decided rather than discovered.** Artwork now drains only once pending metadata is exhausted, which is starvation in the opposite direction. It is **bounded rather than open-ended**: a `discover_curated_artist` job is enqueued once per artist ever, so the metered supply is capped by the number of distinct artists opened rather than being continuous. Accepted on that basis, and recorded here so it is not rediscovered as a surprise.

**What this does not fix, stated so it is not assumed. Contention, not throughput.** The cron's 45-second budget against roughly ten seconds per artwork job still completes about four artwork jobs a night, so a large artwork backlog still clears slowly. That is the condition `product-spec.md` §8.9 deferred as affecting how the catalogue **looks** rather than whether it is **correct** — a judgement **falsified by contention and restored by this decision**, not by any change in throughput.

**One migration, and it is a data operation rather than a schema change.** Existing `fetch_artwork` rows already `pending` at the default band move to the new one, so the fix takes effect on the deployed queue instead of waiting several nights for the legacy rows to drain. **Its predicate must exclude the interactive band** — `priority = 100` is part of the match, not an optimisation — or it would demote exactly the self-service case the rule above protects. No row is deleted, nothing else on the row is touched, and the statement matches nothing on a fresh database.

**The deferred item's precondition is discharged, and it stays deferred.** Kind-aware claiming and kind-specific batch sizes were deferred above _pending the fairness question_, which this answers. They remain deferred — now on cost rather than on precondition, and as the answer to **both** directions of starvation rather than only this one.

---

### Cadence is per cron, not per day **[DECIDED 2026-09-13 — corrects an inference this document asserted three times]**

**Decision: twelve cron entries invoke the drain, at two-hour spacing.** `vercel.json` gains eleven alongside the existing one.

**The constraint was real and the inference from it was wrong.** Verified against Vercel's cron usage page (last updated 2026-07-15): **Hobby allows 100 cron jobs per project**, with a minimum interval of **once per day** and **per-hour scheduling precision (±59 min)**. The documentation is explicit that an over-frequent _expression_ fails deployment — `0 * * * *` is rejected. **What is capped is how often one entry may run. The number of entries never was.** This document described the daily cadence as a platform ceiling in three places; it was self-imposed, and those places are corrected rather than quietly updated.

**Effect, and it is the only change in this area with an order-of-magnitude size.** The 45-second budget completes roughly six artwork jobs per invocation, so one entry is about **six covers a day** and twelve is about **seventy-two**. Against 211 albums without covers and a backlog that had grown 54 → 174 → 207 in six days, that is roughly **three days to clear** rather than thirty-five. **It accelerates the whole queue** — tracklists, expansions and hydration drain on the same invocations — not artwork alone.

**Two-hour spacing is chosen for the jitter, not for tidiness.** With ±59 minutes of precision, an entry at `0 4` fires anywhere in 04:00–04:59, so **hourly spacing admits a worst case where one drain is still running as the next fires.** Concurrent drains would each hold their own module-level MusicBrainz limiter and could collectively exceed one request per second — the exposure recorded above and still unaddressed. **Two-hour windows cannot overlap, so that exposure is untouched**, which was the whole reason for preferring this over draining from page views. Twenty-four entries were considered and declined for that reason rather than on effect.

**Yesterday's cooling-off is what makes twelve sweeps a day safe**, and that interaction is worth recording because it was not designed for it. Each drain runs all three sweeps; twelve would re-queue a failing artist twelve times, except **the 24-hour cooling-off in _Recovery sweeps_ below already prevents exactly that** — a failure at 04:00 is four hours old at 08:00 and is skipped. A bound chosen for one reason turns out to be load-bearing for another.

**Even hours, and `refresh-charts` keeps 05:00** — an odd hour, so it sits outside every drain window, and §—'s requirement that recomputation and the drain not share a failure domain is unaffected.

**The same mechanism is now available to the chart cadence, and is deliberately not used.** §8 records the chart recomputation as _"intent is hourly; the deployed cadence is daily, a Hobby-plan cron constraint."_ **That divergence is closeable the same way** — twelve entries would give two-hourly recomputation. A seven-day window does not need it, so charts are left alone. **But the constraint must stop being described as immovable there too.**

**Batch size and budget are deliberately unchanged.** At roughly seven seconds an artwork job, ten already exceed the 45-second budget, so **more invocations is the lever and a larger batch is not.**

**One real meter, named rather than discovered.** Cron jobs invoke functions, so twelve a day counts against Hobby function usage. Twelve is trivial against that allowance, and it is a meter rather than a cap.

### The status line's states **[DECIDED 2026-09-13 — DECIDED AND DELIBERATELY UNBUILT]**

**Nothing below is implemented.** It is recorded so the decision is not lost while a diagnostic surface is built first — the same state `product-spec.md` §10 exists to hold. **Do not read this as describing current behaviour.**

**The defect.** `attemptStateFor` collapses _succeeded_ and _terminally failed_ into one `settled` value, so a terminally failed artist shows **no status line at all** and presents a truncated discography as complete. **Radiohead sat in that state for six days.** Four actual states currently produce two renderings.

**Decided: three renderings, from four states.**

| State                                                  | Rendering                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Never attempted · backing off · re-queued by the sweep | _"Fetching the rest of this discography from MusicBrainz. Look again in a moment."_   |
| **Terminally failed, awaiting the sweep**              | **"Couldn't finish fetching this discography from MusicBrainz. It will be retried."** |
| Succeeded                                              | Nothing                                                                               |

**Three collapse into one because the reader's action is identical** — come back — and the fourth differs in kind. **The horizon stays on the first and is deliberately absent from the second**: _"look again in a moment"_ is now both true and actionable, since _A later view drains too_ made refreshing claim a job, while the sweep's timing depends on cron jitter and queue depth and cannot be promised.

**The split lives in `attemptStateFor` as a fourth value.** It already reads every row's status, so this costs no extra query, and its only production caller is `expansionStateFor`.

**This reverses the unification in _A later view drains too_, deliberately and for a different reason.** That decision found the page _"promising activity it had disabled"_ and made the status condition and the work condition identical. **This splits them again**, because a terminally failed artist warrants a **message** and must not warrant **work**: enqueueing on failure from a page view would restart the three-attempt retry policy on every visit — exactly what `attemptStateFor`'s docstring warns against, and what the sweep now owns. **The earlier decision's point was that the two must not disagree about the same state; a state where we speak and do nothing is not that.**

**`last_error` is never shown to a reader.** It is upstream diagnostic text and belongs only on the operator surface in §17a.

### An absent cover stops being terminal **[DECIDED 2026-09-16]**

**`ARTWORK_RETRYABLE` has always been `['pending', 'failed']`, with `found` and `absent` described as settled.** That was correct while nothing outside the system could change the answer. **It stops being correct the moment longplayr invites people to upload the missing cover** (`product-spec.md` §8.9): a reader adds art to Cover Art Archive, and an album marked `absent` is **never looked at again**, so the placeholder stays forever and the contribution is invisible.

**This was found before implementation and is the reason the decision changed rather than the feature shipping broken.** A prompt that sends someone to do work the product can never observe is worse than no prompt at all.

**Decided: `absent` re-enters the sweep behind a staleness window, read from `artwork_updated_at`.** No migration — that column already exists and is written on every attempt, including on absence.

**One verified fact makes this affordable, and it is the opposite of the MusicBrainz situation.** §18 confirms **Cover Art Archive has no rate limit**. The one-request-per-second cap that the job queue, the drain cadence, the batch sizing and the whole F-026–F-030 cluster exist to manage **does not apply here at all.**

**So the real cost is drain budget, not API quota**, and that is what the window is sized against. A drain completes roughly six artwork jobs per invocation across twelve invocations a day. Re-checking the settled-absent set too often would spend that budget on albums whose answer has almost certainly not changed, starving first-time fetches — **the same starvation the bulk priority band was introduced to prevent.**

**The consequence to state honestly: a contributor does not see their cover appear immediately.** They see it when the window elapses and a drain reaches the job. **A view-triggered re-check would have made it near-immediate and was considered**; the periodic sweep was chosen instead because it works whether or not the contributor ever returns to the page.

**Idempotence is unchanged and comes for free.** The partial unique index over `pending` and `running` already rejects a duplicate job, so a re-queued album cannot accumulate work.

### Recovery sweeps, and the cron finally calls them **[DECIDED 2026-09-13]**

**Decision: a third sweep, `enqueueFailedExpansions`, and the daily cron calls all three sweeps before it drains.**

**What was broken.** A terminally failed `discover_curated_artist` job reads as `settled` through `attemptStateFor`, so the artist page shows **no status line** and nothing ever retries. **Radiohead spent three attempts inside 47 minutes against MusicBrainz load shedding** — `remaining=13/15`, so nowhere near our own rate — and was permanently capped at three albums while presenting a truncated discography as complete. **`current-state.md` §59 recorded permanent settlement as approved behaviour; that approval was withdrawn on 2026-09-12** (`product-feedback.md` F-034). A transient upstream error is not evidence that an artist has no discography, and it contradicts the completion-oriented depth principle in `CLAUDE.md` and `product-spec.md` §8.9.

**The bound is a cooling-off period, and an attempt cap was ruled out rather than merely not chosen.** **Any hard cap reintroduces permanent exclusion** — a cap of nine simply postpones it by three cycles — which is the behaviour that was declared a defect. **Only a cooling-off period never permanently excludes.** A failed expansion becomes re-queueable **24 hours** after its last failure: it matches the cron's own cadence, so a transient outage is retried the next night rather than in a week, and the cost for a genuinely unfixable artist is **three MusicBrainz requests a night against a daily budget of 86,400.** There is deliberately **no ceiling on total attempts over time.**

**Expansion state is read from job history, not from a column — and that is proportionality, not preference.** Both existing sweeps read an entity column: `enqueueMissingArtwork` reads `albums.artwork_status`, `enqueueMissingTracklists` reads `releases.tracklist_status`. **`artists` carries no equivalent**, which is why `expansionStateFor` derives state from `ingestion_jobs` at all. **An artist-level column remains the better long-term answer** — it would fix the unindexed scan §59 records in a request path, and make the ratified _"for as long as its job record survives"_ guarantee permanent rather than contingent — **but this defect affects exactly one artist**, against a migration, a backfill and every write path. **The column keeps its recorded triggers: a contemplated purge (§59), and this sweep's scan becoming slow.**

**The cron calling the sweeps is the half that decides whether any of this is worth shipping. [RESOLVES the `[OPEN]` item in `current-state.md` §11]** That item asked _"whether the daily cron should sweep for missing artwork and tracklists itself."_ **The evidence answers it: five `fetch_artwork` jobs have sat `failed` since August**, recoverable the whole time by a command that exists and that nobody ran. **A third hand-run sweep would have delivered nothing.**

**Measured before deciding, so the cost is known rather than assumed.** On the deployed data the artwork sweep queues about **nine** jobs — five `failed` plus roughly four albums `pending` without a job, since it already skips anything outstanding — and the expansion sweep queues **one**. The sweeps are sub-second database queries, so **they run before the drain inside the existing route**, which lets newly swept work drain in the same invocation. **A separate cron route was considered and rejected**: it doubles the auth and configuration surface for no measured need, and the sweeps do not compete meaningfully for the 45-second budget.

**`failed` only, and the guard rail matters more than the choice.** A sweep over `failed` jobs is **recovery**. A sweep over `succeeded` ones is a **refresh policy** — that is `product-feedback.md` F-029, it is undecided, and `product-spec.md` §8.9 explicitly records _"no staleness rule and no revisit"_. **The two differ by one value in a `where` clause**, which is exactly how F-029 would get answered by accident, so both the code and this record state the exclusion rather than implying it.

**Re-queued expansions take `DEFAULT_JOB_PRIORITY`**, the same band a first view uses. Nobody is waiting on a swept expansion, so the §7 invariant above — background expansion must never delay an interactive operation — is untouched.

**What this does not address.** Nothing about artwork **throughput** or **cadence**; the `[OPEN]` ceiling under _Store only the sizes that are served_ stands. Nothing about `attemptStateFor`'s scan. And **the first cron run after deployment performs all three sweeps**, which on current data is about ten new jobs.

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

#### A fourth trigger for this path, and the priority rule it needs **[DECIDED 2026-09-07]**

**The path above already exists; what it lacked was a trigger from the application.** `discoverAndIngestArtist` browses an artist's release groups, applies `withinCurrentDepth`, creates what is missing and reconciles credit-less rows; the `discover_curated_artist` job kind and the drain's dispatch to it are built and covered. **Nothing in `src/app/` enqueued it** — it ran only for tranche seeding. An artist page now enqueues it on first view for an artist not previously expanded. The product decision is `product-spec.md` §8.9 and §6; this records the architectural consequences only.

**It is the same shape as the album page's hydration trigger, with one deliberate difference.** Both render from held data, enqueue in `after()` so the response is sent first, and rely on the partial unique index over `(kind, target_mbid)` to make a duplicate enqueue a no-op. **The difference is priority.** The album page uses `INTERACTIVE_JOB_PRIORITY` because a tracklist is wanted on the page being read _now_; a discography expansion benefits a **later** view by definition, so it runs **below interactive work**.

**The invariant, and it is the one implementation must preserve:** background artist expansion **must never delay an interactive operation**. It is enqueued and never awaited in the request; it sits below interactive priority; and **at most one expansion is outstanding per artist**. The limiter serialises every MusicBrainz request globally at one per second, so an expansion given interactive priority would queue ahead of a reader's own search or self-service add — which is the failure this rule exists to prevent.

#### A later view drains too, and the artist page was the outlier **[DECIDED 2026-09-07]**

**Decision: an artist page with an expansion still outstanding drains one job, exactly as a first view does.** Previously both the enqueue and the drain sat behind the `start` state, so **every view after the first did nothing at all and refreshing could not help by construction.** The only other drains were another artist's first view, an album's first view, a self-service add, and the daily cron.

**This is a consistency fix, not a new rule.** The album page has always gated on `hydration_status === 'pending'`, which stays true on every view until hydration succeeds — its own comment reads _"Safe to run on every view of a pending album."_ The paragraph above describes the artist page as "the same shape as the album page's hydration trigger, with one deliberate difference", and names that difference as **priority**. It was not the only difference, and the second one was unintended.

**Observed in use before it was found in code. [2026-09-07]** An artist page sat on its outstanding-expansion line for several minutes; opening further artists then visibly hydrated the earlier ones one at a time, each first view draining one job in `priority asc, id asc` order.

**The invariant above is untouched, and that is why this shape was chosen.** Priority does not change — only how often a drain runs — so an expansion still sits below interactive work and still cannot queue ahead of a reader's own search or self-service add. **Promoting the viewed artist's job to interactive priority was considered and rejected** for exactly that reason; it would have required reopening the invariant rather than preserving it.

**One premise beside the invariant did not survive contact with use.** The paragraph above says a discography expansion _"benefits a **later** view by definition."_ It does not: a reader who is told to look again is waiting on this view. **That claim is superseded** — the priority decision it was offered in support of stands, on the invariant's own reasoning rather than on this premise.

**What this deliberately does not give: a bounded guarantee.** `claim_ingestion_jobs` has no target filter, so a refresh drains the **oldest** pending job rather than this artist's. A reader behind a backlog of three refreshes three times. **A target-filtered claim is the escalation** — it would satisfy the invariant too, since it selects within a band rather than raising priority — and it is deferred because it changes the claim boundary, which has needed correction twice, and costs a migration.

**An accepted exposure, recorded rather than waved through.** A page view is an unauthenticated trigger, so anything that can reach an artist page — a crawler included — can now cause a drain as well as an enqueue. **Accepted because the album page has carried exactly this exposure since Phase 1**; this equalises the two surfaces rather than introducing something new. `product-spec.md` §8.4's 30/hour limit is per user and does not cover it.

**A second effect, found after the decision and worth stating because it was not the reason for it.** `drainJobs` runs `reclaimStaleJobs` before it claims anything, and that reclaim **only fires when a drain starts**. With the artist page gated on `start`, a job killed mid-run and left `running` was recoverable only by another artist's first view or the daily cron. **Measured 2026-09-12: one `discover_curated_artist` row had been `running` and untouched for sixteen hours** — the 90-minute threshold had long passed and nothing had run a drain to apply it. Its artist's state reads `outstanding`, so under this decision a later view of that page recovers it. **So this change unsticks stranded rows as well as starved ones.**

**What it does not fix, and that is now a defect rather than approved behaviour. [2026-09-12]** A terminally failed expansion reads as `settled`, so this decision deliberately excludes it — `expansion !== 'settled'` cannot reach it. **Radiohead exhausted three attempts inside 47 minutes against MusicBrainz load shedding and is permanently capped at three albums, with no status line to say so.** `current-state.md` §59 recorded permanent settlement as approved; **that approval is withdrawn — see `product-feedback.md` F-034.** The repair is assigned to the next cycle as a **sweep**, matching `enqueueMissingArtwork`, `enqueueMissingTracklists` and `enqueueMissingPayloads` — of which there is no expansion equivalent, which is exactly why artwork exhausted by a transient error is recoverable and an expansion is not. **A sweep rather than retry-on-view keeps the unauthenticated page-view trigger out of it and leaves the ratified once-per-artist guarantee intact.** `settled` therefore keeps a single meaning in this decision on purpose.

**A second candidate mechanism is unresolved and this does not address it.** Neither route sets `maxDuration`, so the `after()` drain runs under the platform default — already `[OPEN]` above. A large expansion pages at 100 release groups per request through the one-per-second limiter and then inserts sequentially; if that exceeds the ceiling the job is killed mid-run and left `running` until the 90-minute reclaim. **Whether that occurred was not established, and if it is the real cause this decision will not fix it** — which is itself the test.

**The scope carries no schema change, and the attempt record therefore lives in the job history. [RESOLVED 2026-09-07]** `artists` holds no hydration or depth column, and the partial unique index covers only `pending` and `running`, so "already attempted" is not recoverable from outstanding work alone. It is read instead from **every** `discover_curated_artist` row for that artist whatever its status — none means never attempted, any `pending` or `running` means outstanding, anything else means settled. **`failed` counts as settled**: the queue has already spent its three attempts behind 30s, 5min and 30min backoffs, and re-reading that as "never attempted" would restart the policy from a page view.

**Two mechanisms, doing two different jobs, and conflating them is the mistake to avoid.** The **row history** gives at most one attempt ever; the **partial unique index** gives at most one _outstanding_ attempt, atomically, under concurrent first views — both requests read `none`, both insert, the second violates the index, and `enqueueJob` treats `23505` as success while rethrowing every other error. Neither substitutes for the other.

**This makes the product rule conditional on retention, which was raised in review, examined and ratified deliberately** — see `product-spec.md` §8.9 `[RATIFIED 2026-09-07]`. The condition holds: no production code deletes a job row, no cron purges, the test cleanups that do are fenced to a local database, and nothing records an intent to purge. **The queue was designed to permit requeueing completed work** — its index comment says so explicitly — so this is a use the table's design does not protect, and the narrowed wording in §8.9 says so rather than claiming otherwise. Losing the rows costs one redundant browse per artist and corrupts nothing, because re-expansion is idempotent.

**The consequence for a future purge is therefore a product question, not a cleanup detail.** Introducing one would silently re-enable expansion for every artist; the decision to revisit the artist-level column belongs at that point.

**One known cost, recorded rather than fixed.** The history read filters on `kind` and `target_mbid` across all statuses, which no index supports — the unique index is partial on `pending`/`running`, and the claim index leads with `status`. It is a sequential scan in a request path on a table that grows with every job. Negligible at two thousand rows, and unfixable inside a no-migration boundary; **an artist-level column would resolve it incidentally.**

**What this does not decide.** Whether an expanded artist is ever re-expanded, and on what signal. The partial index was written so completed jobs do not block requeueing later, which **permits** a re-sync policy without being one.

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

**Fetch depth and display limit are separate concerns. [DECIDED 2026-09-06]**

The upstream panel asks MusicBrainz for **25** release groups and displays up to **10** of the survivors. Two numbers with two reasons, where there was previously one: `searchUpstream` derived its fetch from the caller's display limit by an undocumented `limit * 2`, so a display choice silently set the retrieval depth.

**They answer different questions.** Fetch depth is sized against what the two filters beneath it remove — `classify().inScope`, then every MBID the catalogue already holds — and **a deeper fetch is free against the constraint that shapes the rest of this section**, because the rate limiter serialises requests rather than results. Display depth is sized against a section deliberately subordinate to the local results above it. Coupling them let the second decide the first, and left the pool shrinking as the catalogue grew, since the already-held filter scales with catalogue size and a fixed multiplier does not.

**No abstraction is introduced.** Two explicit constants replace one multiplier. The search path, the relevance ordering, both filters and the query string handed to MusicBrainz are all unchanged, and the response's `count` and Lucene `score` stay unused. `product-spec.md` §8.10 owns the product reasoning and the evidence limits.

**Two questions stay deferred and are not resolved by this.** Whether the panel gets a "show more" — meaningful now that the pool exceeds the display, and still not built — and whether upstream search matches artist names, still blocked on verifying field-qualified Lucene syntax against the live API. **§7a records the established route for that class of verification**: staging, where the contact is real, since local cannot make live calls by design.

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

### The internal source arrives as a separate cached chart, not as a second writer of `popularity_score` — **[DECIDED 2026-09-05. Implemented in `67949e8`, CI #91.]**

Phase 5 slice 1 builds `product-spec.md` §8.3's _Popular this week_. **The tension recorded above is respected rather than resolved**: one active source still writes one `albums.popularity_score`, and this slice does not make it two.

**`albums.popularity_score` is unchanged and keeps its meaning.** It remains the external-source prominence signal, written only by the catalogue seed — and it has **four consumers, not one**: Browse discovery, `search_albums`' tie-breaking within a tier, and three job-prioritisation queries in `jobs.ts`. Repurposing it would change search results and ingestion order as a side effect of a discovery change. **That is the reason the chart is a separate read model, and it is a measured reason rather than a stylistic one.**

**A materialised chart is not a popularity signal.** It is the stored answer to one query. **`product-spec.md` §8.9's "one field or two" question is therefore untouched and stays open**, and nothing here forecloses either answer.

**The chart's inputs are collection and relisten data, never the `activity` table.** §8.3 requires backfilled collection data to count; `activity` exists to exclude backfills. The two cannot be the same source, and choosing `activity` because it is the obvious "activity" table would contradict a decided product rule.

**Persistence and scheduled recomputation are architecture here, not implementation detail** — §8.3 decides a cached table rather than per-request computation, and §9's caching table already records it.

**The deployed cadence diverges from the hourly intent, on a platform constraint.** Vercel's Hobby plan caps cron at once per day, so recomputation is **daily**. Recorded as a divergence rather than rewritten as an hourly-to-daily decision: §8.3's intent is hourly and stands.

**The external source fills; it does not blend.** Below 20 internal results the remainder comes from the existing `PopularitySource`, with internal entries keeping their positions. **`BlendedSource` remains a future shape and no blending architecture is introduced by this slice.**

**The 20 is a floor, not a cap, and the consumer's limit is a separate thing. [DECIDED 2026-09-05]** External entries **complete the chart to 20** when internal activity yields fewer, appended after the internal results; when it yields 20 or more, **no external entry is added at all**. **Internal results are never truncated merely to satisfy the floor** — a chart with more than 20 qualifying albums stays that long. A caller's limit caps what that caller renders and never sets the fill target: `getPopularAlbums(24)` renders at most 24 of whatever the chart holds. **Nothing here changes the boundaries above** — the materialised chart stays internal-only, `albums.popularity_score` stays the external signal with its existing consumers, no blending is introduced, and §8.9's one-field-or-two question remains open.

**Browse Popular is the first and only consumer in this slice**, which answers — **for the internal case only** — the question this section raises above. An album with internal activity can appear regardless of its external score, so null stops acting as a visibility gate for it. **The external fill still cannot offer a null-score album, and that half is unresolved**: there, null means the source genuinely has nothing to say, which is the legitimate case.

**Not decided here.** Whether recomputation is invoked from a new route or the existing drain; the chart's table, columns, keys, indexes or retention; query shape; and component structure. Those belong to implementation.

### A second consumer, and no second signal — **[DECIDED 2026-09-05. Phase 5 slice 3. Implemented in `8f4aa00`, CI #92.]**

The home surface defined in `product-spec.md` §6 becomes the chart's second consumer. **It reads the same `getPopularAlbums` result Browse reads**, at a smaller caller limit, rather than querying the chart itself — two callers, one service function, one answer. That is the whole architectural content of the slice: **no new table, no new function, no migration, no change to the refresh, the schedule, the floor or the fill.**

**The caller limit doing the work here is the one this section already separated from §8.3's floor.** Home passing twelve is a use of that separation rather than a new rule; the floor stays a chart property and the limit stays a caller property.

**`albums.popularity_score` is untouched again**, and §8.9's one-field-or-two question is untouched with it. **No blending is introduced**; `BlendedSource` remains a future shape.

---

## 9. Caching

Deliberately minimal. Correctness first; caching added where measurement justifies it.

| Layer                  | Approach                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue pages        | Cached server-side with periodic revalidation — catalogue data changes rarely                                                                                                                             |
| Artwork                | Served from Supabase Storage behind a CDN, immutable URLs                                                                                                                                                 |
| Discovery charts       | Recomputed into a cached table, not per request. Definitions in `product-spec.md` §8.3. Intent is hourly; **the deployed cadence is daily**, a Hobby-plan cron constraint rather than a revision — see §8 |
| Feed, profiles, search | Not cached — personal or query-dependent                                                                                                                                                                  |

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

### 11.1 The middle environment was never built **[CORRECTED 2026-09-24]**

**There is one Supabase project. It is named `longplayr-staging`, it holds the real data, and it serves `longplayr.vercel.app`.** The table above describes three environments; two exist — local, and that one.

**The decision above is preserved rather than rewritten**, per _Historical integrity_. It was made and it was not implemented, and the gap went unnoticed because the surviving project carries the word _staging_ in its name.

**The sharp part is the line directly above this one.** _Production-and-local-only_ was rejected because _"every migration meets real data for the first time in production"_ — **and that is precisely what this project does.** The rejected alternative is the one in use, under a name that implies otherwise.

**What actually carries the risk is `CLAUDE.md`'s STEP J ordering**: CI green on the exact commit, then the migration applied, then the merge. That is a real control and it has held — but it is **not** what §11 chose, and it does not rehearse a migration against realistic seeded data. **A migration whose failure mode depends on existing rows is still unrehearsed**, which is exactly the class §89's backfill fell into: CI applied it to an empty database and could not have caught it.

**Deliberately not resolved by building the second project.** That is another database to migrate, seed and keep in step, for a pre-launch product with five accounts. **The trigger to revisit is real users**, at which point "the migration meets real data for the first time in production" stops being an acceptable sentence.

_Why this._ The main thing environments buy is **rehearsing migrations before they touch real users**. A shared staging environment delivers that at low cost. Its known weakness — concurrent pull requests share one database and can interfere — is acceptable at this team size and revisitable later.

**CI: GitHub Actions on every pull request** — lint, typecheck, unit and integration tests, build. **[INFERRED]** This is ordinary practice rather than a course-derived recommendation, and it's what makes every other quality mechanism trustworthy.

### 11.1 The pre-push migration check warns truthfully, and its reach has shrunk **[DECIDED 2026-09-15]**

**`scripts/check-migrations-deployed.mjs` guards a failure that has happened twice** — code deployed ahead of its migration, which on 2026-09-04 took every profile page down for every visitor (`current-state.md` §42, §46). It refuses a push when the deployed database is behind.

**Its stated premise stopped being true when work moved to a branch.** The check asserts _"Vercel deploys on push, so pushing is deploying"_. That holds for `main` and is **false for a branch**, which is now where all work happens — and the gate change of 2026-09-15 moved migration application from STEP I to **STEP J**, after a green CI run and before the merge.

**So its instruction had become actively wrong.** It told the developer to run `supabase db push --linked` _before_ pushing, which would put schema on the deployed database **before CI had ever parsed the migration** — precisely the ordering the amendment reversed. Found in real use, not by inspection: it blocked the push in §74 and had to be overridden.

**Decided: the message becomes ref-aware; the blocking behaviour does not change.** Git hands a `pre-push` hook its target refs on stdin, and the script had never read them, so it could not tell a branch push from a push to `main`. It now does, and says something true for each case — for `main`, that pushing deploys and the migration must land first; for a branch, that **the push deploys nothing**, that the migration belongs at STEP J, and that `--no-verify` is the expected way past.

**Behaviour is deliberately untouched, and that is a scope decision rather than an oversight.** `CLAUDE.md` records that a branch push _"will now report a pending migration, and that is expected rather than a failure to fix"_. Making the hook stop blocking on a branch would be better engineering **and would make that sentence stale**, so it is left to the maintainer as its own decision.

**The honest limitation, recorded rather than papered over: this hook can no longer prevent the outage it was built for.** Under the branch model the deploy happens **at merge time on GitHub**, which no local hook observes. The real protection is STEP J's ordering — CI green, migration applied, then merge — and the hook is now a **reminder rather than a gate**. A fix that implied otherwise would be worse than the stale message it replaces.

**The failure mode being designed against is not a missed migration but a trained reflex.** Crying wolf on every branch push teaches the developer to reach for `--no-verify` without reading, and a guard that is always overridden has already stopped working.

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

### Extending the database-backed fixture technique to session establishment — **[DECIDED 2026-09-04. Implemented in `a9da122`, CI #86.]**

**This revisits the stance above — _"no further tests should be converted on the current evidence"_ — and does not overturn it.** That stance reasoned about **flake probability**, having just demonstrated that baseline duration does not predict failure: a 1.8s test exceeded 30s while the 12.9s slowest remaining test passed. **That finding is unchallenged and still holds.**

**What changed is that a different justification now exists, and it did not exist on 2026-08-28.** The memory finding recorded in this section establishes that this host runs the suite under severe memory pressure with **monotonic within-run degradation** — 7.9s for tests 1–20 against 24.5s for tests 81+, against a flat 108/108 in 12.4m on CI. Under that mechanism, reducing total work has value **independently of flake**, because a shorter suite spends less time in the degraded region.

> **This does not establish that fixture conversion reduces failure or flake rate, and no such claim is authorised.** The 2026-08-28 conclusion stands unamended: **reduced duration has never been shown to reduce failures.** Setup-time reduction, total suite duration, memory and swap behaviour, and failure rate are **four separate claims** and evidence for one is not evidence for another.

#### What was approved

**A first slice only, converting session establishment — not application operations.** **18 of the 72 `signUp(page)` call sites, 25%, across two files.** **[Superseded in count on 2026-09-04: 17 are eligible. The line is left exactly as approved — 18 is the number of call sites reviewed, and the reduction is recorded in _The eligible count is 17, not 18_ below.]**

| Spec                         | Call sites             | Why this file                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile-collection.spec.ts` | **11 across 12 tests** | Highest density in the suite, and **already contains both `createUserViaApi` and `signIn`** — the conversion invents no mechanism. It is the precedent's own file, converted only in part                                       |
| `follows.spec.ts`            | **7 across 7 tests**   | **Already contains `createAccount` with postcondition assertions.** Needs only a sign-in helper, **copied rather than extracted**, following `auth.spec.ts`'s own recorded habit of copying so files stay recognisably the same |

**Helper availability was weighted above call-site count**, which is why the two highest-count alternatives were not chosen.

**Every call site in scope discards the page the signup helper lands on.** Each is immediately followed by a navigation — `page.goto(…)`, or a helper that begins with one. **Established by reading all of them, not assumed**, and it removes the principal conversion hazard: no test depends on the post-signup landing page.

> **⚠️ That paragraph was wrong, and it is corrected rather than deleted. [CORRECTED 2026-09-04]** _"Established by reading all of them, not assumed"_ was true for `follows.spec.ts`, `lists.spec.ts` and `listened-on.spec.ts` and **was not true for `profile-collection.spec.ts`, which had not been read call site by call site when that sentence was written.** The per-site review required by the eligibility rule then found one site that does **not** navigate away. **The claim of thoroughness was the error, not the conclusion for the sites it had actually covered** — and it is exactly why the rule says eligibility must be established per call site rather than inferred from a count.

#### The eligible count is 17, not 18 — **[SUPPLEMENTARY DECISION 2026-09-04, following the STEP D eligibility review]**

**The two-file scope is unchanged. Only the eligible-site count moves, and it moves down.**

| Spec                         | Call sites | **Eligible** |
| ---------------------------- | ---------- | ------------ |
| `profile-collection.spec.ts` | 11         | **10**       |
| `follows.spec.ts`            | 7          | **7**        |
| **Total**                    | 18         | **17**       |

**`tests/e2e/profile-collection.spec.ts:112` is excluded.** It asserts on the page the signup flow itself lands on, before any navigation:

```ts
const user = await signUp(page);

// The profile starts with the real empty state, not a zeroed scaffold.
await expect(page.getByText('Your collection is empty.')).toBeVisible();
```

**The reason is substantive, not mechanical.** Inserting `page.goto('/${user.handle}')` would preserve the assertion **text** while changing what the assertion **establishes** — from _the state of the page a new user lands on after onboarding_ to _the state of the profile page when separately visited_. The comment beside it, _"not a zeroed scaffold"_, reads as being about that immediate post-signup moment. **Preserved text is not preserved coverage**, and this slice authorises neither adding navigations to manufacture eligibility nor accepting a coverage change to protect a count.

**This is a conservative application of the existing boundary, not a rejection.** The test remains legitimate coverage of the post-signup landing state and remains a candidate for a later decision that addresses the coverage question directly rather than incidentally.

**No compensating scope.** No additional spec, no additional call site, and no conversion of `collect` or `rate` to the `collectViaApi` / `rateViaApi` helpers that already sit in the same file. **The slice is smaller than first stated, and that is the correct outcome** — the eligibility rule found a site the count had assumed.

**One mechanical consequence.** `signUp` **remains** in `profile-collection.spec.ts` with its one surviving caller. It is still removed from `follows.spec.ts`, where conversion leaves it with none.

#### The eligibility rule, unchanged in substance

> **A UI operation stays in the UI when the test asserts something about it.**

Six conditions must **all** hold before a call site is converted:

1. The test asserts **nothing** about signup, onboarding, handle claim, or the auth forms.
2. The test **navigates away** before asserting anything that depends on the signup landing page.
3. The API fixture creates **both** the `auth.users` row and the `profiles` row, and **asserts its own postconditions**. There is no trigger that creates a profile, so this is required rather than defensive.
4. Created email addresses remain registered in the existing `createdEmails` cleanup mechanism, so `afterAll` still deletes them.
5. The session is established **through the real login form**. No persisted storage state and no injected authentication state is introduced.
6. **Eligibility is established per call site by reading that test's assertions.** A call-site count is not evidence of eligibility.

#### Excluded from this slice

| Excluded                                                                                              | Reason                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`auth.spec.ts`**                                                                                    | Flow owner. Asserts signup, handle claim, sign-out, sign-in, reserved handles and public visibility                                                                                                                                                                                                                                                               |
| **`collection.spec.ts`**                                                                              | Flow owner for the collection flow. Untouched by the 2026-08-28 conversion and untouched here                                                                                                                                                                                                                                                                     |
| **`lists.spec.ts`**                                                                                   | **Deferred, not rejected.** Its own header records that lists are built through the interface deliberately — _"Writing rows directly would skip the surfaces this slice is mostly about."_ That governs list arrangements rather than session establishment, so conversion is **probably** compatible. **"Probably" is not a sufficient basis for a first slice** |
| **`listened-on.spec.ts`**                                                                             | Has neither helper. Would require importing the pattern into a file with no existing API machinery                                                                                                                                                                                                                                                                |
| Any test asserting signup, onboarding, handle claim or auth-flow behaviour                            | The eligibility rule itself                                                                                                                                                                                                                                                                                                                                       |
| `storageState`, `globalSetup`, `test.use`, cookie or session injection                                | **Not authorised.** A shared persisted session couples tests to one another and weakens isolation                                                                                                                                                                                                                                                                 |
| Converting `createList`, `addAlbum`, collection, rating or other application operations               | This slice converts **session establishment only**                                                                                                                                                                                                                                                                                                                |
| Consolidating the **15 duplicated `signUp(page)` definitions**                                        | **Deferred.** It would touch all 15 files — a blast radius several times the slice — and is **not necessary** to complete the slice safely                                                                                                                                                                                                                        |
| Docker, OrbStack, Colima, VM memory, container set, IDE processes, or any other machine configuration | **Outside this cycle entirely.** See the sequencing note below                                                                                                                                                                                                                                                                                                    |

#### One consequence, accepted deliberately

**Today, if signup broke, roughly 72 tests would fail. After conversion, fewer would.** That **localises** the failure rather than broadcasting it, which is better diagnostics and less redundancy. `auth.spec.ts` retains three full signup flows and **becomes the signup flow's sole guarantor — it must never be converted.**

#### Required evidence for the slice

| Evidence                   | Requirement                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Behavioural assertions** | Every original assertion preserved; unchanged assertions remain **byte-for-byte** unchanged. **Non-negotiable**                                                                                             |
| **Non-vacuous fixtures**   | Each API fixture asserts its own postconditions, ordered on a deterministic column. The precedent records both failures — a vacuous pilot, and an ordering on `rating` that has two nulls and no tiebreaker |
| **Setup-time measurement** | Repeated **isolated** before/after runs, medians reported, for each converted spec                                                                                                                          |
| **Machine state**          | Docker configuration, container set, free memory and swap recorded **at every measurement stage**                                                                                                           |
| **CI**                     | Green on the pushed SHA                                                                                                                                                                                     |

#### Measurement boundaries

| Claim                         | Status                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Setup-time reduction**      | **The only performance claim this slice may establish**                                                                                          |
| **Total suite duration**      | **Not an acceptance criterion.** It must not be presented as established while this host cannot measure it reliably — a full run degrades itself |
| **Memory and swap behaviour** | **Contextual evidence, not an acceptance criterion**                                                                                             |
| **Failure and flake rate**    | **Not an acceptance criterion, and must not be claimed as improved by this work**                                                                |

**No numeric threshold is set in advance, deliberately.** The precedent's 14.1s → 6.6s came from tests shedding a signup, four collects and two ratings; **session establishment alone is a smaller share**, and inventing a target from that number would be false rigour.

**Expanding beyond the first slice requires a material measured median reduction**, with its magnitude scoped to the machine state it was measured in. **If the measured reduction is not material, stopping is a valid outcome** — closing a line of work with evidence is explicitly a legitimate result under `CLAUDE.md`, not a failure.

#### Machine configuration is sequenced, not a blocker

**Host remediation sits outside this cycle and is not a prerequisite that blocks A–K.** Blocking implementation on an out-of-cycle action with no timeline costs more than the confound it avoids, and the conversion work itself does not depend on it.

- **Comparative measurements must be taken within a single, recorded machine-configuration state.**
- **If the machine configuration changes mid-cycle, prior comparative measurements are invalid for comparison and must be retaken.** No before/after may straddle a machine change.
- **Order-reversed passes are required**, because memory and swap state drift during execution. This is the direct lesson of the controlled A/B recorded above, where reversal **did not** fully remove the ordering confound — and may not here either, which must be recorded rather than hidden.
- **Any figure produced is scoped to its recorded machine state and must not be generalised** — the same discipline this section applies to the 41% mean.
- **The maintainer may perform host remediation before the measurement step and this is recommended for measurement quality**, but the cycle does not depend on it. **No machine change is authorised or performed by this decision.**

#### What this decision does not touch

- ~~**Whether a locally RED `verify:full` may satisfy the pre-commit requirement when CI passes** — **`[DEFERRED]`**, unchanged.~~ **RESOLVED 2026-09-13** — see _The full gate moves to CI on a branch_ below. The question is answered by moving the run rather than by licensing a red one.
- **Whether the end-to-end gate should run the production build** — **`[OPEN]`**, unchanged. Nothing here bears on it.
- **The 2026-08-28 dev-server rejection** — **intact**, and not reopened.
- **The 41% production-versus-development result** — remains the observed mean of that experiment only, **not a general performance magnitude**.
- **The host memory constraint** — remains an **environmental limitation, not a repository defect**.
- **The fresh server per local run** — implemented and CI-verified, unchanged.
- **`docs/product-feedback.md`** — maintainer-owned and untriaged. No entry is promoted or reclassified.

**No production code, schema, migration, `playwright.config.ts`, CI workflow, `package.json` script, timeout, retry or assertion is in scope.**

---

---

### Waiting for a redirecting server action before navigating again — **[DECIDED 2026-09-05. Implemented in `3d62bfa`, CI #87.]**

> **When a server action ends in `redirect()`, a test must wait for that navigation to become observable before initiating another navigation.**

**Clicking such a control and immediately calling `page.goto` races the redirect.** When the redirect lands second it wins, leaving the test on the redirect's destination rather than the page it asked for — and the next locator waits out its full 30-second budget against an element that does not exist there. The failure surfaces at the locator, several lines away from the cause.

#### The evidence, and what it is not

**Known.** CI run #86 on `a9da122` passed but reported **two flaky tests, both in `list-likes.spec.ts`** — the first flaky results CI had produced; #84 and #85 each reported zero. Both failed at the **same operation**, `getByLabel('Email').fill(...)`, with `waiting for getByLabel('Email')`, at the line immediately following an unwaited `page.goto('/login')`. `signOut()` ends in `redirect('/')`. **The same failure occurred in the local `verify:full` run at the same line**, so it is present in two independent environments. `auth.spec.ts` performs the same sign-out and navigation but **waits for the signed-out state first**, and did not flake.

> **Inferred, not reproduced.** The mechanism is an inference strongly supported by the failing locator, the redirect in the action, the contrasting waited pattern, and reproduction across two environments. **No instrumented reproduction was performed, and this must not be described as a definitively reproduced race.**

**Implementation is justified on that evidence.** The correction is a single wait at each site, following a pattern already proven in this repository; the defect degrades the project's only mechanical gate; and **proof of the absence of flakiness is not obtainable and is not required.**

#### The bounded audit, and its limits

**A suite-wide audit was performed at decision time rather than deferred into implementation.** Every redirecting server action was enumerated with its test call sites:

| Redirecting action                                                     | Call sites                              | Waits before navigating?               |
| ---------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| `signUp` → `/onboarding`, `chooseHandle` → `/{handle}`, `signIn` → `/` | the auth helpers across the suite       | **Yes** — 30 click → `toHaveURL` pairs |
| `deleteListAction` → `/{handle}/lists`                                 | `lists.spec.ts:260`                     | **Yes** — `toHaveURL(…, NAV)`          |
| `signOut` → `/`                                                        | `auth.spec.ts:95`                       | **Yes** — waits for the `Sign in` link |
| `signOut` → `/`                                                        | **`list-likes.spec.ts:143` and `:169`** | **No**                                 |

A mechanical scan for `.click()` followed within three non-blank lines by `page.goto` or `page.reload`, with no intervening `expect`, returned **three** hits. Two are the sites above. **`lists.spec.ts:91` was investigated and excluded**: its `Add` control calls `addAlbumAction`, which only `revalidatePath`s and **does not redirect**, so no competing navigation exists.

> **This is a bounded method, not proof that no other race exists.** The scan is line-adjacency based. **Races expressed through different syntax, initiated by link clicks or form submissions, or separated by more than three lines would not have been detected.** Other occurrences are **unfound by a recorded method, not established as absent**, and may be considered separately later.

#### Approved scope

**Exactly two sites: `tests/e2e/list-likes.spec.ts:143` and `:169`.** At each, the test must wait for the signed-out state to become observable after clicking Sign out and before calling `page.goto('/login')`. **`auth.spec.ts` is the approved precedent** — the known-working pattern is to be followed rather than a new synchronization mechanism invented. **The exact wait is an implementation decision and is not fixed here.**

**No other test site is implementation scope.** **`signOut()` is correct behaviour and is not changed** — the redirect is something the test must accommodate, not a product defect. **Explicitly excluded:** production code, schema, migrations, CI workflow, `playwright.config.ts`, `package.json`, timeouts, retries, worker counts, any other spec, any suite-wide refactor or re-audit, the remaining 55 `signUp` call sites, the performance measurement, and the documentation backlog.

**This convention is recorded for future test authors. It is not authorisation for a suite-wide refactor or a second audit.**

#### Verification standard

| Evidence               | Requirement                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **Repeated execution** | `list-likes.spec.ts` green for **at least 5 consecutive isolated runs**              |
| **The defect is gone** | The unwaited pattern is **mechanically absent** at both sites — the same scan re-run |
| **Assertions**         | Every existing behavioural assertion unchanged; only a wait is added                 |
| **Nothing masked**     | No timeout, retry, worker or configuration change                                    |
| **CI**                 | Evidence obtained for the pushed SHA, **with the flaky count recorded either way**   |

**No behavioural negative control is required, and that is a decision rather than an omission.** Reverting the wait and expecting the flake to return is probabilistic and would not provide reliable evidence. **The deterministic static check replaces it.**

> **Repeated green runs are consistent with the fix. They do not prove the absence of flakiness, and no statement may claim they do.**

#### Not addressed here

**The five other local `verify:full` failures** — `review-likes` ×3, `profile-favourites`, `want-to-listen` — are **unexplained and are not claimed to share this cause**. **`lists.spec.ts`'s `addAlbum` helper returns without asserting the add succeeded**; that is neither a race nor this class, and is recorded so it is not lost. The **`[OPEN]`** production-build gate question, the **`[DEFERRED]`** `verify:full` policy question, the **invalid/inconclusive** setup-time measurement and the host-memory constraint are all unchanged by this decision.

---

### The full gate moves to CI on a branch **[DECIDED 2026-09-13 — resolves the `[DEFERRED]` `verify:full` policy question above]**

**Decision: the full suite runs on CI against a branch before anything reaches `main`. Locally, STEP F runs `npm run verify` plus the targeted suites for the area changed. `npm run verify:full` stops being a precondition for pushing.**

**What resolves the deferral is measurement, not preference.** That question — _whether a locally RED `verify:full` may satisfy the pre-commit requirement when CI passes_ — was deferred deliberately, on the grounds that it would license ignoring a red run. **Eight consecutive cycles on 2026-09-13 supply the evidence it lacked.**

| Run | End-to-end failures | Local runtime | CI on the same tree |
| --- | ------------------- | ------------- | ------------------- |
| 1   | 9                   | 10.5m         | green               |
| 2   | 5                   | 13.5m         | green               |
| 3   | 2                   | 16.3m         | green               |
| 4   | 9                   | 18.9m         | green               |
| 5   | 7                   | 22.7m         | green               |
| 6   | 14                  | 25.3m         | green               |
| 7   | 19                  | 25.3m         | green               |
| 8   | 6                   | 15.8m         | green               |

**Eight trees, every failing set green on isolated rerun, not one a real defect, and CI green on all eight.** Host load rose from **6.15 to 12.51** across the same period. **The sharpest single measurement: the same tree took 25.3 minutes locally and 11.2 on CI — with CI absorbing nothing**, every test passing first attempt and zero retries. CI is not more lenient; it runs two parallel jobs on clean runners while this host runs everything serially under load.

**The deferral's own fear is answered rather than waved away.** It feared licensing the habit of ignoring red runs. **This does not license that** — it moves the run to a place where red means something. A red CI run still blocks a merge.

**The mechanism already exists and is unused.** `ci.yml` triggers on `pull_request` as well as `push`, its two jobs carry no `needs:` between them so they run in parallel, and `concurrency` cancels superseded runs. **Nothing is built here; something already present starts being used.**

**Why a branch rather than simply dropping the local gate.** Dropping it while still pushing to `main` accepts a red `main` and a bad deploy for the ~13 minutes CI takes — the exact failure `CLAUDE.md` records as having left `main` red for three commits. **A branch isolates `main` while the same discipline is exercised.** Branch protection is paid and was declined; **`CLAUDE.md` reasoned from its absence to "the local gate is the safety net", and the step that reasoning skips is that a branch does not require protection to be useful.**

**One rule inverts, and it is the one this repository treats most seriously.** Today _"pushing is deploying"_, because `main` deploys to the live app. **A branch push does not deploy it**, so **migration-before-push becomes migration-before-merge.** That is safer rather than laxer: the migration is applied after CI has passed on the exact tree, instead of before anything has been verified. **What does not change is that CI applies migrations to a fresh database and therefore proves nothing about the deployed schema** — that warning must survive the rewrite verbatim, because it is the one CI cannot help with.

**What this does not touch.** The **`[OPEN]`** production-build gate question is unchanged and is a separate decision. The 2026-08-28 dev-server rejection stands. **The host memory constraint remains an environmental limitation and not a repository defect** — and the maintainer's constraint that verification must not compete with the working machine is what rules out every remedy that depends on the host being idle.

~~**`CLAUDE.md` is not edited by this decision.** STEP H, I and J are described there, and that document is the maintainer's. **This cycle produces proposed wording for them to apply; the process document is not rewritten by the agent the process governs.**~~ **SUPERSEDED 2026-09-15 — the maintainer instructed that the proposal be applied, and it was.** `CLAUDE.md` now carries the branch model at **Where the full gate runs**, the migration gate moved from STEP I to STEP J, and rewritten rows for STEP H, I and J. **The paragraph above is preserved because its reasoning held right up to the point the maintainer overrode it**, which is the only thing that should override it.

---

### 12.1 The local gate is now `verify` alone **[DECIDED 2026-09-16]**

**§12 moved the full suite to CI on measurement.** This moves the targeted suites too, on the same measurement and one further argument.

**The measurement has not changed.** Across eight cycles on 2026-09-13 the local end-to-end suite failed 9, 5, 2, 9, 7, 14, 19 and 6 times on eight different trees. **Every failing set passed on isolated rerun, CI was green on all eight, and not one was a real defect.** A targeted run is the same browser, the same dev server and the same database on the same host — **narrowing the selection does not change what is being measured.**

**The further argument is that the host is the maintainer's working machine.** Playwright makes it unusable while it runs, and they have raised it twice. A cost paid in their working day, for evidence CI produces anyway on a clean runner, is not a trade worth defending.

**What is given up, and it is real.** A broken query, RLS policy or page is now found in roughly fifteen minutes by CI rather than two minutes locally, and finding it there **reopens the cycle**. That happened once — `current-state.md` §79 — and cost one extra CI run and a separate commit. **It will happen again, and that is the accepted price.**

**A render probe is the replacement, not nothing.** Starting the dev server and fetching the changed page with `curl` costs a fraction of a browser suite. **It has repeatedly produced better evidence than Playwright did**: §80's two defects — a 500 where a 404 belonged, and a sort control ordering by invisible data — were both found that way, and neither would have been caught by any assertion that existed. §76 and §78 were verified the same way.

**The rule this leaves.** `npm run verify` locally. Integration and end-to-end on CI. **A red CI run blocks the merge and reopens the cycle**, which is where the attribution standard in `CLAUDE.md` now chiefly applies.

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
- **Rate limits** on the abuse-prone write paths. Catalogue additions are capped at **30 per hour and 100 per day per user** — protecting both search quality and the shared MusicBrainz request budget. ~~Reviews, follows and reports need ceilings too; their numbers are not yet set.~~ **[PARTLY ADDRESSED 2026-09-24 — see §14.4.]** Follows and both kinds of like now carry ceilings, enforced in the database. **Reviews were deliberately narrowed out and reports do not exist yet.**
- **Input validation** at every server boundary via a schema validator; review bodies sanitised on render.
- **Admin surface** gated by a role check and separated from user-facing routes.
- **Database privileges are set by revoking, not only by granting. [DECIDED 2026-09-04]** Postgres and Supabase both hand out defaults that an explicit `grant` does not remove, so a migration naming its intended audience restricts nobody. Measured on 2026-09-04, before correction: `anon` held `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` on all 20 `public` tables, and `PUBLIC` held `EXECUTE` on 9 of 10 project-authored functions. **Not a leak and not exploitable** — see `§16.5`, which holds the evidence, the per-function intent and the boundary.

### 14.1 A moderated user could undo their own moderation **[FOUND AND CLOSED 2026-09-22]**

**§91 made status _mean_ something on every read path. It did not make it stick.** Found at STEP B of the slice that fixes it, by reading the policies rather than by anything failing.

**The hole.** `grant insert, update on public.profiles to authenticated` is **table-level**, so it covers every column, and `profiles_update_own` permits any update to your own row. A suspended account holding its own token could therefore send `PATCH /rest/v1/profiles?id=eq.<self>` with `{"status":"active"}` and succeed. **The same shape applied to content**: `reviews_write_own` and `lists_write_own` are `for all`, with table-level update grants, so an author could set a removed review or list back to `live`.

**Not exploitable when found**, and that is recorded rather than used as comfort: four test profiles existed, nobody was suspended, nothing had been removed. **It was a hole waiting for the feature.**

**The fix is column-level grants, which is §16.5's rule applied literally.** The table-level update grant is revoked and replaced by one naming the columns a user may actually change — `handle`, `display_name`, `bio`, `avatar_url` on their own profile; `body` on their own review; title, description and ranked-ness on their own list. **`status` and `is_admin` appear in no grant to `authenticated` at all**, so no user token can reach them whatever a policy says.

**The lesson generalises past this defect.** RLS answers _which rows_; it never answers _which columns_. A policy that correctly scopes a row is routinely mistaken for one that scopes a field, and the two are unrelated — a `for all` policy over a table-level grant hands the author every column the table has, including the ones moderation depends on.

### 14.2 The privilege model, and why it is a column rather than a secret **[DECIDED 2026-09-22]**

**`profiles.is_admin`, a boolean defaulting false, settable only by SQL.** There is deliberately no path in the product to grant it: the first admin must be created by hand regardless, and a second way to become one is a second thing to attack.

**`queue-view-auth.ts`'s precedent was considered and does not transfer.** That surface uses a shared secret in a query string and says why: _"longplayr has no operator role… a privilege model introduced for a temporary page would outlive the page."_ It accepts secrets-in-URLs — which reach browser history, referrers and proxy logs — **explicitly because it performs no mutation whatsoever**. Slice 2 suspends accounts and removes content, so that trade is unavailable.

**Admin writes go through the service-role client rather than a user token**, so RLS is not their gate — the service layer is, per §5. This is stronger than an admin-shaped RLS policy would be: with no grant to `authenticated` on those columns, **there is no policy left to subvert**.

### 14.3 The grant and policy audit **[COMPLETED 2026-09-24]**

**The deliberate sweep §14.1 should have triggered.** That finding closed three tables after a suspended account was found able to reinstate itself; this compared **every** table's grants and policies against what the service layer actually writes. Twenty-two tables.

**The rule was already in this codebase, applied once and never generalised — and that is the finding.** `notifications` grants `UPDATE` on `read_at` alone, and `markNotificationRead` states the principle in as many words: _"RLS decides which rows; the grant decides which columns."_ Nothing carried it anywhere else. **Not a missing idea. An unapplied one.**

**Nothing found was exploitable** — five accounts, no real traffic, RLS scoping rows correctly throughout. Each was a rule the application assumed and the database did not hold.

| Table                | Found                                                                                                                                                                                                           | Closed by                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `collection_entries` | **`relisten_count` was user-writable** — a trigger-maintained counter its own migration calls _"nothing but arithmetic… no business rule reads it"_. `added_at`, `listened_on`, `album_id` had no writer either | `grant update (rating, liked, updated_at)`                             |
| `list_items`         | Table-level `UPDATE` where only `reorder_list_item` writes, and only `position`                                                                                                                                 | `grant update (position)`                                              |
| `favourite_albums`   | Table-level `UPDATE` with **no update path in the product at all** — reordering is unbuilt and open (F-001)                                                                                                     | Grant withdrawn entirely                                               |
| `activity`           | **The actor was checked; the subject was not.** A user could post a `reviewed` event under their own handle naming **somebody else's review**, and `feed_activity` joins the body in                            | `with check` requiring ownership of all four subject kinds             |
| `notifications`      | **Same gap.** `follows` is publicly readable, so any follow id could be named — delivering a fabricated _"X followed you"_ to an arbitrary recipient                                                            | `with check` requiring the referenced row to be the actor's own action |

**The correct pattern for the two policy gaps was already two tables away.** `relisten_events_write_own` checks ownership **through the parent entry** rather than trusting a column on the row being written. Both fixes are that, applied.

**`updated_at` is granted on `collection_entries`, and §14.1's trap is why.** `ensure_collection_entry` is `SECURITY INVOKER` and its `on conflict do update set updated_at = …` runs with the _caller's_ privileges — so narrowing without it would have made **adding an album you already hold** fail with `42501`. Harmless to grant: the `before update` trigger overwrites whatever a caller sends. **That is the second time this exact interaction has nearly shipped a regression.**

**Verified correct and recorded, so the next audit starts here:** `follows` and `want_to_listen` key on the owning column; `list_likes` and `review_likes` add an existence check on the subject; `relisten_events` checks through the parent; `notifications.read_at` was already a column grant; `profiles`, `reviews` and `lists` were narrowed by §14.1; and the catalogue tables are read-only to `anon` and `authenticated` with every write on `service_role`.

**The durable output is `tests/integration/write-privileges.test.ts`**, which asserts from a **real user token** what may and may not be written, in both directions. **Every other integration suite uses the service-role client, which bypasses grants and RLS entirely** — so this entire surface was invisible to the test suite until now, and a migration that widens a grant will fail rather than pass quietly.

### 14.4 Rate limits, and why these ones are in the database **[DECIDED 2026-09-24]**

**Moderation reacts; nothing prevented.** §91 through §94 built enforcement, an admin, and a locked-down privilege surface — all of which act _after_ somebody has flooded the product. A signed-in account could follow and like without any ceiling at all, and **each of those actions generates a notification for somebody else**, which is the harm a ceiling actually bounds.

#### The enforcement point is the decision, and §14.1 is why

**The existing limiter is service-layer**: `remainingAllowance` counts `catalogue_additions` rows in a window. Copying it here was the obvious move and is **rejected**.

**`follows`, `review_likes` and `list_likes` all grant `insert` to `authenticated`, and their policies permit an owner to insert freely.** A ceiling that lives only in the service layer is therefore bypassed by anybody posting straight to PostgREST with their own token — **the identical shape as §14.1's hole**, where a rule the application assumed was one the database did not hold.

**So these are enforced by trigger.** Not because triggers are elegant: because a limit only the app respects is a product preference dressed as a control, and this project has already paid once to learn the difference.

**The cost is a windowed count per insert**, on tables indexed by the actor column, for actions that are not hot paths. Negligible at this scale, and recorded here so it is revisited rather than assumed.

**Catalogue additions are left in the service layer and not migrated.** That limiter also drives a _remaining allowance_ display, it guards a rate-limited upstream rather than other users' notifications, and **rewriting a working control to match a new convention is not what this cycle is for.** The inconsistency is deliberate and named.

#### What is limited, and what is not

| Action       | Per hour | Per day |
| ------------ | -------- | ------- |
| Follows      | 60       | 300     |
| Review likes | 120      | 600     |
| List likes   | 120      | 600     |

**Chosen, not measured — the same standing as §6's twelve-character password minimum, and stated in the same words.** There is no usage data to tune against. They are set generously enough that no genuine user should meet them and tightly enough to bound a script. **Raising them when real usage says so is expected**, and is not a finding.

**Reviews are deliberately out, and §14 above named them.** A review is **one per collection entry**, so writing many requires first collecting many albums; editing is an upsert that rewrites in place rather than inserting, so _reviews per hour_ is not countable the way the others are. **The narrowing is recorded rather than done quietly.**

**Reports are out because they do not exist** — Phase 6 slice 3.

#### What a user sees

**A `Result` carrying `rate_limited`**, following the precedent `AddError` set, rather than an exception. The service layer maps the database's refusal onto that outcome so the control explains itself.

Per `docs/claude-course-analysis.md` §10, the course's own advice — don't put unaudited authentication in front of real user data — is taken at its stated standard: **a security review before launch**, focused on auth flows, authorisation checks, and the admin surface.

---

## 15. Privacy

- **Everything user-generated is public** by decision. No viewer-permission filtering anywhere, which is a substantial simplification of every read path — and a deliberate bet, since retrofitting private accounts later is expensive.
- **Hard deletion** removes all user-authored rows. Because averages are computed on read (§16), no recomputation is required. **[EXTENDED 2026-09-18 — see §15.1.]**
- **Export** produces the user's collection, ratings, reviews and lists in a portable format.
- **Email addresses are never public**, and blocking is labelled truthfully — it prevents interaction, it does not hide content.

### 15.1 How the deletion actually executes **[DECIDED 2026-09-18]**

**The cascade is already declared, and that is the finding that made this a slice rather than a phase.** Every user-bearing table cascades from `profiles`, and `profiles.id` references `auth.users(id) on delete cascade`. `reviews` and `relisten_events` carry no direct user reference and cascade transitively through `collection_entries`. **Deleting the auth user should therefore take everything with it today** — which is a claim about the schema, not a verified fact, and the point of the test below.

**One deliberate exception, already in the schema with its reasoning beside it.** `catalogue_additions.user_id` is `on delete set null`: the audit record of what entered the catalogue survives as an anonymous row. **That is a considered decision, not the orphan `CLAUDE.md` warns about.**

**The delete is issued against `auth.users`, not against `profiles`.** Deleting the profile row would leave the auth user behind — able to sign in, with no profile, indistinguishable from a half-finished onboarding. **The auth row is the root of the cascade and the only correct target.** It requires the service-role client at `src/lib/supabase/admin.ts`, which already exists.

**The handle reservation is a `before delete` trigger on `profiles`, and the timing matters.** It must fire on a _cascaded_ delete rather than only on a direct one, because the delete this product issues is always a cascade from `auth.users`. A `before delete` row trigger fires in both cases; an application-level write before the delete call would not, and would also be skipped by any deletion issued from outside the app. **The trigger is the mechanism precisely because it cannot be bypassed.**

**Verification is an integration test asserting no rows survive, across every table.** `CLAUDE.md` calls an orphaned row a privacy failure, so **the test is the deliverable here at least as much as the code is.** It enumerates tables explicitly rather than deleting and eyeballing: a new table added later must fail this test until somebody has thought about it.

**No user-owned storage objects exist**, so nothing in Supabase Storage needs deleting. The single bucket, `artwork`, is catalogue-owned. **This stops being true the moment avatar upload ships** (`product-spec.md` §10.3), and whoever builds that owns extending this path.

---

### 15.2 Export is the deletion enumeration, read instead of deleted **[DECIDED 2026-09-23]**

**§87 already did the expensive part.** Account deletion required enumerating every table that holds user data, and that list is written down and tested. **Export is the same list read rather than removed**, which is why it was taken while the enumeration was four days old rather than rediscovered later.

**One JSON file, fetched from an authenticated route and served as a download.** JSON over CSV because portability means _another service_ reading it: a collection carrying nested lists, items and reviews cannot be flattened without either losing the structure or shipping several files.

**Generated synchronously, and the ceiling is recorded rather than assumed away.** At thirty entries this is nothing. Somewhere in the low thousands it becomes a job and an email; nothing here pretends otherwise.

**Removed reviews and removed lists are included, and that is the decision most worth stating.** Moderation hides your writing from other people; it does not stop it being yours, and RLS already lets you read your own. **An export that silently dropped them would be the product deciding what you are allowed a copy of.**

**Two things are excluded, both because they are derived rather than authored.** Every `activity` row comes from an entry, review or relisten already in the file, and every notification comes from a follow or like already in it — so both duplicate rather than add. **The notification exclusion is deliberately not §16.9a's question**, which concerns what _other people_ see.

**Follows are exported in both directions.** A follower is somebody else's action, but it is a fact _about_ the exporting user, and every handle involved is public by `product-spec.md` §4 regardless.

**Albums carry MBID, title and credit and nothing more.** Enough to mean something in another service; not a copy of a catalogue that is MusicBrainz's rather than the user's.

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

#### The personal-surface location, supplied — **[DECIDED 2026-09-05. Implemented in `311bd70`, CI #89.]**

**The decision above is completed here, not amended.** Everything it settles stands unchanged: four tabs, the unread indicator on **You**, **no fifth tab**, no other tab-bar redesign, and notifications reached on mobile through the personal surface. **What it never specified is _where_ on that surface** — and nothing was ever built there, so the sentence _"notifications are reached on mobile through the user's personal surface"_ described **an assumption rather than a route**. It is recorded that way rather than rewritten as though the location had already been chosen.

**Approved: an owner-only link to `/notifications` in the profile page's identity block.** The **"You" tab continues routing to the profile**; `youDestination()` is unchanged. The exact markup is an implementation concern and is not decided here.

**Why the identity block specifically.** It is where owner-only affordance already lives — the page computes `isOwnProfile` and renders the "You" chip there. **The placement is a decision, not a suggestion**: the profile is a long page, and a link below Favourites, Lists and Collection would satisfy reachability while failing discoverability.

##### Three alternatives, rejected rather than deferred

| Alternative                                    | Why rejected                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A fifth tab**                                | **Already rejected by the decision above** — it would narrow every tab and alter a component the design foundation locked                                                                                                                                                                                             |
| **"You" routes to `/notifications`**           | It would leave the profile — the owner's collection, favourites and lists — with **no mobile entry point at all**, trading one unreachable surface for another                                                                                                                                                        |
| **"You" routes conditionally on unread state** | `MobileTabBar`'s own reasoning forbids it: _"'You' is a destination, not an authentication state… A tab whose name changes underneath the user is a tab they have to re-read every time."_ A destination that moves with notification state is the same fault, and it **strands the profile whenever unread is zero** |
| **Un-hiding the header link on mobile**        | It adds a **second global mobile affordance** instead of implementing the personal-surface decision, and the mobile treatment was settled above as the minimal badge                                                                                                                                                  |

##### Unread state is unchanged

**The "You" tab's dot and its `sr-only` announcement stay exactly as they are**, and **the new link carries no count**. `unreadBadgeLabel` exists and is exported, so a count would be reuse rather than invention — but the mobile treatment is _"the minimal badge required to expose unread state"_, and that badge is the dot. **A second indicator on the same two-tap journey duplicates one piece of state in two places.** A count on the new link is **deferred, not rejected**.

##### The tradeoff, accepted deliberately

**Two taps: "You" → profile → notifications.** One-tap access would need a fifth tab or a mobile header affordance, **both rejected above, one of them by the existing decision.** Two taps is the cost of the four-tab shape, and it is a cost the decision above already accepted.

##### Verification expectations

**A viewport precedent exists and is to be followed rather than invented**: `tests/e2e/collection.spec.ts:281` already uses `setViewportSize({ width: 390, height: 844 })`.

- At that viewport, a **signed-in owner can reach `/notifications` from their own profile** — the journey exercised, not asserted as DOM presence.
- At the same viewport, **the header link is not visible**. This is what makes the new link load-bearing rather than redundant.
- The link **does not render for a visitor** on another profile, nor when signed out.
- **Desktop behaviour is unchanged**, and **`MobileTabBar` is untouched**.

> **Assert visibility, not presence.** The tab bar is `md:hidden` and the header account block is `hidden … md:flex`, so both remain **in the DOM at every width** — a fact `auth.spec.ts` and `feed.spec.ts` already work around.

##### Scope

**Approved:** the owner-only identity-block link, plus the verification above. **Deferred:** an unread count on that link. **Rejected:** the three alternatives above.

**Not in scope:** unread-indicator logic, `MobileTabBar`, the header, `unreadNotificationCount`, notification functionality, the notifications page, the profile's other sections, any information-architecture redesign, documentation reconciliation, and F-016, F-018, F-019, F-020, Phase 5 and the list-activity questions.

#### Account actions on the personal surface — **[DECIDED 2026-09-05. Implemented in `a7eaa66`, CI #90.]**

**This is a separate decision from the one above, and the distinction is the point.** That one placed **navigation** — a link to notifications. This one places an **action**. `architecture.md` §16.3's mobile decision governs reaching notifications and says nothing about account actions, so nothing here follows automatically from it.

**The confirmed defect.** `signOut` is imported and used in **exactly one place** — `layout.tsx:134`, inside the `hidden … md:flex` container. `MobileTabBar` carries no account controls and the profile had none. **A signed-in user on a phone had no visible way to sign out at all.**

**The container was enumerated rather than sampled.** Two `hidden … md:flex` blocks hold nine affordances between them. Browse, Search and Feed are duplicated by the tab bar; the profile and onboarding links by its "You" tab; sign-in and create-account by the signed-out home page body. Notifications was fixed above. **`Sign out` was the only affordance in either container with no mobile equivalent anywhere.**

#### What was approved

**A sign-out control on the signed-in owner's own profile, in the identity block, alongside the notifications link.** It uses the **existing `signOut` server action** in a form, matching the header's shape, and is gated by the **existing server-side `isOwnProfile`** — no new ownership logic. **"You" continues to route to the profile**, and the four-tab shape is untouched.

**It renders at all widths. No responsive class.**

#### Why here, and not a settings surface

**`/settings` was considered seriously and is deferred rather than dismissed.** The name **is already reserved** in `handle.ts`, Phase 6 needs account deletion, and F-016 will eventually need password and email settings — a settings surface is coming. **But building it now, for one control, is building ahead of the phase that owns it**, which `CLAUDE.md` forbids without saying so explicitly.

**The public-profile objection does not apply.** The control renders only when `isOwnProfile`, evaluated in a **server component**, so a visitor never receives it. And the tab bar's "You" already designates the profile as the personal surface: **the profile is not a public page to its owner — it is what the product already calls "You".**

> **The trigger is named rather than left to judgement.** When a **third** owner-only account affordance arrives — account deletion, or F-016's settings — **that is the point to define an account surface** instead of adding another control. Deferred, not rejected. Grouping or restyling the affordances now on the identity block is deferred on the same terms.

#### Why all widths, and the accepted duplication

**Two reasons, and the duplication is deliberate rather than overlooked.** One rule for owner affordances on the personal surface is better than two, and the section above chose all widths for the same surface. And **`md:hidden` would reintroduce breakpoint-conditional visibility — the exact failure class both decisions exist to repair.** Adding a new instance of it to fix an old one is the wrong trade.

**Desktop therefore carries two sign-out controls**, header and profile, leading to the same server action. **Accepted.**

#### Why no confirmation

**No dialog, no disclosure**, and each reason comes from the repository rather than instinct.

- **The product has no confirmation convention at all** — no `window.confirm`, no `<dialog>`, no `role="dialog"`, nowhere in `src/`.
- **Its one genuinely destructive action does something different.** `EditListForm` wraps _"Delete list permanently"_ in a `<details>` disclosure with danger styling. **That convention is for irreversible actions.**
- **Sign-out is reversible.** Adding deletion ceremony would make a routine action harder on mobile than the single click it is on desktop — the opposite of the fix.

Accidental touch is mitigated by placement rather than ceremony, and the cost of a mis-tap is one sign-in.

#### Rejected, and kept distinct from deferred

| Alternative                               | Why rejected                                             |
| ----------------------------------------- | -------------------------------------------------------- |
| **A `/settings` route now**               | Building ahead of Phase 6 and F-016 for a single control |
| **A fifth mobile tab**                    | Rejected by §16.3 above; unchanged                       |
| **Any `MobileTabBar` change**             | The four-tab shape is settled and no evidence reopens it |
| **A `<details>` disclosure**              | That convention is for irreversible actions              |
| **A confirmation dialog**                 | No such convention exists in the product                 |
| **Mobile-only (`md:hidden`)**             | Reintroduces breakpoint-conditional visibility           |
| **Behind a further personal entry point** | Would make mobile sign-out harder than desktop           |

**Deferred, not rejected:** a dedicated account/settings surface, on the trigger above; and any grouping or restyling of the owner affordances.

#### Verification expectations

Reusing the **390×844** precedent.

- **A signed-in owner at 390×844 actually signs out** — the evidence must be the **signed-out state**, not DOM presence and not merely a URL change.
- **At 390×844 the header control is not visible**, distinguishing visibility from DOM presence: it remains in the DOM inside `hidden … md:flex`.
- **The control does not render** for a visitor on another profile, nor when signed out.
- **Desktop regression:** `auth.spec.ts` already exercises the header control at desktop width and **must continue to pass unmodified**. No second desktop sign-out journey.

> **One hazard to check before writing anything.** A second control named "Sign out" makes any **unscoped** `getByRole('button', { name: 'Sign out' })` ambiguous on a profile page. The existing sites must be confirmed safe rather than assumed.

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

### 16.6 List activity — creation only, and one feed **[DECIDED and IMPLEMENTED 2026-09-05]**

**Shipped in `972b709` and deployed to staging.** The decision below was recorded before implementation and is unchanged by it; only this marker moved. **CI was still running when it was updated** — see `current-state.md` §52.

**Phase 4 slice 3 emits a feed event when a list is created, and for nothing else.** The four other list mutations — editing title/description/ranked, adding an album, removing an album, reordering — write no activity.

#### Why creation is the only interaction

**`CLAUDE.md`'s rule is that an event is generated when a user acts, at the moment they act — not for every database mutation.** Four of the five mutations edit a thing that already exists.

**The decisive repository fact is that events read live data.** `data-model.md` §7 and the `activity` migration both state it: _"Events reference live data; they never snapshot it."_ A `list_created` feed item therefore renders whatever the list holds **when the follower sees it** — its current title, its current albums, its current order. **Adding albums, renaming and reordering all improve the existing item; none of them needs an event of its own.** Reordering is the clearest case: the feed already shows the current order, so twenty reorders are one act of curation and zero events.

| Mutation              | This slice                            | Why                                                                         |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `createList`          | **Emits `list_created`**              | The interaction. `product-spec.md` §4 names list creation as feed contents  |
| `updateList`          | **No event**                          | Editing current state; the live-data read already reflects it               |
| `addAlbumToList`      | **No event — deferred, not rejected** | Genuinely interactive and genuinely unresolved. See the open question below |
| `removeAlbumFromList` | **No event**                          | A correction, not an interaction                                            |
| `reorderListItem`     | **No event**                          | Editing current state, and the feed reads the live order                    |

> **"Not part of this slice" is not "will never produce an event."** Only `reorderListItem` is argued against on its merits. The other three are **deferred**, and whether any of them should ever speak is part of the open question below.

#### `list_updated` is not built, and its enum value is not added

**Deliberate restraint, for four reasons that are not interchangeable.** Creation-only activity **cannot produce an edit burst at all** — the property is structural rather than constrained. The `activity_one_rated_per_entry` partial unique index is an available precedent for bounding repeated events, **but a bounding mechanism does not answer what a list update should communicate.** `ALTER TYPE … ADD VALUE` is **one-way** — Postgres cannot remove an enum label — so adding a value on unresolved semantics is a permanent commitment. And **under-announcing is recoverable where feed flooding is not**; `CLAUDE.md` says flooding "cannot be undone".

**This follows an existing sequencing precedent rather than inventing one.** `product-spec.md` §4 records Want to Listen as a named feed content deliberately shipped later — _"a sequencing boundary, not a reversal or a new product decision"_ — because open questions blocked it. The same applies here.

> **No future `list_updated` mechanism is settled by this record.** What it means, which mutations it covers, and how often it may speak are all open.

#### One feed, extended — not a second function

**Decision: extend `feed_activity` in place.**

**The repository fact that forces the change, and it is not visible from the signature.** The function ends with **two INNER joins** — `join collection_entries e on e.id = coalesce(a.collection_entry_id, r.collection_entry_id, v.collection_entry_id)` and `join albums al on al.id = e.album_id`. A `list_created` event has no collection entry, so **under the current function a list event would be silently dropped from the feed entirely.** Extension is therefore not additive.

**Why not a second function.** Two independently keyset-paginated streams would have to be merged while preserving a total order across page boundaries. The existing pagination is carefully reasoned — _"Keyset, not offset. Row-wise and strict… `id` is unique, so the ordering is total"_ — and **a two-cursor merge is a materially larger correctness risk than changing two joins.**

**Constraints the implementation must satisfy:**

- the return type must accommodate **list-shaped items** alongside album-shaped ones;
- the **album path must remain valid** — an album-typed event must still resolve to an album, stated as an explicit predicate rather than left to a join's side effect, following the function's own documented habit: _"Kept explicit so the intent is stated here rather than inferred from a constraint elsewhere"_;
- **list events must resolve only when the list is readable.** `lists` carries `status content_status` with `lists_public_read` as `status = 'live' or user_id = auth.uid()`, and `feed_activity` is `security invoker`, so RLS hides a removed list and the predicate must drop the row rather than emit null fields;
- **the `authenticated`-only grant must survive the drop/recreate.** The return type changes, so `create or replace` will not work. §16.5 established that privilege deliberately; **losing it silently would undo that work**;
- **`FeedItem` must become discriminated.** `src/services/social/feed.ts` currently declares `album: { mbid; title; credit; hasArtwork }` as **non-nullable on every item**. Making the union explicit forces every consumer to handle list events at compile time.

#### Deletion cascades; there is no tombstone

**Deleting a list deletes its `list_created` event.** Every existing subject column on `activity` is `on delete cascade`, and the migration states the reason: _"Undoing the action removes the event, which is what the cascades below are for."_ Retaining the event would display a claim that has stopped being true, which `data-model.md` §7 forbids, and would leave an orphaned row, which `CLAUDE.md` calls a privacy failure. **No archival or tombstone model is introduced.**

#### Two hazards, recorded because both fail quietly

**`ALTER TYPE … ADD VALUE` is one-way.** Once `list_created` is deployed it is permanent; the last reversible moment is before the migration reaches the deployed database. It also **cannot be used in the transaction that adds it**, which the list-likes cycle verified by execution.

**`activity_subject_matches_type` has no `ELSE`.** A `CASE` that falls through returns NULL, and **a CHECK constraint with a NULL result passes.** Adding an enum value without extending the `CASE` therefore leaves the new type **entirely unconstrained**. The four existing branches must also assert `list_id is null`, or a `listened` row could carry a stray list reference — the same rewrite the list-likes cycle applied to the notifications constraint.

**Feed flooding is the phase's own "single most important test"**, because its failure floods every follower and is unrecoverable. **Creation-only scope avoids repeated-edit events structurally**, which is a stronger guarantee than a constraint.

#### Why the feed surface is in scope, against the Phase 3 precedent

Phase 3 slice 2 shipped the `activity` table and its write points with **no feed query and no feed surface** — and its migration says why: _"there is no feed query and no feed surface in this slice."_ **There were none to build.** One exists now, and **Phase 4's definition of done requires that a list's creation appear in followers' feeds.** A write-only slice would not meet it, so the precedent's reason does not transfer and neither does the precedent.

#### Verification implications

The new enum value and the extended constraint must be tested; **the four excluded mutations must generate no activity rows**; rapid successive list edits must produce no burst; `feed_activity` must remain correctly keyset-paginated; **the `authenticated`-only grant must be asserted present after recreation**; readable and RLS-hidden lists must resolve differently; deleting a list must remove its event; and the four existing activity types must retain their behaviour. **Exact tests and assertions belong to STEP D.**

#### Open, and not answered here

- **What `list_updated` should mean.**
- **Which future list mutations, if any, should produce activity.**
- **How frequently future update activity should be emitted.**
- **Whether any `feed_activity` consumer outside `src/services/social/feed.ts` and `src/components/FeedItem.tsx` assumes `album` is always non-null.** Those two were inspected; the sweep was **not exhaustive**, and **STEP D must confirm before changing the return type.**

---

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

### 16.7 `AlbumSummary` gains artists, and only where a credit is printed **[DECIDED 2026-09-15]**

**`AlbumSummary` is the type every grid, list and search result uses.** It is a `Pick` over `Album` carrying `display_credit` — a denormalised string — and **no artist relation at all**. The linkable identity lives in `album_artists → artists`, which only the album page reads. That asymmetry is what made artist credits inert everywhere except one page (`product-spec.md` §6, _Reaching an artist from a credit_).

**Decided: the artist embed is added to the queries whose results render a caption, and to no others.** `album_artists(position, artists(id, mbid, name))`, ordered by `position`, exactly as the album page already embeds it.

**Widening the shared type unconditionally was rejected.** `AlbumSummary` is consumed by surfaces that print no credit — the collection grid carries none by `design-reference.md` §11.9, and the artist page suppresses one equal to its own subject. Adding the embed to the base type would make **every** consumer pay a join for a value most of them never render, on the product's highest-traffic reads. The caption-bearing shape is therefore a distinct type built on `AlbumSummary` rather than a widening of it.

**The cost is smaller than first assumed, and the reason is worth recording. [MEASURED AT STEP D 2026-09-15]** Only four renderings print a credit: Home, Browse's _Recently added_, a **ranked** list's rows, and the artist page. **Browse's _Popular_ section passes no captions and an unranked list renders a caption-free grid**, so `getPopularAlbums` needs no change at all — and since discovery owns a separate column list and its own mapper, it stays lean without being asked to. `ALBUM_SUMMARY_COLUMNS` already feeds both `getRecentAlbums` and `getArtistByMbid`, so **two query sites carry the embed rather than three.** Browse renders 48 albums across its two sections and Home 12; the embed adds a few artist rows per album on the captioned half only. **The runtime figure is a measurement owed at implementation, not a claim settled here.**

**The type enforces this rather than a convention asking people to remember it. [DECIDED 2026-09-15]** `AlbumGrid`'s props are a union in which **`showCaptions` accepts only the artist-bearing type**. If `design-reference.md` §11.11's trigger ever fires and _Popular_ becomes the captioned lead again, that surface **fails to compile** until its query carries artists — rather than silently rendering a caption of dead text. This is the same failure shape `artist-depth.ts` already corrected once, where an unenumerated state quietly took another's treatment; here it is closed by construction instead of by review.

**Where the rule lives.** Which artists a credit resolves to, and in what order, is domain logic: a native client would need it to render a credit correctly, so by `CLAUDE.md`'s test it belongs in `src/services/` alongside the existing mapping, not in the component. **The component decides only what a link looks like.**

**The pseudo-artist suppression is service-side for the same reason.** `isExcludedFromExpansion` already owns the single `Various Artists` identifier in `src/services/catalogue/artist-depth.ts`; the caption rule consults that same constant rather than introducing a second copy of it. **One identifier, one home** — duplicating it into a component is how the two would later disagree.

### 16.8 `search_albums` returns the embed's own shape **[DECIDED 2026-09-15]**

**Search could not take §16.7's route, and the reason is structural.** `searchCatalogue` reads the `search_albums` **RPC**, whose columns are fixed by a SQL function signature — there is no PostgREST embed to widen, and `AlbumHit` is its own type carrying `tier` and `popularity_score` rather than an `AlbumSummary`.

**Two routes existed and the migration was chosen deliberately.** A second service-layer query could have taken the returned album ids and fetched `album_artists` for them, stitched in TypeScript — **no migration, one extra serial round trip on every search.** Instead the function aggregates artists itself, so the whole result arrives in **one round trip** on a latency-sensitive surface that `current-state.md` §8 already flags as slow. **The cost is that this cycle carries a migration and therefore re-gates STEP J**, which the alternative would have avoided.

**The aggregate returns exactly the shape the PostgREST embed returns**, `{ position, artists: { id, mbid, name } }` ordered by `position` — so **`toCreditedArtists` serves both paths unchanged**. That is the point of the choice rather than a happy accident: two producers of the same value would otherwise drift, and the drift would be invisible because each surface looks right alone. Ordering is applied inside `jsonb_agg` _and_ re-applied by the mapper; the belt is cheap and the mapper is the one place the rule is stated.

**The return type changes, so `create or replace` cannot be used.** Postgres refuses to alter an existing function's return type, so the migration **drops and recreates** — and a drop **takes the function's privileges with it**.

**That makes §16.5 load-bearing here rather than incidental.** Measured before the change, `search_albums` was executable by `anon`, `authenticated` and `service_role`, with `PUBLIC` revoked. A recreated function starts from Postgres's default of `EXECUTE` to `PUBLIC`, so the migration **revokes from `PUBLIC` and then names all three roles explicitly** — reproducing the measured end state rather than trusting the recreate to inherit it. **Signed-out search is a shipped feature and signed-in search is the common case**, so dropping either `anon` or `authenticated` would be a live outage rather than a tightening.

### 16.9 Account status is a read-path rule, and every read path owes it **[DECIDED 2026-09-22]**

**`profiles.status` and `content_status` have existed since Phase 0**, placed deliberately — `product-spec.md` §4 records _"content and users carry status fields from day one"_. What never existed is a **rule** saying who must consult them, so each call site decided for itself and three decided wrong.

**Audited 2026-09-22, against the deployed schema.** Already correct: all five `/[handle]` routes `notFound()` on a non-active profile; `feed_activity` filters `actor.status = 'active'` in SQL; `search_artists` and the profile search filter active; follower and following counts filter on **both** sides of the edge with `!inner`; removed reviews and lists are hidden by RLS while remaining readable to their author.

**Three gaps, every one reachable today by setting a status by hand:**

| Where             | What survives a suspension                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getAlbumRating`  | **The rating still moves the album average.** Counted with no reference to who left it                                                                       |
| `getAlbumReviews` | **The review stays on every album page**, with handle and avatar, linking to a profile that 404s. The review's _own_ status is filtered; its author's is not |
| `listLikeCount`   | **The like still counts.** Every row for the list, unfiltered                                                                                                |

**The inconsistency is the finding rather than the three defects.** The follow graph filters status; likes and ratings do not. Nothing stated a rule, so the question was answered independently each time — and the album average is the worst case, because brigading with a throwaway account is precisely the behaviour a ban exists to undo, and banning currently does not undo it.

**The rule, stated so the next call site does not have to decide.** _A read that surfaces user-authored content, or a count derived from it, filters on the author's `status` as well as the content's._ The mechanism is the one the follow graph already uses: embed the profile with `!inner` and add `.eq('…status', 'active')`.

**Service layer, not RLS, and the reason is a product question rather than a preference.** §5 puts authorisation in the service layer with RLS as defence in depth, which is the established shape here. **RLS is deliberately untouched**: a status filter there would also hide a suspended person's own collection, ratings and reviews **from themselves**, and whether a suspended account can still read its own data is undecided. Answering it silently through a policy change would be a scope violation, not an implementation detail.

**`suspended` and `banned` hide content identically.** Every enforced surface already treats both as "not active", and the distinction between them concerns the account's **own** access — whether it can sign in and write — which belongs to the slice that builds the actions, not to this one.

**A fourth gap was found at STEP G, after the rule was written down.** `getList` filtered the list's own status — RLS does that — but never its author's, so a **live list by a suspended author stayed publicly readable** while every one of that author's profile routes returned 404. It is fixed under the same rule, and its discovery is the argument for the rule existing: the audit that produced the first three was careful and still missed one.

### 16.9a Notifications keep a suspended actor, and stop linking to them **[RESOLVED 2026-09-24 — raised 2026-09-22]**

**`NOTIFICATION_SELECT` does not filter the actor's status.** A person who followed you or liked your review and has since been suspended still appears in your notifications, linking to a profile that 404s.

**This is not obviously a defect, which is why it is not fixed here.** `product-spec.md` §425 makes the disappearance rule explicitly about the **feed**, and §16.3 holds notifications **disjoint** from it: a notification is a private record of something that happened _to you_, and removing it rewrites your own history rather than withdrawing someone's publication. The opposite case is just as arguable — a dead link and a hidden account are exactly what a suspension should stop surfacing.

**Decided: the notification stays, and the actor stops being a link.**

**The record is the point, and hiding it would destroy evidence.** A notification may be the only trace that an interaction happened — and if somebody was suspended _for_ harassing you through follows, removing their notifications erases your account of it at exactly the moment it matters. **Consistency with the feed was the argument for hiding, and it is the weaker one**: the feed publishes to other people, while a notification is your own private history.

**So the actual defect was narrower than the question suggested.** Nothing was wrong with the notification existing; what was wrong was the **link to a profile that returns 404**. The handle renders as unavailable instead.

**This closes §16.9's narrowing honestly rather than widening it.** Every read path that **publishes user content to other people** is enforced, and the one directed, private surface deliberately is not — **because it is a record rather than a publication.**

**The deliverable is the enumerated test, not the three fixes.** The same shape as the account-deletion orphan test: create a user holding a rating, a review, a list and a like; suspend them; assert each surface stops showing it. **A surface added later fails that test until somebody has thought about it**, which is the only durable version of "every read path".

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

## 17a. A temporary operator surface for the ingestion queue **[DECIDED 2026-09-13]**

**Decision: an unlinked, `noindex` page showing queue state, gated by a secret query parameter matched against an env var, carrying its own removal trigger on the page itself.**

**Why it exists.** Queue state has been observable only by querying the deployed database by hand. Across several cycles the maintainer has had to accept reported numbers — _"7 chart rows against a limit of 24"_, _"226 albums without covers"_, _"Radiohead re-queued as `#1630`"_ — with no way to see them. **§17 already names work that stops silently as a failure class this project worries about; this is the instrument for noticing it.**

**Why a secret parameter and not a privileged user. [The load-bearing part of this decision]** `CLAUDE.md` holds that everything user-generated is public, with no private accounts, and longplayr has **no admin or operator role**. **Introducing a privileged-user model for a temporary page would outlive the page** — that is how a diagnostic becomes architecture. A secret parameter reuses the pattern `cron-auth.ts` already establishes, introduces no permanent concept, and is **temporary by construction**.

**Its weakness, stated rather than discovered.** A secret in a URL lands in browser history, referrer headers and any intermediate proxy log. **That is an acceptable trade for a read-only diagnostic with a recorded removal trigger, and it would not be acceptable for anything that writes.** The page performs no mutation of any kind.

**It fails closed in production and open in development**, mirroring `authoriseCronRequest` exactly, and for the same stated reason: a misconfigured deployment must not expose it.

**What it shows.** Queue depth by kind and status; **the next jobs in the drain's own claim order** — `priority asc, id asc` filtered on `run_after <= now()` — so _"which is next"_ is answered by the same ordering the drain uses rather than by a plausible-looking approximation; per job, its kind, target, priority, `attempts`, `run_after` and `last_error`; **a plain-language state for each** — running, backing off until a time, waiting for a drain, or terminally failed awaiting the sweep; artwork coverage counts; and **when a drain last actually ran**, which is how the §7 cadence change is confirmed.

**`last_error` is shown here and nowhere else.** It carries upstream diagnostics — `503 for /release-group … [zone=global remaining=13/15]` — which is operator text. `product-spec.md` §6 keeps it off reader-facing surfaces.

**Queries live in `src/services/`**, per the no-SQL-in-components rule. `queueDepth` already exists; the claim-ordered read is new and is a read only — **it must not call `claim_ingestion_jobs`**, which would mark rows `running` and spend their attempts merely by someone looking at the page.

**This is the first page in `src/app` to use the service-role client, and that is forced rather than chosen.** `ingestion_jobs` grants **only to `service_role`** with RLS enabled and no `anon` or `authenticated` grants, so **a non-admin client cannot read the queue at all** — there is no lesser-privileged option to prefer. Recorded because the pattern is new and a reader might otherwise copy it onto a page where it is _not_ forced. **Two things make it safe here and both must survive any edit:** the authorisation check runs **before** `inspectQueue()` is called, so an unauthorised request never reaches a service-role read; and the module contains **no write verb of any kind** — no `insert`, `update`, `upsert`, `delete` or `rpc`. **If either changes, the access model in this section is no longer adequate.**

**Removal trigger, recorded because "temporary" without one is permanent. [OPEN until acted on]** The page is removed when either holds: the ingestion queue is no longer under active investigation, **or** longplayr takes its first real users — whichever comes first. **The page states this on itself**, so the trigger travels with the thing rather than living only here.

**Not product scope.** This is a diagnostic tool, not a feature. It is recorded here rather than in `product-spec.md` deliberately, and **it must not be mistaken for the beginning of an admin surface** — Phase 6's moderation tooling is unrelated and unaffected.

### 17b. The artwork worklist — the queue view's one actionable section **[DECIDED 2026-09-16]**

**§17a gave the queue view counts; this gives it the one list a person can act on.** `/debug/queue` already renders `artwork_status` totals, so the maintainer can see that covers are missing and **not which albums**. The manual path has been _notice a placeholder, find the album on MusicBrainz, find the right release, upload_ — a search every time, for a gap that no amount of drain cadence closes.

**Two groups, because they ask different things of the reader. [DECIDED 2026-09-16]** `absent` means **Cover Art Archive genuinely holds no image**, so a person must upload one — actionable, and each row carries a deep link. `failed` means **our own fetch broke**, and the artwork sweep re-queues it on any drain — **informational, and deliberately not presented as a task**. Collapsing the two would ask the maintainer to do work the system is still retrying, which is the worst thing a worklist can do.

**The deep link is to a release, not a release-group, and that is a different identifier from anything the artwork path builds.** MusicBrainz's add-cover-art page hangs off a release; `artwork.ts` deals only in release-group MBIDs against `coverartarchive.org`. The target comes from `albums.representative_release_id → releases.mbid`.

**`representative_release_id` is nullable, and those rows are shown rather than hidden. [DECIDED 2026-09-16]** An album without one has no page to link to. **It still appears, with the link disabled and the reason stated**, because a worklist that silently drops rows hides the exact problem it exists to surface and leaves a count that no longer matches reality — §17's failure class, reproduced by the instrument meant to detect it.

**It reads and never writes, exactly as §17a requires**, and the two properties that make the service-role client safe on that page are unchanged: authorisation runs before the read, and the module contains no write verb. **No new access model is introduced** — the same secret query parameter, the same `notFound()` refusal, the same printed removal trigger. **A second temporary page would mean a second access story and a second thing to remember to delete.**

**The embed must name its foreign key.** `releases.album_id` and `albums.representative_release_id` are two relationships between the same two tables, so a bare `releases(...)` embed fails outright — the hazard `CLAUDE.md` records, arriving here for the second time in the codebase.

### 17c. Whether a missing release date was ever a capture fault **[DECIDED 2026-09-17]**

**An album with no year is expected; an album whose payload had one is not.** `parsePartialDate` returns null on exactly two paths: the upstream value is **absent or empty**, and the upstream value is **present but fails the `YYYY(-MM)?(-DD)?` pattern**. The first is upstream truth — release groups, especially compilations, remix collections and live releases, frequently carry no first-release-date. **The second is silent loss**, and nothing in the product records whether it has ever happened.

**Their position on the last page is designed behaviour and not a symptom.** The year sort places undated releases last deliberately, in both directions (`product-spec.md` §6). **What is unestablished is their emptiness, not their placement.**

**§7a is what makes this answerable at all, and cheaply.** Every upstream response is kept **verbatim and indefinitely**, so the stored payload for an album can be compared against its columns **with no MusicBrainz round trip and no rate-limit exposure**. Without that decision this question would require re-fetching the catalogue at one request per second.

**Decided: the comparison becomes a section on `/debug/queue` rather than a one-off script or a hand-run query.** The operator page already exists, already reads with the service-role client, already carries secret-link access and a `notFound()` refusal, and already prints its own removal trigger. **A one-off answer would be true on the day it was run and unreconsultable afterwards**, and the catalogue keeps growing — so the question would have to be re-asked by hand every time somebody wondered.

**It reads and never writes, which is what keeps §17a's two safety properties intact**: authorisation runs before the read, and the module contains no write verb.

**Remediation is explicitly a separate decision. [DECIDED 2026-09-17]** If payloads turn out to hold dates the columns lack, **this cycle reports it and stops.** A backfill rewrites catalogue rows from stored payloads — a different risk with a different blast radius — and **a fault discovered mid-investigation must not silently become a migration.** It gets its own entry, ranked against everything else.

## 18. Verification required before implementation

Claims in this document that must be confirmed against current documentation rather than assumed:

| Item                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **fanart.tv terms and rate limits**              | ⚠️ **[VERIFY] — raised 2026-09-16.** Proposed as a second artwork source (F-012). **The keying objection that rejected iTunes and Deezer does not apply**: it is keyed by MusicBrainz ID, the same key §7 already fetches on, so the "wrong cover on the wrong album" failure is not in play. **Licensing, attribution and rate limits are unverified, and nothing may depend on it until they are.** The decision was explicitly deferred pending this row rather than made                                                                                                   |
| **Discogs API terms**                            | ⚠️ **[VERIFY] — raised 2026-09-16, flagged by F-010 as absent from this table entirely.** Named as recorded direction in §7a and as an open enrichment question in `product-spec.md` §8.9, **while never having been checked.** Reportedly 60 req/min authenticated, but also reportedly forbids caching content longer than necessary and displaying content more than **six hours** staler than their own site. **If accurate that is incompatible with `upstream_payloads`**, which stores responses verbatim and indefinitely with no refresh policy                       |
| **What MusicBrainz will and will not accept**    | ⚠️ **[VERIFY] — raised 2026-09-16.** Load-bearing for `product-spec.md` §8.9's _closing a gap means fixing it upstream_ principle, and for a **collision with a non-negotiable**: if longplayr ever wants material MusicBrainz refuses, it must author metadata, which `CLAUDE.md` forbids. **The premise may be wrong and checking it may dissolve the conflict** — secondary release-group types reportedly include DJ-mix, Remix, Live, Compilation, Soundtrack, Mixtape/Street and Demo, with Bootleg available as a release status. **Unverified; must not be relied on** |
| **Apple / iTunes Search API terms**              | ✅ **Resolved.** Terms do not permit our use, and ~20 req/min is too tight. Rejected — see §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Deezer API terms**                             | ✅ **Resolved.** Prohibits storing images. Rejected — see §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **MusicBrainz rate limit and User-Agent policy** | ✅ **Confirmed.** 1 req/sec per IP; `503` on all requests when exceeded; User-Agent with contact details mandatory                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Cover Art Archive**                            | ✅ **Confirmed.** Release-group front endpoints at 250/500/1200px, `404` when absent, no rate limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ListenBrainz statistics endpoints**            | ✅ **Confirmed.** `/1/stats/sitewide/release-groups`, public, `range` and `count` parameters. ⚠️ **MBIDs are optional in responses** — entries without one must be filtered out                                                                                                                                                                                                                                                                                                                                                                                                |
| **Supabase Auth capabilities**                   | ✅ **Confirmed in Phase 0.** Email/password working. Google OAuth still unbuilt — see `docs/deployment.md` §4                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Supabase Auth email rate limits**              | ✅ **Confirmed 2026-09-15** against the Auth rate-limits guide: **2 emails/hour project-wide on the built-in provider**, configurable under custom SMTP or the Send Email hook; **`/auth/v1/resend` carries a 60-second per-user window whatever the provider**. The project-wide cap is why confirmation cannot be enabled without custom SMTP — see §6                                                                                                                                                                                                                       |
| **Vercel Hobby cron limits**                     | ✅ **Confirmed 2026-09-13** against the cron usage page (updated 2026-07-15): **100 cron jobs per project**, minimum interval **once per day**, precision **per-hour (±59 min)**. **The cap is per expression, not per project per day** — see §7, _Cadence is per cron, not per day_. This document had asserted the opposite inference in three places                                                                                                                                                                                                                       |
| **Next.js caching semantics**                    | ⏳ Outstanding. Matters from Phase 1, when album pages become the first genuinely cacheable surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

---

## 20. Documentation structure — written for the record, read by an agent **[DECIDED 2026-09-26]**

**Raised by the maintainer** (`product-feedback.md` F-057), who builds this project through an agent under light direction and asked whether the documents are shaped for the thing that reads them. **Length was explicitly not the complaint** — long is fine if it is navigable.

### 20.1 What was measured

**2026-09-26.** The corpus is **269,567 words, roughly 360,000 tokens, across 16 files** — more than fits in one context window.

| File                       | ~Tokens | Read              |
| -------------------------- | ------- | ----------------- |
| `CLAUDE.md`                | 11,300  | **every session** |
| `docs/current-state.md`    | 154,000 | on demand         |
| `docs/architecture.md`     | 59,100  | on demand         |
| `docs/product-feedback.md` | 47,400  | on demand         |
| `docs/product-spec.md`     | 38,000  | on demand         |
| the remaining eleven       | 50,400  | on demand         |

**Three findings, each measured rather than asserted.**

**`CLAUDE.md` tells a session to read `current-state.md` first, and it is too large to read.** So a session reads the top and stops, which makes the remainder write-only. Documentation written every cycle and never read is pure cost.

**Its newest 1,683 lines hold 166 headings, every one of them nested inside a blockquote.** The region is fully structured and the structure is invisible to heading search, outline view and table-of-contents generation alike. **The first characterisation of this — "one heading" — was wrong and is corrected here rather than quietly restated**; the distinction matters because it makes the fix a formatting change rather than a rewrite. The blockquote was a copy-paste convenience for the maintainer and is **no longer wanted** (decided 2026-09-26).

**No document has a table of contents**, and section sizes defeat section-level reading anyway: the largest single section is **11,415 words in this file** and **33,111 in `product-feedback.md`**.

### 20.2 The evidence that it is harmful, not merely large

**Two failures on one day, both found by accident and neither by a check.**

**`product-feedback.md` F-004 read `NOT YET BUILT` for eight days after readable slug URLs shipped** on 2026-09-18 behind three migrations. STEP A ranks candidates from that file, so an inbox showing delivered work as an open complaint corrupts the ranking directly.

**`CLAUDE.md` states that Phases 6 and 7 are _entirely unbuilt_, and Phase 6 slices 1 and 2 are in production** — `/admin`, `src/services/admin/`, status enforcement across five services, and `20260922120000_admin_and_column_privileges.sql`. **That is the file loaded into every session**, and it misinformed the STEP 00 that found it.

**Neither is a drafting slip. Both are what accretion does**, and both are staleness rather than verbosity — which is what the boundary in §20.6 is drawn around.

### 20.3 The decision

**`docs/current-state.md` splits by kind at §13.** Standing sections **§1–§12** — current state, completed work, residual items, open decisions, recorded direction, technical state — stay. Cycle checkpoints **§13–§96** move to **`docs/cycle-log.md`**, append-only, newest first.

**The line is not arbitrary.** It is where the document's own two numbering conventions already meet, and it keeps every standing section a code comment might sensibly cite.

**STEP K's behaviour changes with it.** `current-state.md` is **rewritten** each checkpoint to describe the present; the checkpoint is **appended** to `cycle-log.md`. The file's stated purpose — _where we are right now_ — and its append-only construction were in direct contradiction, and the purpose wins.

**Nothing is renumbered, rewritten or deleted.** Section numbers stay byte-identical, bodies are untouched, and only heading _format_ is normalised to `## §N — Title` so one table of contents can cover the merged log. **Historical integrity forbids the alternative**, and a renumber would break 811 internal references, 78 external ones and 428 in source and migration comments.

### 20.4 Bare `§N` resolves by a stated rule, and that is what keeps this cheap

**Code, tests and migrations carry bare `§N` references to checkpoints** — §39, §46, §87, §91 and §94 appear in `src/services/export/index.ts`, `src/app/lists/[id]/page.tsx`, three integration suites and two migrations — **naming no file**.

**Both documents therefore carry a header line**: _§1–§12 are in `current-state.md`; §13 onward in `docs/cycle-log.md`._ A bare `§94` then resolves deterministically, which is **more than it does today**, where it resolves only by already knowing.

**This is the decision that keeps the change documentation-only**, and it was taken for that reason as much as for tidiness. Qualifying those references in place would edit ten code, test and migration files, pull in CI, and — with Actions minutes exhausted until 1 October — strand the work at STEP I.

### 20.5 Considered and rejected

**Renumbering into a clean sequence.** Rejected: breaks every reference above, and edits history that Historical integrity protects.

**Deleting superseded checkpoints.** Rejected on the same rule. Every recommendation here is a move.

**Shortening `CLAUDE.md` by removing its wording-archaeology** — the 15 amendment markers and 6 passages describing what it used to say. **Rejected for now, having been proposed by the agent that would benefit.** The payoff is roughly 3,000 tokens a session; it is the riskiest edit of the set, because sometimes the history _is_ the rationale and a bare rule loses the argument that protects it; and **both measured failures were staleness, not length**. Revisit with evidence once the split is in.

**Splitting the oversized sections in this file and in `product-feedback.md`.** Deferred. Their table-of-contents entries will make the size visible, which is the right input to that decision.

### 20.6 Boundary

**In scope**: the `current-state.md` split; removal of the blockquote wrapper; heading-format normalisation in the log; a table of contents for every long document; and three specific `CLAUDE.md` edits — STEP K's definition, the documents table, and the stale Phase 6 claim.

**Out of scope**: any content edit for accuracy or length, anywhere. **`current-state.md`'s standing sections almost certainly hold stale claims** — finding them is STEP K's standing job, not this cycle's, and conflating the two would make the move impossible to verify.

**What this does not fix, stated rather than glossed.** The corpus is still ~360,000 tokens. **This makes it navigable, not smaller.** The one file that shrinks is the one every session is told to read first. `CLAUDE.md` remains 11,300 tokens on every turn, and F-057's question about it stays open.
