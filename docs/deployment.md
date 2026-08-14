# Deployment

Everything below needs accounts, so it needs you rather than an agent. Local
development works without any of it — see `README.md`.

Phase 0 is complete locally. These steps finish it by adding staging,
production and CI enforcement.

---

## 1. GitHub — done, except branch protection

**Repository: <https://github.com/darrylnatale/longplayr> (private).**
`origin` is configured and `main` is pushed.

### Branch protection is blocked — needs a decision

Both mechanisms were attempted via the API and **both returned 403**:

| Attempt                     | Result                                                 |
| --------------------------- | ------------------------------------------------------ |
| Classic branch protection   | `Upgrade to GitHub Pro or make this repository public` |
| Repository rulesets (newer) | Same message                                           |

GitHub gates branch protection on **private** repositories behind a paid plan.

**Decision: not paying for GitHub Pro, and not making the repository public,
solely to obtain branch protection.** The supervised workflow is accepted for
now.

What that means in practice: CI still runs on every push and pull request and
still reports failures, but **nothing mechanically prevents a red commit landing
on `main`**. The compensating control is running a clean-tree verification
before pushing:

```bash
rm -rf .next && npm run verify
```

The clean tree matters. `PageProps` and `LayoutProps` are generated into
`.next/types`, so a stale directory can make typecheck pass locally and fail in
CI — which has already happened once.

The intended protection configuration, ready to apply if the plan ever changes:
require both CI jobs to pass, require a pull request with zero approvals so a
solo developer isn't blocked, and forbid force pushes and branch deletion, with
no admin bypass.

`.github/workflows/ci.yml` runs on push to `main` and on every pull request. It
has two jobs:

- **check** — format, lint, typecheck, unit tests, build
- **integration** — boots Supabase in the runner, then integration and
  end-to-end tests

---

## 2. Supabase — two projects

Create **two** projects at [supabase.com](https://supabase.com): `longplayr-staging`
and `longplayr-production`. Separate projects, not separate schemas — the point
is that a mistake on staging cannot reach real users.

For each, from Project Settings → API, collect:

| Value              | Used as                                       |
| ------------------ | --------------------------------------------- |
| Project URL        | `NEXT_PUBLIC_SUPABASE_URL`                    |
| `anon` public key  | `NEXT_PUBLIC_SUPABASE_ANON_KEY`               |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` — **server only** |

The service-role key bypasses Row Level Security completely. It must never be
prefixed `NEXT_PUBLIC_` and never imported into a Client Component.

### Push the schema

```bash
npx supabase login
npx supabase link --project-ref <staging-ref>
npx supabase db push          # applies supabase/migrations in order
```

Repeat for production. **Always push to staging first and check it**, which is
the entire reason two environments exist.

### Auth settings

In each project, Authentication → URL Configuration:

- Site URL: the deployed URL for that environment
- Redirect URLs: add the Vercel preview wildcard for staging

Decide deliberately whether to enable email confirmation. It is **off** locally
so tests can run unattended. Production should almost certainly have it on —
note that turning it on changes the sign-up flow, because there is no session
until the user confirms, and `/onboarding` will bounce them back to sign in.
That path needs a real "check your email" screen before launch.

---

## 3. Vercel

Import the GitHub repository at [vercel.com](https://vercel.com). Framework
detection should identify Next.js with no configuration.

Set environment variables per environment:

| Vercel environment | Points at                        |
| ------------------ | -------------------------------- |
| Production         | production Supabase              |
| Preview            | staging Supabase                 |
| Development        | unused — local uses `.env.local` |

Preview deployments then exercise real migrations against staging data before
anything reaches production.

---

## 4. MusicBrainz contact — required before any ingestion

MusicBrainz requires a `User-Agent` identifying the maintainers, and may block
clients that lack one. Being blocked would affect every longplayr user at once,
not just one machine, so the client **refuses to make live requests** while the
contact looks like a placeholder.

Set in Vercel, for both Preview and Production:

```
MUSICBRAINZ_CONTACT=https://github.com/darrylnatale/longplayr
```

Local development deliberately keeps the placeholder from `npm run db:env`, so
ingestion cannot run against the real API by accident. Anything that needs real
MusicBrainz data must run in a deployed environment, or with the variable set
explicitly and knowingly.

---

## 5. Google sign-in

Locked as a product decision but **not built** — Phase 0 ships email and
password only.

It needs a Google Cloud project with OAuth credentials, which is a signup no
amount of local development avoids. When you're ready: create OAuth client
credentials, add the Supabase callback URL as an authorised redirect, then
enable Google in Supabase Authentication → Providers and paste the client ID and
secret. The sign-in and sign-up pages need a provider button added.

---

## 6. Verification

Phase 0 is genuinely done when, **on the deployed staging URL**:

1. A new user signs up, chooses a handle, signs out, and signs back in
2. Their profile renders at `/<handle>`
3. That profile is visible when signed out
4. An unknown handle returns 404
5. CI passes on a pull request and blocks merge on failure

Points 1–4 already pass locally via `npm run test:e2e`. Point 5 is what
publishing the repository unlocks.

To run the end-to-end suite against a deployed environment rather than a local
server:

```bash
PLAYWRIGHT_BASE_URL=https://longplayr-staging.vercel.app npm run test:e2e
```

Be aware this creates real accounts in that environment's database.

---

## Not yet needed

Custom domain, Supabase Storage (Phase 1, when artwork lands), error tracking
and uptime monitoring (Phase 7). See `docs/development-plan.md`.
