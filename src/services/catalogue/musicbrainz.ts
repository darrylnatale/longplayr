import { RateLimiter, sleep } from './rate-limiter';

/**
 * MusicBrainz client.
 *
 * Every request goes through a shared rate limiter. Nothing in this module —
 * and nothing anywhere else — should call the MusicBrainz API directly.
 *
 * Verified constraints (docs/architecture.md §7):
 *  - 1 request/second per IP, averaged
 *  - exceeding it returns 503 for *all* requests from that IP
 *  - a User-Agent carrying contact details is mandatory
 */

const API_ROOT = 'https://musicbrainz.org/ws/2';

/** One below the documented limit, so clock skew and jitter cannot push us over. */
const REQUESTS_PER_SECOND = 0.9;

/**
 * Retry policy for transient 5xx responses.
 *
 * Two workloads with opposite tolerances share this client. A background walk
 * can afford to wait; someone pressing "Add" cannot. One global policy would
 * have to be wrong for one of them, so the policy is a parameter.
 */
export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  /** Ceiling on any single delay. A guard on future parameter changes. */
  maxDelayMs: number;
  jitter: boolean;
};

/**
 * The behaviour every caller had before policies existed, preserved exactly.
 *
 * Three attempts with delays of 2s and 4s. The exponential formula below
 * reproduces the previous `2000 * attempt` for both of them — linear and
 * exponential coincide over the only two delays a three-attempt policy takes —
 * so interactive paths are unchanged by arithmetic rather than by a branch.
 */
export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: Number.MAX_SAFE_INTEGER,
  jitter: false,
};

/**
 * For background walks, where a lost artist costs more than a slow one.
 *
 * Delays land in [1,2], [2,4], [4,8] and [8,16] seconds — roughly 30 seconds
 * in total, against the ~6-second window that was twice observed failing to
 * outlast MusicBrainz edge load shedding (docs/current-state.md §9).
 *
 * `maxDelayMs` does not bind at these values and is not meant to: it is a
 * ceiling protecting future parameter changes, not a target.
 */
export const BACKGROUND_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 30_000,
  jitter: true,
};

/**
 * Delay before the `sleepIndex`-th retry, 1-based.
 *
 * **Equal jitter**, not full jitter: the result never falls below half the
 * computed delay, so a retry cannot land back inside the one-second rate
 * window. Full jitter can return nearly zero, which is the one thing the
 * limiter exists to prevent.
 */
export function retryDelayMs(
  policy: RetryPolicy,
  sleepIndex: number,
  random: () => number = Math.random,
): number {
  const raw = Math.min(policy.baseDelayMs * 2 ** (sleepIndex - 1), policy.maxDelayMs);
  return policy.jitter ? raw / 2 + random() * (raw / 2) : raw;
}

const limiter = new RateLimiter(REQUESTS_PER_SECOND);

/**
 * Values that identify nobody. Local development uses a placeholder so the code
 * runs, but a placeholder must never reach MusicBrainz — an unidentifiable
 * client is exactly what their User-Agent policy exists to prevent, and being
 * blocked would affect every longplayr user, not just this machine.
 */
const PLACEHOLDER_MARKERS = ['placeholder', 'example.com', 'localhost', 'changeme', 'todo'];

export function isPlaceholderContact(contact: string | undefined): boolean {
  if (!contact || contact.trim() === '') return true;
  const value = contact.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

export function userAgent(contact = process.env.MUSICBRAINZ_CONTACT): string {
  const version = process.env.npm_package_version ?? '0.1.0';
  return `longplayr/${version} ( ${contact} )`;
}

/**
 * Refuses to make live requests with an unidentifiable User-Agent.
 *
 * This is a deliberate hard stop rather than a warning. Real ingestion stays
 * disabled until MUSICBRAINZ_CONTACT holds a genuine contact URL or email —
 * the repository URL, once it exists.
 */
function assertIdentifiable(): void {
  const contact = process.env.MUSICBRAINZ_CONTACT;
  if (isPlaceholderContact(contact)) {
    throw new MusicBrainzError(
      'Refusing to call MusicBrainz with a placeholder contact. ' +
        'MusicBrainz requires a User-Agent identifying the application maintainers, ' +
        'and may block clients without one. Set MUSICBRAINZ_CONTACT to a real ' +
        'contact URL or email before running ingestion.',
    );
  }
}

/**
 * Diagnostics attached to a non-OK response.
 *
 * Captured because the seed produced 21 unexplained 503s and the logs recorded
 * only the status, which cannot distinguish "you are going too fast" from
 * "MusicBrainz is busy". Those have opposite remedies: the first means slow
 * down, the second means our rate is irrelevant and only backoff helps.
 */
export type MusicBrainzResponseDiagnostics = {
  /** Response body, truncated. MusicBrainz sends a distinct message per cause. */
  body?: string;
  /** `global` when the edge limiter shed the request, absent on app responses. */
  rateLimitZone?: string;
  rateLimitLimit?: string;
  rateLimitRemaining?: string;
  retryAfter?: string;
  /** `openresty` is the edge proxy; `Plack::Handler::Starlet` is the app. */
  server?: string;
};

export class MusicBrainzError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly diagnostics?: MusicBrainzResponseDiagnostics,
  ) {
    super(message);
    this.name = 'MusicBrainzError';
  }
}

