# Service layer

Everything that touches the database lives here. No SQL and no Supabase client
calls in React components — see `docs/architecture.md` §4.

This is enforced by an ESLint rule (`no-restricted-imports` in
`eslint.config.mjs`), so a component importing `@/lib/supabase/*` fails lint.

## Why it exists

It is the cheapest insurance in the architecture. Several changes we expect to
make later are contained to one module because of it:

- Swapping Postgres full-text search for a dedicated engine → `search/`
- Replacing the external popularity signal with our own activity → `discovery/`
- Extracting a standalone API for native apps → a transport change, not a rewrite

## Modules

| Module        | Owns                                                      |
| ------------- | --------------------------------------------------------- |
| `profiles/`   | User profiles, handles, onboarding                        |
| `catalogue/`  | Albums, artists, releases, ingestion (Phase 1)            |
| `collection/` | Collection entries, relistens, ratings, reviews (Phase 2) |
| `social/`     | Follows, blocks, feed, likes, notifications (Phase 3)     |
| `lists/`      | Lists and list items (Phase 4)                            |
| `discovery/`  | Popularity and charts (Phase 5)                           |
| `search/`     | Album, artist and user search (Phase 1)                   |
| `moderation/` | Reports, admin actions (Phase 6)                          |

Only `profiles/` exists so far. The rest arrive with their phases — empty
directories would be noise.

## Conventions

- **Validate at the boundary.** Every function taking user input validates with
  Zod before touching the database.
- **Return results, not exceptions, for expected failures.** A handle already
  being taken is an outcome the UI renders, not an error. Unexpected failures
  still throw.
- **Authorisation is checked here**, in application code. RLS is defence in
  depth, not the mechanism we rely on.
