/**
 * The curated catalogue starting set — first tranche.
 *
 * **A starting set, not a whitelist and not a membership boundary.** There is
 * no fixed universe of artists and none is permanently outside the catalogue;
 * further tranches will be added and self-service addition remains a valid
 * route in (`docs/product-spec.md` §8.9).
 *
 * **Provenance is recorded here on purpose.** `architecture.md` §19.1 requires
 * identity conflicts to remain recorded and reviewable, and a bare list of
 * MBIDs would leave the most important fact in the tranche — that The Wake's
 * upstream cross-links are wrong in both directions — unstated. The evidence
 * field says how each identity was established, and how strong that is.
 *
 * **No provider identifiers are stored.** Where an identity was established by
 * following a provider link, the evidence says so in prose; the identifier
 * itself is not a field. Provider identifiers are enrichment, never identity.
 *
 * **These MBIDs are authoritative input, not a starting point for automated
 * re-resolution.** A conflicting upstream cross-link must never override them.
 */

export type IdentityMethod =
  /** A human established this identity, and it outranks any upstream claim. */
  | 'human_verified'
  /** Works compared across sources — strong evidence, short of a decision. */
  | 'discography_corroborated'
  /** MusicBrainz asserts a provider link. Weakest: fallible, not self-verifying. */
  | 'provider_cross_link';

export type CuratedArtist = {
  /** Display name as curated. Not necessarily MusicBrainz's canonical name. */
  name: string;
  /** The authoritative MusicBrainz artist MBID. */
  mbid: string;
  method: IdentityMethod;
  confidence: 'high' | 'medium' | 'low';
  /** How this identity was established, in prose. */
  evidence: string;
  /** A recorded conflict. Present means unresolved upstream, not unresolved here. */
  conflict?: string;
};

export const CURATED_ARTISTS: readonly CuratedArtist[] = [
  {
    name: 'Amnesia Scanner',
    mbid: '0d54ff79-983b-43c2-a3ac-c114f47c1962',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Ange Halliwell',
    mbid: '0d89b562-b905-4f1c-bfd3-23bf266e8687',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Babyfather',
    mbid: 'da3719b8-229b-43ed-9a9f-8c156930ac7b',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Bassvictim',
    mbid: '4de1756c-e988-4f9f-87bf-bae46f56fefe',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Burial',
    mbid: '9ddce51c-2b75-4b3e-ac8c-1db09e7c89c6',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Charli xcx',
    mbid: '260b6184-8828-48eb-945c-bc4cb6fc34ca',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Courtesy',
    mbid: 'fbf4c43d-2308-434c-b381-7bf0dd4ee689',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Dean Blunt',
    mbid: 'e8bd5b47-e8b4-4671-a9f6-590a92e88898',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'ear',
    mbid: '1e7abe4c-1583-4fb2-8e43-d6fda872d61c',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Eartheater',
    mbid: '7f5a2d26-8625-4788-bafd-0034936895ae',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Fiona Apple',
    mbid: 'a9ee533f-8871-4f62-a6bb-91eb264abc90',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'John Maus',
    mbid: 'c6be66af-28b4-4b87-a8ba-3f46ec6fe986',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Joshua Chuquimia Crampton',
    mbid: 'e7860c29-7ba1-42a7-a522-9d454030e2f0',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'K',
    mbid: '9f926ef2-bd31-4f4d-a6a1-e47c7b75cbd9',
    method: 'human_verified',
    confidence: 'high',
    evidence:
      'Human decision, traced through an external identity trail and confirmed by MusicBrainz\'s own alias and rename relationships: aliases KATERINA and \u0415\u043a\u0430\u0442\u0435\u0440\u0438\u043d\u0430 \u041a\u0438\u0449\u0443\u043a, `artist rename` to KATERINA, `member of band` SEREBRO, disambiguated upstream as "Russian and London-based singer KATERINA & ex-member of SEREBRO".',
    conflict:
      'A name search is useless here: querying MusicBrainz for "K" returns over six thousand artists, none of them this one in the leading results. The display name alone cannot identify this artist.',
  },
  {
    name: 'Lorenzo Senni',
    mbid: '6d048374-a963-4b59-8d49-11406ea8a244',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'My New Band Believe',
    mbid: 'd296518f-e5e3-4ba9-a026-560916dcbc2f',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Palmistry',
    mbid: 'df178740-b2c2-4b95-9222-7289f1556aa6',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Pet Shop Boys',
    mbid: 'be540c02-7898-4b79-9acc-c8122c7d9e83',
    method: 'discography_corroborated',
    confidence: 'high',
    evidence:
      'Discography corroborated: 18 of 35 Spotify album titles match MusicBrainz release groups, including Actually, Behaviour, Bilingual, Electric, Elysium, Fundamental and Hotspot. Non-matches are Further Listening bonus editions and cast recordings \u2014 editions of albums already matched.',
  },
  {
    name: 'Phoebe Bridgers',
    mbid: '96855c21-b832-4366-ba12-0d2330c36a86',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'PJ Harvey',
    mbid: 'e795e03d-b5d5-4a5f-834d-162cfb308a2c',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Portishead',
    mbid: '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Sally Shapiro',
    mbid: '076b616f-399d-41d6-881e-fcb47505912b',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Shygirl',
    mbid: '9385f1a7-8623-4d0c-b171-f1e6e87220c5',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'Sophie',
    mbid: '774b02d7-5056-4b0f-9d69-a82b6ae27cde',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'The Durutti Column',
    mbid: 'aaddb5e3-f8a5-4a9d-8674-f885112ecf0e',
    method: 'discography_corroborated',
    confidence: 'high',
    evidence:
      'Discography corroborated: 29 of 32 Spotify album titles match MusicBrainz release groups. The three non-matches are live albums.',
  },
  {
    name: 'The Hellp',
    mbid: 'ca204bac-2768-4d6f-a5e4-8e8f9080817b',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
  {
    name: 'The Wake',
    mbid: 'c2314623-e863-4fde-af8c-d6e00fec5f2c',
    method: 'human_verified',
    confidence: 'high',
    evidence:
      'Human decision. The curated artist is the Scottish band on Factory and Sarah Records; its release groups (Here Comes Everybody, Harmony, Assembly, A Light Far Out, Tidal Wave of Hype, Make It Loud) match the discography of the Spotify artist the curator follows, title for title.',
    conflict:
      'Two upstream cross-links are wrong, in opposite directions. MusicBrainz a806b588-20bd-479e-8ea4-0fe07cf3b13c ("USA goth band") claims the Spotify URL carrying the Scottish band\'s discography, and MusicBrainz c2314623 claims a Spotify URL belonging to a Finnish melodic-death-metal band. Resolution by cross-link alone selects the wrong artist. Recorded rather than resolved, per architecture.md \u00a719.1.',
  },
  {
    name: 'Tinashe',
    mbid: '396a9525-0994-4542-b480-c4587feeb476',
    method: 'provider_cross_link',
    confidence: 'high',
    evidence:
      'MusicBrainz asserts the Spotify artist URL the curator follows. A provider claim, not a verification \u2014 see architecture.md \u00a719.1.',
  },
];
