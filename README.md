# longplayr

Keep a record of the albums you listen to. Rate them, write about them, and see
what other people are hearing.

**Status: Phase 0 (foundation).** Auth, profiles and the deployment pipeline.
The catalogue, collection and social features arrive in later phases — see
`docs/development-plan.md`.

## Getting started

Requires Node 22+ and Docker Desktop.

```bash
npm install
npm run db:start     # boots local Supabase (first run pulls ~2GB of images)
npm run db:env       # writes .env.local from the running stack
npm run dev          # http://localhost:3000
```

You do **not** need a Supabase or Vercel account to develop locally. The local
stack runs the real Postgres and the real auth server in Docker.

### Docker memory

The local stack needs roughly **4–6 GB** allocated to Docker. Below that,
containers miss their health checks and `supabase start` rolls back with
`LegacyHealthCheckTimeoutError`.

We keep the stack deliberately small — Realtime, Storage, Edge Runtime and
analytics are disabled in `supabase/config.toml`, each with a comment explaining
why. Re-enable Storage when the artwork pipeline lands in Phase 1.

### Confirmation emails

Local sign-up emails are caught by Mailpit rather than sent. `npm run db:env`
prints its URL.

## Commands

| Command                        | Does                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `npm run dev`                  | Development server                                              |
| `npm run build`                | Production build                                                |
| `npm run verify`               | Everything CI runs: format, lint, types, tests, build           |
| `npm test`                     | Unit and component tests                                        |
| `npm run test:integration`     | Service and schema tests (needs the database)                   |
| `npm run test:e2e`             | Playwright end-to-end tests                                     |
| `npm run db:start` / `db:stop` | Local Supabase up / down                                        |
| `npm run db:reset`             | Drop and re-run all migrations                                  |
| `npm run db:env`               | Regenerate `.env.local` from the running stack                  |
| `npm run db:types`             | Regenerate `src/lib/supabase/database.types.ts` from the schema |

Run `npm run verify` before pushing — it is exactly what CI checks. Always from
a clean tree: `rm -rf .next && npm run verify`.

> **⚠️ The integration suite deletes all catalogue data.** It truncates `albums`
> and `artists` between cases. Seeding takes minutes of rate-limited requests;
> destroying it takes seconds. Seed _after_ running tests, never before.

## Structure

```
src/
  app/          routes, pages and server actions
  services/     ALL database access lives here (see src/services/README.md)
  lib/supabase/ Supabase client construction — imported only by services
  proxy.ts      session refresh (this is Next 16's renamed middleware)
supabase/
  migrations/   schema, applied in order
docs/           product spec, architecture, data model, plan
```

**No SQL or Supabase client calls in components.** Everything goes through
`src/services/`. A lint rule enforces this.

## Working on this project

Start with `CLAUDE.md`, then:

| Document                   | Contents                                     |
| -------------------------- | -------------------------------------------- |
| `docs/product-spec.md`     | What longplayr is, MVP scope, open decisions |
| `docs/architecture.md`     | Technical decisions and their alternatives   |
| `docs/data-model.md`       | Entities and relationships                   |
| `docs/development-plan.md` | Phases and definitions of done               |
| `docs/design-reference.md` | Design direction and Letterboxd analysis     |

## Notes on versions

This project uses **Next.js 16**, which renamed middleware to `proxy.ts` and
made request APIs (`cookies()`, `params`, `searchParams`) async. Its bundled
documentation lives in `node_modules/next/dist/docs/` and is worth reading
before assuming an older API still applies.
