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

export class MusicBrainzError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MusicBrainzError';
  }
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

    // 503 means we are being rate limited; 5xx generally is worth retrying.
    if (response.status === 503 || response.status >= 500) {
      lastError = new MusicBrainzError(
        `MusicBrainz returned ${response.status} for ${path}`,
        response.status,
      );
      if (attempt < MAX_ATTEMPTS) {
        // Back off well beyond the 1s window before trying again.
        await sleep(2000 * attempt);
        continue;
      }
    }

    throw new MusicBrainzError(
      `MusicBrainz returned ${response.status} for ${path}`,
      response.status,
    );
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
