# longplayr

A social music platform: users record the albums they've listened to, rate and review them, build lists, follow each other, and discover music through that activity.

**Current state: Phase 0 (foundation).** Auth, profiles, tooling and CI. The catalogue, collection and social features are not built yet — see `docs/development-plan.md` for what belongs to which phase, and do not build ahead of the current phase without saying so.

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

Comments, private accounts, track-level features, streaming integration or OAuth, algorithmic recommendations, passive scrobbling, in-app playback, direct messages, gamification. Each is deferred with reasoning in `docs/product-spec.md` §7. Do not add any of them without an explicit scope decision.

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

| File                           | Contents                                                               |
| ------------------------------ | ---------------------------------------------------------------------- |
| `docs/product-spec.md`         | What longplayr is, MVP scope, deferrals, open product decisions        |
| `docs/design-reference.md`     | Letterboxd analysis, what to borrow/adapt/avoid, original design needs |
| `docs/data-model.md`           | Conceptual entities and relationships                                  |
| `docs/architecture.md`         | Technical decisions with alternatives and reasoning                    |
| `docs/development-plan.md`     | Phased implementation sequence                                         |
| `docs/claude-code-playbook.md` | How to work in this repo with Claude Code                              |

`transcript.md` and the three `claude-*` docs are reference material. Do not modify them.

---

## Working in this repo

```bash
npm run db:start && npm run db:env   # local Supabase (Docker), then write .env.local
npm run dev                          # http://localhost:3000
npm run verify                       # exactly what CI runs — run before pushing
```

`npm run verify` covers format, lint, typecheck, unit and component tests, and build. Integration and end-to-end tests need the database and run separately: `npm run test:integration`, `npm run test:e2e`.

### Conventions established in Phase 0

- **Every new table needs explicit `grant` statements** for `anon`, `authenticated` and `service_role`, alongside its RLS policies. Grants are evaluated _before_ RLS — without them you get `permission denied` no matter how permissive the policies are. This is easy to forget and the failure looks like an RLS bug.
- **Migrations are the only way to change schema.** After changing one, run `npm run db:reset` then `npm run db:types`. Never hand-edit `database.types.ts`.
- **Expected failures return `Result`, not exceptions** (`src/services/result.ts`). A taken handle is an outcome the UI renders. Genuinely unexpected failures still throw.
- **Auth goes through `src/services/auth/`**, never directly to Supabase — auth is the most expensive thing here to migrate.
- **Styling is provisional.** `globals.css` holds neutral placeholder tokens, deliberately not a design system. The real palette, type scale and grid come from the design-foundation track before Phase 2.

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
