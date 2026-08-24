import type { MbReleaseDetail, MbReleaseGroup } from './musicbrainz';

/**
 * MusicBrainz response fixtures.
 *
 * **Corrected against the live API.** An earlier version assumed release-group
 * responses embedded `media[].tracks[]`; they do not. That wrong assumption
 * produced a real catalogue in which every album had an empty tracklist, and it
 * survived a full fixture suite because the fixtures encoded the same mistake.
 *
 * The shapes here now match what the API actually returns:
 *
 *  - Release groups (`inc=artist-credits+releases`) carry release **metadata
 *    only** — no `media`, no `track-count`, no `label-info`.
 *  - Tracklists require fetching the release itself (`inc=recordings`), where
 *    tracks live under `media[].tracks[]` and `track-count` is per medium.
 *
 * Fixtures still cannot prove our reading of the API is right — only real
 * requests do that. That is what the smoke-test gate exists for.
 */

/** Baseline: one artist, one official release, full date, tracklist. */
export const singleArtistAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000001',
  title: 'In Rainbows',
  'primary-type': 'Album',
  'secondary-types': [],
  'first-release-date': '2007-10-10',
  'artist-credit': [
    {
      name: 'Radiohead',
      artist: {
        id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        name: 'Radiohead',
        'sort-name': 'Radiohead',
        type: 'Group',
      },
    },
  ],
  releases: [
    {
      id: '0b0e4f1e-2222-4000-8000-000000000001',
      title: 'In Rainbows',
      status: 'Official',
      date: '2007-12-28',
      country: 'GB',
    },
  ],
};

/** Two credited artists joined by a phrase — must appear on both artist pages. */
export const collaborationAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000002',
  title: 'Watch the Throne',
  'primary-type': 'Album',
  'first-release-date': '2011-08-08',
  'artist-credit': [
    {
      name: 'Jay-Z',
      joinphrase: ' & ',
      artist: {
        id: 'f82bcf78-5b69-4622-a5ef-73800768d9ac',
        name: 'JAY-Z',
        'sort-name': 'JAY-Z',
        type: 'Person',
      },
    },
    {
      name: 'Kanye West',
      artist: {
        id: '164f0d73-1234-4e2c-8743-d77bf2191051',
        name: 'Kanye West',
        'sort-name': 'West, Kanye',
        type: 'Person',
      },
    },
  ],
  releases: [
    {
      id: '0b0e4f1e-2222-4000-8000-000000000002',
      title: 'Watch the Throne',
      status: 'Official',
      date: '2011-08-08',
      country: 'US',
    },
  ],
};

/** Various Artists compilation: a real MusicBrainz artist, plus a secondary type. */
export const variousArtistsCompilation: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000003',
  title: 'Now That’s What I Call Music! 100',
  'primary-type': 'Album',
  'secondary-types': ['Compilation'],
  'first-release-date': '2018',
  'artist-credit': [
    {
      name: 'Various Artists',
      artist: {
        id: '89ad4ac3-39f7-470e-963a-56509c546377',
        name: 'Various Artists',
        'sort-name': 'Various Artists',
        type: 'Other',
      },
    },
  ],
  releases: [],
};

/** Mixtape arriving with no primary type at all — a real MusicBrainz shape. */
export const mixtapeWithoutPrimaryType: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000004',
  title: 'Acid Rap',
  'secondary-types': ['Mixtape/Street'],
  'first-release-date': '2013-04-30',
  'artist-credit': [
    {
      name: 'Chance the Rapper',
      artist: {
        id: '6d7b7cd4-254b-4c25-83f6-dd20f98ceacd',
        name: 'Chance the Rapper',
        'sort-name': 'Chance the Rapper',
        type: 'Person',
      },
    },
  ],
  releases: [],
};

/** Out of scope. Success means nothing is written. */
export const singleRelease: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000005',
  title: 'Creep',
  'primary-type': 'Single',
  'first-release-date': '1992-09-21',
  'artist-credit': [
    {
      name: 'Radiohead',
      artist: {
        id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        name: 'Radiohead',
        'sort-name': 'Radiohead',
      },
    },
  ],
};

/** Year-only date: precision must survive so display never invents a day. */
export const yearOnlyAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000006',
  title: 'Unknown Pleasures',
  'primary-type': 'Album',
  'first-release-date': '1979',
  'artist-credit': [
    {
      name: 'Joy Division',
      artist: {
        id: '9a58fda3-f4ed-4080-a3a5-f457aac9fcdd',
        name: 'Joy Division',
        'sort-name': 'Joy Division',
      },
    },
  ],
  releases: [
    {
      id: '00000000-0000-4000-8000-00000000b001',
      title: 'Unknown Pleasures',
      status: 'Official',
      date: '1979',
    },
  ],
};

/**
 * Many releases, none Official, with a tie on date — exercises every step of
 * the representative-release fallback chain.
 */
