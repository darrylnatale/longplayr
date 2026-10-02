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

## 2. Supabase — one project, and it is production **[CORRECTED 2026-09-24]**

> ### ⚠️ This section described an environment that does not exist
>
> It previously read: _"Create **two** projects… `longplayr-staging` and `longplayr-production`. Separate projects, not separate schemas — the point is that **a mistake on staging cannot reach real users**."_
>
> **There is one project. It is named `longplayr-staging`, and it is production.** It holds the real data and serves `longplayr.vercel.app`. **The safety property that sentence claimed has never held**, because there is no second environment for a mistake to be caught in.
>
> **The name is a leftover and is the trap.** A reader — including a future session — would reasonably believe migrations land somewhere harmless first. They do not: `npx supabase db push --linked` writes to the live database directly.
>
> **What does the work a staging environment would.** Every migration is gated at **STEP J**: CI green on the exact commit, then the migration applied, then the merge. That ordering is in `CLAUDE.md` and is why a second environment has not been missed in practice.
>
> **Deliberately not fixed by creating the second project.** That is a second database to migrate, seed and keep in step, for a pre-launch product with five accounts — an ongoing cost against a safety net that would go unexercised. **Revisit when there are real users**, at which point the CI gate stops being sufficient on its own.

Values to collect from Project Settings → API:

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
npx supabase link --project-ref <project-ref>
npx supabase db push --linked   # applies supabase/migrations in order
```

**This writes to the live database.** There is nowhere to try it first, which is
why `CLAUDE.md`'s STEP J ordering is the control: **CI green on the exact commit,
then apply the migration and confirm it, then merge.** Applying before CI has
parsed the tree removes the only check there is.

**`npm run db:pending` confirms afterwards**, and `--dry-run` shows what would be
applied without applying it.

### Auth settings

Authentication → URL Configuration, **set 2026-09-24**:

- **Site URL:** `https://longplayr.vercel.app` — no trailing slash. Confirmation
  and password-reset links are built from it, so a stale value here produces mail
  whose links go nowhere, for people who cannot sign in until they follow them.
- **Redirect URLs:** `https://longplayr.vercel.app/**`

**This changes when `longplayr.com` is bought and pointed at Vercel.** Keep the
Vercel URL in the redirect list across the switchover.

### Email: Resend on a verified subdomain **[DONE 2026-09-24]**

**Transactional mail goes through Resend**, sending from `noreply@longplayr.dev-guides.com`. The domain was added through Resend's Cloudflare integration, which writes the DKIM, SPF and MX records through the API rather than by hand — confirmed live on both Cloudflare's and Google's resolvers before use.

**A subdomain rather than the root, deliberately.** It isolates sending reputation from `dev-guides.com`'s other uses, so a bounce problem here cannot affect them.

**`longplayr.dev-guides.com` is a placeholder and is expected to change.** `longplayr.com` is unpurchased; the product already renders `longplayr.com/` as the handle prefix, so the real domain is a launch prerequisite. **Switching is a dashboard change** — verify the new domain in Resend, change the sender address in Supabase. No code, no migration, and no sending reputation is lost because there is none to carry.

| Setting  | Value                                              |
| -------- | -------------------------------------------------- |
| Host     | `smtp.resend.com`, port `465`                      |
| Username | `resend` (literal), password is the Resend API key |
| Sender   | `noreply@longplayr.dev-guides.com`                 |
| Region   | `eu-west-1` (Ireland)                              |

**Email confirmation is ON in production, and OFF locally and in CI.** That split is deliberate and must stay: `supabase/config.toml` is version-controlled, so enabling it there would change the local stack **and CI together**, and roughly sixteen end-to-end specs sign up expecting an immediate session. **Production is configured in the dashboard only.** See `architecture.md` §6.

**The auth email rate limit is raised to 60 per hour.** The built-in sender's cap is **2 per hour project-wide** — with confirmation on, the third person to sign up in any hour would have received nothing, and no resend could help because the bucket is empty for everyone. Custom SMTP is what makes that limit configurable, which is why it was a prerequisite for enabling confirmation rather than an improvement to it.

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

### Secrets set only on Vercel

Two variables exist only in the hosting environment. **Both fail closed in
production and open in development**, so local work needs neither.

| Variable            | For                                                                               |
| ------------------- | --------------------------------------------------------------------------------- |
| `CRON_SECRET`       | The scheduled drain at `/api/cron/drain-jobs`. Vercel signs cron requests with it |
| `QUEUE_VIEW_SECRET` | The temporary operator queue view at `/debug/queue` — `architecture.md` §17a      |

**`QUEUE_VIEW_SECRET` is passed in the URL**, as `/debug/queue?key=…`. Generate one
with `openssl rand -base64 32`, or `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
for a value with no characters that need escaping.

**A variable change needs a new deployment to take effect** — an existing
deployment will not pick it up. Setting it before the push that ships the page it
gates is the tidiest order.

**Its weakness, recorded rather than assumed away.** A secret in a URL reaches
browser history, referrer headers and any intermediate proxy log — so bookmarking
that page, which is the convenient thing to do, is also what spreads the secret.
**That is accepted because the page performs no mutation of any kind. It would not
be acceptable for anything that writes**, and `architecture.md` §17a records that
the access model must change before anything on that page does.

**`.env.example` is not in the repository.** `.gitignore`'s `.env*` rule catches
it, so it exists only on machines where it was created by hand — which is why this
table is here rather than there. **A fresh clone has no environment documentation
except this file.**

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

**A deliberately-set value now survives `db:env`. [2026-10-02]** The contact used
to be hard-coded in `scripts/write-local-env.mjs`, so setting it locally lasted
exactly until the next `npm run db:start` — the placeholder protected against
accident _and_ against intent. `db:env` now carries forward a real value found in
`.env.local` or exported in the environment, and **a fresh clone still gets the
placeholder**, which is the part worth keeping. It prints which one it chose.

**Set locally on 2026-10-02 at the maintainer's instruction**, so live MusicBrainz
requests are now possible from the development machine. The one-per-second
per-IP ceiling applies, and exceeding it returns `503` for _every_ request from
that address — `architecture.md` §7.3 and the drain lease are what keep
concurrent drainers from doing so.

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
