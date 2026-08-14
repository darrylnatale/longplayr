# Deployment

Everything below needs accounts, so it needs you rather than an agent. Local
development works without any of it — see `README.md`.

Phase 0 is complete locally. These steps finish it by adding staging,
production and CI enforcement.

---

## 1. GitHub

The repository exists locally with no remote. CI cannot run until it has one.

```bash
gh repo create longplayr --private --source=. --remote=origin --push
# or create it in the UI, then:
#   git remote add origin git@github.com:<you>/longplayr.git && git push -u origin main
```

`.github/workflows/ci.yml` runs on push to `main` and on every pull request. It
has two jobs:

- **check** — format, lint, typecheck, unit tests, build
- **integration** — boots Supabase in the runner, then integration and
  end-to-end tests

Once green, protect `main` in Settings → Branches so both jobs must pass before
merge. Without that rule CI reports failures but doesn't prevent anything.

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

## 4. Google sign-in

Locked as a product decision but **not built** — Phase 0 ships email and
password only.

It needs a Google Cloud project with OAuth credentials, which is a signup no
amount of local development avoids. When you're ready: create OAuth client
credentials, add the Supabase callback URL as an authorised redirect, then
enable Google in Supabase Authentication → Providers and paste the client ID and
secret. The sign-in and sign-up pages need a provider button added.

---

## 5. Verification

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
