import type { Database } from '@/lib/supabase/database.types';

import type { MbRelease, MbReleaseGroup, MbTrack } from './musicbrainz';
import { selectRepresentativeRelease } from './representative-release';
import { classify, parsePartialDate } from './scope';

/**
 * Maps MusicBrainz responses onto our row shapes.
 *
 * Kept separate from the code that writes to the database so it can be tested
 * exhaustively against fixtures without a database, and so the shape of the
 * upstream API is confined to one file.
 */

type AlbumInsert = Database['public']['Tables']['albums']['Insert'];
type ArtistInsert = Database['public']['Tables']['artists']['Insert'];
type ReleaseInsert = Database['public']['Tables']['releases']['Insert'];

export type MappedArtist = Omit<ArtistInsert, 'id'> & { mbid: string };

export type MappedAlbum = {
  album: Omit<AlbumInsert, 'id' | 'representative_release_id'> & { mbid: string };
  artists: { artist: MappedArtist; position: number }[];
  releases: MappedRelease[];
  representativeReleaseMbid: string | null;
};

export type MappedRelease = {
  release: Omit<ReleaseInsert, 'id' | 'album_id'> & { mbid: string };
  tracks: { position: number; medium_position: number; title: string; length_ms: number | null }[];
};

export class OutOfScopeError extends Error {
  constructor(readonly reason: string) {
    super(`Release group is out of scope: ${reason}`);
    this.name = 'OutOfScopeError';
  }
}

export function mapArtist(artist: {
  id: string;
  name: string;
  'sort-name': string;
  disambiguation?: string;
  type?: string | null;
}): MappedArtist {
  return {
    mbid: artist.id,
    name: artist.name,
    sort_name: artist['sort-name'],
    disambiguation: artist.disambiguation?.trim() || null,
    type: artist.type ?? null,
  };
}

/**
 * Renders the credit string the way MusicBrainz does, by concatenating each
 * credited name with its join phrase.
 *
 * We cache the result rather than recomputing it at render time, so this runs
 * once per ingest and never again.
 */
export function renderCredit(credits: MbReleaseGroup['artist-credit']): string {
  if (!credits || credits.length === 0) return 'Unknown Artist';
  return credits
    .map((credit) => `${credit.name}${credit.joinphrase ?? ''}`)
    .join('')
    .trim();
}

export function mapRelease(release: MbRelease): MappedRelease {
  const date = parsePartialDate(release.date);

  const media = release.media ?? [];
  const tracks = media.flatMap((medium, mediumIndex) =>
    (medium.tracks ?? []).map((track: MbTrack) => ({
      position: track.position,
      medium_position: medium.position ?? mediumIndex + 1,
      title: track.title,
      length_ms: track.length ?? null,
    })),
  );

  // track-count is the release-wide total; fall back to what we actually got.
  const trackCount = release['track-count'] ?? (tracks.length || null);

  return {
    release: {
      mbid: release.id,
      title: release.title,
      status: release.status ?? null,
      release_date: date?.date ?? null,
      release_date_precision: date?.precision ?? null,
      country: release.country ?? null,
      format: media[0]?.format ?? null,
      label: release['label-info']?.[0]?.label?.name ?? null,
      track_count: trackCount,
      disambiguation: release.disambiguation?.trim() || null,
    },
    tracks,
  };
}

/**
 * Maps a release group, rejecting anything outside catalogue scope.
 *
 * Scope is enforced here rather than at query time so an out-of-scope release
 * group never becomes a row in the first place.
 */
export function mapReleaseGroup(group: MbReleaseGroup): MappedAlbum {
  const scope = classify(group);
  if (!scope.inScope) throw new OutOfScopeError(scope.reason);

  const firstRelease = parsePartialDate(group['first-release-date']);

  const artists = (group['artist-credit'] ?? []).map((credit, index) => ({
    artist: mapArtist(credit.artist),
    position: index,
  }));

  const releases = (group.releases ?? []).map(mapRelease);

  const representative = selectRepresentativeRelease(
    releases.map((r) => ({
      mbid: r.release.mbid,
      status: r.release.status,
      date: r.release.release_date,
      country: r.release.country,
      trackCount: r.release.track_count,
    })),
  );

  return {
    album: {
      mbid: group.id,
      title: group.title,
      display_credit: renderCredit(group['artist-credit']),
      primary_type: scope.primaryType,
      secondary_types: scope.secondaryTypes,
      first_release_date: firstRelease?.date ?? null,
      first_release_date_precision: firstRelease?.precision ?? null,
    },
    artists,
    releases,
    representativeReleaseMbid: representative?.mbid ?? null,
  };
}
