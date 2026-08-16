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

const MAX_ATTEMPTS = 3;

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

async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  assertIdentifiable();

  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set('fmt', 'json');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let lastError: MusicBrainzError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await limiter.schedule(() =>
      fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } }),
    );

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

    // 5xx is worth retrying whichever kind it is. Timing and attempt count are
    // deliberately unchanged here — see docs/current-state.md §5 before tuning
    // them, because the evidence says the current policy is not the problem.
    if (response.status >= 500) {
      lastError = new MusicBrainzError(message, response.status, diagnostics);
      if (attempt < MAX_ATTEMPTS) {
        // Back off well beyond the 1s window before trying again.
        await sleep(2000 * attempt);
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
    inc: 'artist-credits+releases',
  });
}

/** A single release with its tracklist and label. */
export function getRelease(mbid: string): Promise<MbReleaseDetail> {
  return request<MbReleaseDetail>(`/release/${mbid}`, {
    inc: 'recordings+labels+media',
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