/**
 * True when a 503 is MusicBrainz shedding load rather than rate limiting us.
 *
 * Verified against the live API on 2026-08-16. The two 503s are distinguishable
 * and only one is our fault:
 *
 *   busy         {"error": "The MusicBrainz web server is currently busy..."}
 *                x-ratelimit-zone: global, retry-after: 0, server: openresty
 *                Rejected at the edge, with our own per-IP budget untouched.
 *
 *   rate limited {"error": "Your requests are exceeding the allowable rate
 *                limit..."} — the message their docs describe.
 *
 * Every 503 sampled during the investigation was the first kind, while the
 * client was averaging 0.104 req/s against a 1/s limit.
 */
export function isServerBusy(diagnostics: MusicBrainzResponseDiagnostics | undefined): boolean {
  if (!diagnostics) return false;
  if (diagnostics.rateLimitZone === 'global') return true;
  return /currently busy/i.test(diagnostics.body ?? '');
}

/** True when MusicBrainz says we are the problem. */
export function isRateLimited(diagnostics: MusicBrainzResponseDiagnostics | undefined): boolean {
  return /exceeding the allowable rate limit/i.test(diagnostics?.body ?? '');
}

/** Reads the diagnostics we care about off a non-OK response. */
async function captureDiagnostics(response: Response): Promise<MusicBrainzResponseDiagnostics> {
  let body: string | undefined;
  try {
    body = (await response.text()).slice(0, 500);
  } catch {
    // A body we cannot read is not worth failing the error path over.
  }

  const header = (name: string) => response.headers.get(name) ?? undefined;

  return {
    body,
    rateLimitZone: header('x-ratelimit-zone'),
    rateLimitLimit: header('x-ratelimit-limit'),
    rateLimitRemaining: header('x-ratelimit-remaining'),
    retryAfter: header('retry-after'),
    server: header('server'),
  };
}

/** One-line summary for logs and job `last_error`. */
export function describeFailure(
  status: number,
  path: string,
  diagnostics: MusicBrainzResponseDiagnostics,
): string {
  const cause = isRateLimited(diagnostics)
    ? 'rate limited'
    : isServerBusy(diagnostics)
      ? 'server busy (edge load shedding, not our rate)'
      : 'unclassified';

  const parts = [
    `zone=${diagnostics.rateLimitZone ?? '-'}`,
    `remaining=${diagnostics.rateLimitRemaining ?? '-'}/${diagnostics.rateLimitLimit ?? '-'}`,
    `retry-after=${diagnostics.retryAfter ?? '-'}`,
  ];

  return `MusicBrainz returned ${status} for ${path} — ${cause} [${parts.join(' ')}] ${
    diagnostics.body ?? ''
  }`.trim();
}

