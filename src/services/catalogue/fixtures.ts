import type { MbReleaseGroup } from './musicbrainz';

/**
 * MusicBrainz response fixtures.
 *
 * Hand-built to mirror the response shapes documented by MusicBrainz, covering
 * the cases that drove modelling decisions. They are **not** captured from live
 * responses, because live calls are blocked until a genuine contact value is
 * configured (docs/development-plan.md, Phase 1).
 *
 * That limit is the point of the real-data smoke test: these prove our logic is
 * self-consistent, not that our reading of MusicBrainz is correct.
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
      'track-count': 10,
      media: [
        {
          format: 'CD',
          position: 1,
          tracks: [
            { id: 't1', position: 1, title: '15 Step', length: 237000 },
            { id: 't2', position: 2, title: 'Bodysnatchers', length: 242000 },
          ],
        },
      ],
      'label-info': [{ label: { name: 'XL Recordings' } }],
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
      'track-count': 12,
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
      media: [
        {
          format: 'Vinyl',
          position: 1,
          tracks: [{ id: 'd1t1', position: 1, title: 'The Magnificent Seven', length: 328000 }],
        },
        {
          format: 'Vinyl',
          position: 2,
          tracks: [{ id: 'd2t1', position: 1, title: 'Lose This Skin', length: 315000 }],
        },
      ],
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
