# longplayr

A social music platform: users record the albums they've listened to, rate and review them, build lists, follow each other, and discover music through that activity.

**Current state: Design foundation complete. Phase 2 has not started.** See `docs/current-state.md` for exactly where things stand and what to do next. `docs/development-plan.md` defines what belongs to which phase — do not build ahead of the current phase without saying so.

---

## Non-negotiable rules

These are decided. Do not change them without raising the decision explicitly first.

- **One collection entry per user per album, permanently.** longplayr is a collection, not a dated diary. An album appears in a collection exactly once no matter how many times it's played.
- **Profiles never display dates.** Timestamps exist in the data and drive sort order and feed eligibility. They are not rendered on profiles or collections.
- **Only today-dated adds and relistens generate feed events.** Undated and backdated adds are silent. Breaking this floods every follower's feed and cannot be undone.
- **Singles are never ingested.** Catalogue scope is albums, EPs and mixtapes — including live albums, compilations and soundtracks. Enforced at ingest, not at query time.
- **The catalogue is read-only downstream of MusicBrainz.** No user-authored metadata, ever.
- **Ratings are optional, 0.0–10.0 to one decimal.** Unrated entries are excluded from averages.
- **Tracks are never rated, reviewed, logged or listed.** Tracklists are display-only.
- **Everything user-generated is public.** No private accounts, no per-entry visibility.
- **Account deletion is a hard delete** with a complete cascade. An orphaned row is a privacy failure.
- **No SQL or database client calls inside React components.** Everything goes through the service layer.
- **MusicBrainz is rate-limited to one request per second per IP.** Exceeding it returns `503` for _every_ request from that address, not just the excess. Always go through `src/services/catalogue/rate-limiter.ts`; never fetch in a loop.
- **No live MusicBrainz ingestion until `MUSICBRAINZ_CONTACT` is a real contact URL.** Local development uses a placeholder and the client refuses to make live requests while it looks like one. This is enforced in code — do not work around it.

## Deliberately not in scope

Comments, private accounts, track-level features, streaming integration or OAuth, passive scrobbling, in-app playback, gamification. Each is deferred with reasoning in `docs/product-spec.md` §7. Do not add any of them without an explicit scope decision.

**Direct messaging and taste overlap left this list on 2026-08-18 by explicit scope decision** — the mechanism this section requires. Both are now recorded direction in `docs/product-spec.md` §10. **Neither is implemented, neither is scheduled, and both carry unresolved product questions that must be asked rather than inferred.** Messaging additionally has a blocking legal-research precondition (§10.4). Nothing here authorises building either one.

## Recorded direction is not scope

`docs/product-spec.md` §10 records product direction that is **decided but deliberately unbuilt**: Want to Listen, taste overlap, profile photo/bio/city, and direct messaging. Dating-specific profile fields are explicitly excluded.

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

| File                           | Contents                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| `docs/product-spec.md`         | What longplayr is, MVP scope, deferrals, open product decisions         |
| `docs/design-reference.md`     | Letterboxd analysis, what to borrow/adapt/avoid, original design needs  |
| `docs/data-model.md`           | Conceptual entities and relationships                                   |
| `docs/architecture.md`         | Technical decisions with alternatives and reasoning                     |
| `docs/development-plan.md`     | Phased implementation sequence                                          |
| `docs/deployment.md`           | Steps requiring accounts: GitHub, Supabase, Vercel, MusicBrainz contact |
| `docs/current-state.md`        | **Where we are right now.** Read this first when resuming work          |
| `docs/claude-code-playbook.md` | How to work in this repo with Claude Code                               |

`docs/current-state.md` is the lowest authority and goes stale fastest — it describes progress, never decisions. Anything it says that contradicts this file or the specs is wrong.

`transcript.md` and the three `claude-*` docs are reference material. Do not modify them.

---

## Working in this repo

```bash
npm run db:start && npm run db:env   # local Supabase (Docker), then write .env.local
npm run dev                          # http://localhost:3000
npm run verify                       # exactly what CI runs — run before pushing
```

`npm run verify` covers format, lint, typecheck, unit and component tests, and build. Integration and end-to-end tests need the database and run separately: `npm run test:integration`, `npm run test:e2e`.

> **⚠️ `npm run test:integration` DELETES ALL CATALOGUE DATA.**
>
> The integration suite truncates `albums` and `artists` in `beforeEach` and again in `afterAll`. Running it against a seeded database destroys the catalogue — silently, and in seconds, where re-seeding takes minutes of rate-limited requests.
>
> **Never run catalogue seeding and the integration suite against the same database** without expecting to lose the data. Seed after testing, not before. This has already happened once mid-session.

**Always verify from a clean build.** `rm -rf .next && npm run verify`. This is a standing requirement, not a suggestion: `PageProps` and `LayoutProps` are generated into `.next/types`, so a stale directory can make typecheck pass locally while failing in CI. That exact discrepancy has already put a red commit on `main` once.

**There is no branch protection.** GitHub gates it behind a paid plan for private repositories, and paying or going public purely for that has been declined. Nothing mechanically prevents a red commit landing on `main`, so the clean-build check above is the actual safety net. Treat it accordingly.

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

## Working agreement

**Surface material decisions before acting on them.** Anything affecting product, UX, data model, architecture, security, privacy, or external services gets presented — decision, why it matters, options, recommendation, tradeoffs, consequences, reversibility — and waits for an answer. A permission prompt is not approval of the underlying decision.

Low-risk editorial choices (file names, structure, wording, formatting) don't need approval. If unsure whether something is material, treat it as material.

**Use plan mode** before any non-trivial change, and always for schema changes and auth-adjacent work.

Items marked **[OPEN]** in the docs are unresolved by design — raise them, don't resolve them silently. Items marked **[VERIFY]** in `docs/architecture.md` §18 must be checked against current documentation before the code that depends on them is written.

**No Claude Code infrastructure** — agents, skills, hooks, MCP servers, worktrees — until there's a demonstrated need. See `docs/claude-code-environment.md`.
