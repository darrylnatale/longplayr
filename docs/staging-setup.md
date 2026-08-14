# Staging setup — Phase 1 seed target

Everything here needs accounts, so it needs you. Each step is written to be
copy-pasteable; the code side is already done and verified.

**Goal:** a staging environment that is the seed target, provably separate from
local development and from the database the integration suite destroys.

---

## 0. What is already verified

| Item                                           | Status                                    |
| ---------------------------------------------- | ----------------------------------------- |
| All six migrations apply from a clean database | ✅ verified locally                       |
| ListenBrainz needs no credentials              | ✅ public, HTTP 200 with no headers       |
| Cover Art Archive needs no credentials         | ✅ public, 200 for art, 404 when absent   |
| Contact guard blocks placeholder values        | ✅ 6 tests, no request leaves the machine |
| Cron auth fails closed in production           | ✅ 8 tests                                |
| Seed selection (all-time, 500, cap 2)          | ✅ 13 tests, dry run approved             |

**Steps 3 and 4 of the setup list need no work**: the MusicBrainz contact is a
single environment variable, and neither ListenBrainz nor Cover Art Archive has
any configuration at all.

---

## 1. Create the staging Supabase project

One project, named so it cannot be confused with anything else:

**`longplayr-staging`**

From Project Settings → API, collect:

| Value              | Variable                                      |
| ------------------ | --------------------------------------------- |
| Project URL        | `NEXT_PUBLIC_SUPABASE_URL`                    |
| `anon` public key  | `NEXT_PUBLIC_SUPABASE_ANON_KEY`               |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` — **server only** |

The service-role key bypasses Row Level Security entirely. Never prefix it
`NEXT_PUBLIC_`, never import it into a Client Component.

### Push the schema

```bash
npx supabase login                      # interactive; only you can do this
npx supabase link --project-ref <staging-ref>
npx supabase db push
```

Expect all six migrations to apply. Then confirm the artwork bucket exists —
it is created by migration, not by hand:

```bash
npx supabase db execute --linked \
  "select id, public, file_size_limit from storage.buckets where id = 'artwork';"
```

### Auth settings

Authentication → URL Configuration: set the Site URL to the Vercel staging URL
and add the preview wildcard to redirect URLs.

Leave email confirmation **off** on staging so the end-to-end suite runs
unattended. Production is a separate decision — turning it on changes the
sign-up flow, since there is no session until the user confirms.

---

## 2. Vercel

Import <https://github.com/darrylnatale/longplayr>. Framework detection handles
Next.js with no configuration.

### Environment variables

Set these for **Preview** (staging). Leave Production unset until a production
Supabase project exists — an unset variable fails loudly, a wrong one fails
quietly.

| Variable                        | Value                                       |
| ------------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | staging project URL                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | staging service-role key                    |
| `MUSICBRAINZ_CONTACT`           | `https://github.com/darrylnatale/longplayr` |
| `CRON_SECRET`                   | a long random string — see below            |

```bash
openssl rand -base64 32     # generate CRON_SECRET
```

`MUSICBRAINZ_CONTACT` **must not** contain `placeholder`, `example.com`,
`localhost`, `changeme` or `todo`. The client refuses to make live requests if
it does, and reports why.

### Cron

`vercel.json` schedules the queue drain daily at 04:00 UTC.

> **Plan constraint.** Vercel's Hobby plan caps cron at **once per day**, and
> only guarantees timing within the hour. A more frequent schedule fails at
> deploy time.
>
> Consequence: artwork queued as a follow-up can take up to 24 hours to appear.
> Album pages render with the placeholder meanwhile, so nothing breaks — but it
> is slow. The seed fetches artwork inline and does not depend on cron.
>
> If that lag matters later, the options are Vercel Pro, or triggering the
> endpoint on a schedule from somewhere else. Both are decisions, not
> assumptions — nothing has been changed to work around this.

---

## 3. Confirm staging is isolated

**Do this before seeding.** The integration suite truncates `albums` and
`artists`; the whole point of a separate project is that it cannot reach the
seeded catalogue.

```bash
# 1. Local env must point at localhost, never at staging.
grep NEXT_PUBLIC_SUPABASE_URL .env.local .env.test.local
#    expect 127.0.0.1:54321 in both

# 2. Integration tests refuse to run against a non-local database by design.
#    tests/setup/integration.ts throws unless the URL is localhost.
```

That guard is the real protection: even with staging credentials present
locally, `npm run test:integration` aborts rather than deleting a remote
catalogue.

**Three distinct databases, and what may touch each:**

| Database                  | Written by             | Destroyed by                 |
| ------------------------- | ---------------------- | ---------------------------- |
| Local (`127.0.0.1:54321`) | development, fixtures  | integration suite, every run |
| Staging                   | deployed app, the seed | nothing automatic            |
| Production                | not created yet        | —                            |

---

## 4. Verify the deployment from a clean state

Before seeding anything:

1. Open the staging URL. The browse page should report **0 albums, 0 artists**.
2. Sign up, choose a handle, sign out, sign back in. The profile renders at
   `/<handle>`.
3. Sign out and load that profile again — it must still render, since
   everything is public.
4. Request an unknown handle and confirm a 404.
5. Check the cron endpoint rejects an unauthenticated call:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<staging>/api/cron/drain-jobs
#    expect 401

curl -s -H "Authorization: Bearer $CRON_SECRET" https://<staging>/api/cron/drain-jobs
#    expect {"claimed":0,...}
```

A `401` on the first and a body on the second confirms the guard is configured
rather than merely present in code.

Optionally run the end-to-end suite against staging. **It creates real accounts
in that database:**

```bash
PLAYWRIGHT_BASE_URL=https://<staging> npm run test:e2e
```

---

## 5. Run the seed

Only after step 3 and step 4 pass, and only against staging.

```bash
NEXT_PUBLIC_SUPABASE_URL=<staging-url> \
SUPABASE_SERVICE_ROLE_KEY=<staging-service-key> \
MUSICBRAINZ_CONTACT=https://github.com/darrylnatale/longplayr \
npm run db:seed:catalogue
```

Defaults are the approved strategy — all-time, 500 candidates, 2 per artist —
so no flags are needed. Expect roughly **358 albums**, **716 MusicBrainz
requests**, and **~12 minutes**, rate-limited throughout.

Confirm the target first:

```bash
npm run db:seed:dryrun    # same env; reports selection, writes nothing
```

---

## 6. Still mandatory

The **real-data smoke test** remains a gate on Phase 1. The seed exercises much
of it, but the required cases — collaboration, Various Artists, EP, mixtape,
compilation, live album, year-only date, multi-disc tracklist, and albums both
with and without artwork — must be confirmed present in the seeded catalogue,
or ingested deliberately if the seed misses any.