export class NotFoundError extends MusicBrainzError {
  constructor(mbid: string) {
    super(`MusicBrainz has no entity with MBID ${mbid}`, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Describes a failure that happened before any HTTP response existed.
 *
 * Deliberately not routed through `describeFailure`: that function reports a
 * status and rate-limit headers, and a transport failure has neither. Saying
 * "MusicBrainz returned 0" would be inventing information.
 */
export function describeTransportFailure(path: string, cause: unknown): string {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return `MusicBrainz request for ${path} failed in transport — no HTTP response was received [${detail}]`;
}

/**
 * `fetch()` threw: DNS, connection reset, socket timeout, TLS — the request
 * never reached a response.
 *
 * Extends `MusicBrainzError` so a caller catching that catches this too, but
 * carries **no status and no diagnostics**, because none exist. That also means
 * `isServerBusy()` and `isRateLimited()` both return false for it, which is
 * correct: a transport failure is neither.
 *
 * Observed in a curated tranche dry run as four artists failing with
 * `fetch failed`, each on its first and only attempt, because the retry loop
 * used to guard HTTP responses and not the call that produces them.
 */
export class MusicBrainzTransportError extends MusicBrainzError {
  readonly transportCause: unknown;

  constructor(path: string, cause: unknown) {
    super(describeTransportFailure(path, cause));
    this.name = 'MusicBrainzTransportError';
    this.transportCause = cause;
  }
}

async function request<T>(
  path: string,
  params: Record<string, string> = {},
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  assertIdentifiable();

  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set('fmt', 'json');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError: MusicBrainzError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    let response: Response;
    try {
      // The catch below is scoped to this call and nothing else. Widening it to
      // cover the response handling would turn a parsing bug or a programming
      // error into a silent network retry.
      response = await limiter.schedule(() =>
        fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } }),
      );
    } catch (cause) {
      // No response exists, so there is nothing to classify — but the failure is
      // transient in exactly the way a 5xx is, and it goes through the same
      // policy rather than a second retry system of its own.
      lastError = new MusicBrainzTransportError(path, cause);
      if (attempt < policy.maxAttempts) {
        await sleep(retryDelayMs(policy, attempt));
        continue;
      }
      throw lastError;
    }

    if (response.ok) return (await response.json()) as T;

    if (response.status === 404) {
      throw new NotFoundError(path);
    }

    // Read the body and rate-limit headers before deciding anything. A 503
    // carrying "currently busy" with x-ratelimit-zone: global is MusicBrainz
    // shedding load at the edge, which our request rate does not influence; a
    // 503 carrying "exceeding the allowable rate limit" is our fault. The seed
    // recorded neither, which is why 21 failures stayed unexplained for days.
    const diagnostics = await captureDiagnostics(response);
    const message = describeFailure(response.status, path, diagnostics);

    // 5xx is worth retrying whichever kind it is. Timing and attempt count come
    // from the caller's `RetryPolicy` rather than being fixed here.
    //
    // `DEFAULT_RETRY` preserves the interactive behaviour this path has always
    // had — three attempts at 2s and 4s — and is unchanged. `BACKGROUND_RETRY`
    // is the longer jittered policy, used only by background catalogue walks,
    // because curated tranche dry runs showed that a ~6-second window was not
    // wide enough to outlast MusicBrainz edge load shedding: artists were lost
    // to 503s that a later attempt then resolved.
    if (response.status >= 500) {
      lastError = new MusicBrainzError(message, response.status, diagnostics);
      if (attempt < policy.maxAttempts) {
        // Back off well beyond the 1s window before trying again.
        //
        // Deliberately outside `limiter.schedule`: a sleeping retry must not
        // hold the limiter queue against other callers, and the next attempt
        // re-enters the limiter so pacing is still enforced.
        await sleep(retryDelayMs(policy, attempt));
        continue;
      }
    }

    throw new MusicBrainzError(message, response.status, diagnostics);
  }

  throw lastError ?? new MusicBrainzError(`MusicBrainz request failed for ${path}`);
}

// ---------------------------------------------------------------------------
// Response shapes
//
// Only the fields we actually consume are typed. MusicBrainz returns a great
// deal more; describing all of it would be a maintenance burden for no gain.
// ---------------------------------------------------------------------------

export type MbArtist = {
  id: string;
  name: string;
  'sort-name': string;
  disambiguation?: string;
  type?: string | null;
};

export type MbArtistCredit = {
  name: string;
  joinphrase?: string;
  artist: MbArtist;
};

/**
 * A release as it appears *inside a release-group response*.
 *
 * Verified against the live API: this shape has **no `media` and no
 * `track-count`**. Tracklists require fetching the release separately. An
 * earlier version assumed otherwise and produced a catalogue where every album
 * had an empty tracklist.
 */
export type MbReleaseSummary = {
  id: string;
  title: string;
  status?: string | null;
  date?: string;
  country?: string | null;
  disambiguation?: string;
};

/** A medium — one disc, tape or side. `track-count` lives here, not on the release. */
export type MbMedium = {
  position?: number;
  format?: string | null;
  title?: string | null;
  'track-count'?: number;
  tracks?: MbTrack[];
};