export const messyReleaseGroup: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000007',
  title: 'Bootlegged Sessions',
  'primary-type': 'Album',
  'first-release-date': '1998',
  'artist-credit': [
    {
      name: 'Some Artist',
      artist: {
        id: '00000000-0000-4000-8000-00000000a001',
        name: 'Some Artist',
        'sort-name': 'Some Artist',
      },
    },
  ],
  releases: [
    {
      id: '00000000-0000-4000-8000-0000000000ff',
      title: 'Bootlegged Sessions',
      status: 'Bootleg',
      date: '1998-01-01',
    },
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      title: 'Bootlegged Sessions',
      status: 'Bootleg',
      date: '1998-01-01',
    },
    {
      id: '00000000-0000-4000-8000-00000000c001',
      title: 'Bootlegged Sessions',
      status: 'Promotion',
    },
  ],
};

/** Multi-disc release: medium positions must not collide with track positions. */
export const multiDiscAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-000000000008',
  title: 'Sandinista!',
  'primary-type': 'Album',
  'first-release-date': '1980-12-12',
  'artist-credit': [
    {
      name: 'The Clash',
      artist: {
        id: '8f92558c-2baa-4758-8c38-615519e9deda',
        name: 'The Clash',
        'sort-name': 'Clash, The',
      },
    },
  ],
  releases: [
    {
      id: '00000000-0000-4000-8000-00000000d001',
      title: 'Sandinista!',
      status: 'Official',
      date: '1980-12-12',
    },
  ],
};

/**
 * A **browse**-shaped release group, as `/release-group?artist=…` returns it.
 *
 * The distinguishing feature is the absence of `releases` — not an empty array,
 * the key itself is missing. That is what progressive hydration relies on and
 * why hydration state is recorded explicitly rather than inferred: a full fetch
 * of a release group holding no releases produces an album that looks exactly
 * like one created from this.
 */
export const browseReleaseGroup: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-00000000b001',
  title: 'Here Comes Everybody',
  'primary-type': 'Album',
  'secondary-types': [],
  'first-release-date': '1985-09-01',
  'artist-credit': [
    {
      name: 'The Wake',
      artist: {
        id: 'c2314623-e863-4fde-af8c-d6e00fec5f2c',
        name: 'The Wake',
        'sort-name': 'Wake, The',
        type: 'Group',
      },
    },
  ],
};

/** A browse record whose release group is outside the current depth boundary. */
export const browseLiveAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-00000000b002',
  title: 'Live Somewhere',
  'primary-type': 'Album',
  'secondary-types': ['Live'],
  'first-release-date': '1990',
  'artist-credit': [
    {
      name: 'The Wake',
      artist: {
        id: 'c2314623-e863-4fde-af8c-d6e00fec5f2c',
        name: 'The Wake',
        'sort-name': 'Wake, The',
        type: 'Group',
      },
    },
  ],
};

export const allFixtures = {
  singleArtistAlbum,
  collaborationAlbum,
  variousArtistsCompilation,
  mixtapeWithoutPrimaryType,
  singleRelease,
  yearOnlyAlbum,
  messyReleaseGroup,
  multiDiscAlbum,
};

// ---------------------------------------------------------------------------
// Release detail responses (`inc=recordings+labels+media`)
//
// The only shape that carries a tracklist. Modelled on a verified live
// response: tracks sit under `media[].tracks[]`, `track-count` is a property of
// each medium rather than of the release, and `number` is a display string that
// can be non-numeric on vinyl.
// ---------------------------------------------------------------------------

/** Single disc, matching the representative release of `singleArtistAlbum`. */
export const singleDiscReleaseDetail: MbReleaseDetail = {
  id: '0b0e4f1e-2222-4000-8000-000000000001',
  title: 'In Rainbows',
  status: 'Official',
  date: '2007-12-28',
  country: 'GB',
  'label-info': [{ label: { name: 'XL Recordings' } }],
  media: [
    {
      position: 1,
      format: 'CD',
      'track-count': 2,
      tracks: [
        { id: 't1', position: 1, number: '1', title: '15 Step', length: 237000 },
        { id: 't2', position: 2, number: '2', title: 'Bodysnatchers', length: 242000 },
      ],
    },
  ],
};

/** Two discs. Track positions repeat, so the medium keeps them distinct. */
export const multiDiscReleaseDetail: MbReleaseDetail = {
  id: '00000000-0000-4000-8000-00000000d001',
  title: 'Sandinista!',
  status: 'Official',
  date: '1980-12-12',
  media: [
    {
      position: 1,
      format: 'Vinyl',
      'track-count': 1,
      tracks: [
        { id: 'd1t1', position: 1, number: 'A1', title: 'The Magnificent Seven', length: 328000 },
      ],
    },
    {
      position: 2,
      format: 'Vinyl',
      'track-count': 1,
      tracks: [{ id: 'd2t1', position: 1, number: 'C1', title: 'Lose This Skin', length: 315000 }],
    },
  ],
};

/** A release MusicBrainz holds with no tracklist at all — a real occurrence. */
export const emptyReleaseDetail: MbReleaseDetail = {
  id: '00000000-0000-4000-8000-00000000b001',
  title: 'Unknown Pleasures',
  status: 'Official',
  date: '1979',
  media: [],
};