/** A release fetched directly, with `inc=recordings`. Carries the tracklist. */
export type MbReleaseDetail = MbReleaseSummary & {
  media?: MbMedium[];
  'label-info'?: { label?: { name?: string } | null }[];
};

export type MbTrack = {
  id: string;
  position: number;
  /** Display number. Can be non-numeric on vinyl ("A1"), so `position` orders. */
  number?: string;
  title: string;
  length?: number | null;
};

export type MbReleaseGroup = {
  id: string;
  title: string;
  'primary-type'?: string | null;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  disambiguation?: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbReleaseSummary[];
};

export type MbSearchResult = {
  'release-groups': (MbReleaseGroup & { score?: number })[];
  count: number;
};

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** A release group with its artist credits and the releases beneath it. */
export function getReleaseGroup(mbid: string): Promise<MbReleaseGroup> {
  return request<MbReleaseGroup>(`/release-group/${mbid}`, {
    // `url-rels` costs no extra request and carries the external links —
    // Discogs, Wikidata, official sites — that a re-fetch would otherwise be
    // needed to recover. `genres` and `tags` are deliberately excluded: genre
    // data is deferred, tags are upstream user noise, and both inflate every
    // response on a path already slow enough to be a recorded complaint.
    inc: 'artist-credits+releases+url-rels',
  });
}

/** A single release with its tracklist and label. */
export function getRelease(mbid: string): Promise<MbReleaseDetail> {
  return request<MbReleaseDetail>(`/release/${mbid}`, {
    // `artist-rels` carries release-level credits, producer among them.
    // `url-rels` carries the release's own external links. Both ride the
    // request we already make for the tracklist.
    inc: 'recordings+labels+media+artist-rels+url-rels',
  });
}

/** One MusicBrainz alias, as the `inc=aliases` include returns it. */
export type MbAlias = {
  name: string;
  'sort-name'?: string | null;
  /**
   * `Artist name`, `Search hint`, `Legal name`, or **null**.
   *
   * **Null is common and is not an error** — one of Ye's twelve aliases is
   * untyped, and it is `Donda`, an album title. `architecture.md` §10.5
   * records that untyped aliases are dropped for exactly that reason.
   */
  type?: string | null;
  locale?: string | null;
  primary?: boolean | null;
};

/** An artist looked up directly, carrying its aliases. */
export type MbArtistWithAliases = {
  id: string;
  name: string;
  aliases?: MbAlias[] | null;
};

/**
 * One artist, with its aliases.
 *
 * **The only direct artist lookup in the codebase, and it exists because
 * nothing else carries aliases.** Artists otherwise arrive embedded in
 * `artist-credits` on a release-group or release response, and that include
 * returns id, name, sort-name and disambiguation — **no aliases**. That finding
 * is what re-scoped F-019 from a search change into a queue-and-ingest one:
 * every artist costs a request against a one-per-second budget.
 *
 * **Verified against the live API on 2026-10-02.** The artist MusicBrainz now
 * calls *Ye* returns twelve aliases across four type values, including the
 * curated misspelling `Kayne West`. `architecture.md` §10.5.
 */
export function getArtistWithAliases(mbid: string): Promise<MbArtistWithAliases> {
  return request<MbArtistWithAliases>(`/artist/${mbid}`, {
    // Nothing else. `inc=aliases` alone keeps the response small on a path
    // that will run once per artist in the catalogue.
    inc: 'aliases',
  });
}

/**
 * Free-text search over release groups.
 *
 * Scope filtering happens after the fact rather than in the query: MusicBrainz
 * query syntax makes excluding secondary types awkward, and filtering in our
 * own code keeps one definition of what is in scope.
 */
export function searchReleaseGroups(query: string, limit = 25): Promise<MbSearchResult> {
  return request<MbSearchResult>('/release-group', {
    query,
    limit: String(limit),
  });
}

/**
 * A page of an artist's release groups, from the browse endpoint.
 *
 * Every field is optional because none of them can be relied on: a browse
 * response for an artist with no release groups omits the array entirely, and
 * the count has been observed to disagree with the page it describes. The
 * pagination below treats all of it as advisory.
 */
export type MbBrowseReleaseGroups = {
  'release-group-count'?: number;
  'release-group-offset'?: number;
  'release-groups'?: MbReleaseGroup[];
};

/** Browse limit. MusicBrainz caps this at 100 and ignores larger values. */
export const BROWSE_PAGE_SIZE = 100;

/**
 * Hard ceiling on pages for one artist — 2,000 release groups.
 *
 * No artist in the catalogue approaches this. It exists so that contradictory
 * pagination metadata cannot turn into an unbounded loop against a
 * rate-limited API, the same reason `seed.ts` bounds its own run twice.
 */
export const MAX_BROWSE_PAGES = 20;

/**
 * One page of release groups credited to an artist.
 *
 * `inc=artist-credits` is what makes the response usable without a second
 * request: it carries the credit string an album row needs. Releases are
 * deliberately **not** requested — the browse endpoint does not return them,
 * which is the whole basis of progressive hydration
 * (`docs/architecture.md` §7).
 */
/** One artist as the search index returns it. */
export type MbArtistMatch = {
  id: string;
  name: string;
  score?: number;
  disambiguation?: string;
};

export type MbArtistSearchResult = {
  artists?: MbArtistMatch[];
};

/**
 * Searches the artist index by name.
 *
 * **Exists so the add-to-catalogue panel can tell an artist-shaped query from a
 * title-shaped one** - see `architecture.md` section 7.5. The release-group
 * index's default field is the *title*, so searching an artist's name there
 * returns records titled after them rather than records by them.
 *
 * **Verified against the live API on 2026-10-03.** `Radiohead` returns
 * `Radiohead` at score 100 and `On a Friday` - genuinely the pre-1991 group -
 * at 64, which is the gap the caller's confidence rule relies on.
 */
export function searchArtists(query: string, limit = 5): Promise<MbArtistSearchResult> {
  return request<MbArtistSearchResult>('/artist', {
    query,
    limit: String(limit),
  });
}

export function browseReleaseGroupsByArtist(
  artistMbid: string,
  offset = 0,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<MbBrowseReleaseGroups> {
  return request<MbBrowseReleaseGroups>(
    '/release-group',
    {
      artist: artistMbid,
      limit: String(BROWSE_PAGE_SIZE),
      offset: String(offset),
      inc: 'artist-credits',
    },
    policy,
  );
}

/**
 * Every release group credited to an artist, paginated safely.
 *
 * Three independent stops, because the metadata driving the loop comes from
 * upstream and any one of them can be wrong:
 *
 *   1. the page ceiling above
 *   2. an empty page ends the walk regardless of what the count claimed
 *   3. the offset must strictly advance
 *
 * An artist with no release groups returns an empty array. That is a fact about
 * the artist, not a failure — `K` is in the curated set and has none in scope.
 */
export async function browseAllReleaseGroupsByArtist(
  artistMbid: string,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<{ groups: MbReleaseGroup[]; requests: number; truncated: boolean }> {
  const groups: MbReleaseGroup[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let requests = 0;

  for (let page = 0; page < MAX_BROWSE_PAGES; page++) {
    const body = await browseReleaseGroupsByArtist(artistMbid, offset, policy);
    requests += 1;

    const batch = body['release-groups'] ?? [];
    // An empty page ends the walk whatever the count said. A count larger than
    // the data behind it would otherwise spin until the page ceiling.
    if (batch.length === 0) return { groups, requests, truncated: false };

    for (const rg of batch) {
      // Browse has been observed to repeat a release group across page
      // boundaries. A duplicate must not be counted twice.
      if (rg?.id && !seen.has(rg.id)) {
        seen.add(rg.id);
        groups.push(rg);
      }
    }

    // A page shorter than the limit is the last page. This is the stop that
    // does not depend on the count being present or correct, and without it a
    // response carrying no count walks to the page ceiling.
    if (batch.length < BROWSE_PAGE_SIZE) return { groups, requests, truncated: false };

    const next = offset + batch.length;
    // Defensive rather than theoretical: a non-advancing offset is the one
    // failure that turns a bounded walk into an infinite one.
    if (next <= offset) return { groups, requests, truncated: true };
    offset = next;

    const total = body['release-group-count'];
    if (typeof total === 'number' && Number.isFinite(total) && offset >= total) {
      return { groups, requests, truncated: false };
    }
  }

  // Reached the ceiling with pages still arriving. Reported rather than thrown:
  // the caller gets what was found and is told it is incomplete.
  return { groups, requests, truncated: true };
}
