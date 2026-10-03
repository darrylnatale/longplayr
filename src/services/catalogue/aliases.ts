import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { COUNT_ONLY, countRows } from '@/services/count';
import type { Database } from '@/lib/supabase/database.types';

import { getArtistWithAliases, type MbAlias, NotFoundError } from './musicbrainz';

type Admin = SupabaseClient<Database>;
type AliasKind = Database['public']['Enums']['artist_alias_kind'];

/**
 * MusicBrainz artist aliases - F-019, `architecture.md` section 10.5.
 *
 * **Aliases widen search matching and are never displayed.** The canonical name
 * is what `artists.name` holds and what every surface renders; these exist so
 * that somebody typing a former name, a transliteration or a known misspelling
 * reaches the artist anyway.
 */

export type AliasResult =
  | { status: 'stored'; count: number }
  | { status: 'absent'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Which MusicBrainz alias types become rows.
 *
 * **Two in, two out, and the exclusions are decisions rather than oversights.**
 *
 * `Legal name` is excluded because making an artist who performs under a
 * pseudonym findable by a birth name is a privacy decision, and not one to take
 * by default - MusicBrainz marks it distinctly because it *is* a different kind
 * of thing.
 *
 * **Untyped is excluded, and the live data is why**: Ye's one untyped alias is
 * `Donda`, an album title. Untyped is a mixed bag, and admitting it would admit
 * noise rather than names.
 */
const KIND_BY_MB_TYPE: Record<string, AliasKind> = {
  'Artist name': 'artist_name',
  'Search hint': 'search_hint',
};

/** The alias rows worth storing, deduplicated the way the table's key is. */
export function selectAliases(aliases: MbAlias[] | null | undefined) {
  const seen = new Set<string>();
  const rows: {
    name: string;
    kind: AliasKind;
    locale: string | null;
    is_primary: boolean | null;
  }[] = [];

  for (const alias of aliases ?? []) {
    const kind = alias.type ? KIND_BY_MB_TYPE[alias.type] : undefined;
    if (!kind) continue;

    const name = alias.name?.trim();
    if (!name) continue;

    // **Deduplicated on the table's own key**, because MusicBrainz legitimately
    // returns the same string twice under one type in different locales - Ye
    // has `Kanye West` as `Artist name` with locale `zh` and again with none.
    // Without this the insert fails the unique constraint on a real artist.
    const key = `${name.toLowerCase()} ${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      name,
      kind,
      locale: alias.locale ?? null,
      is_primary: alias.primary ?? null,
    });
  }

  return rows;
}

/**
 * Records the outcome on the artist row.
 *
 * **This is what makes the enqueue path terminate.** `stored` and `absent` are
 * both settled, so a sweep never looks at that artist again; `failed` stays
 * retryable. Without it the backfill would re-request every alias-less artist
 * on every pass - see `20261002150000_artist_alias_status.sql`.
 */
async function markAliasStatus(
  artistId: string,
  status: Database['public']['Enums']['alias_status'],
  admin: Admin,
) {
  const { error } = await admin.from('artists').update({ alias_status: status }).eq('id', artistId);
  if (error) throw error;
}

/**
 * Fetches one artist's aliases and replaces whatever is stored.
 *
 * **Replace rather than merge**, and deliberately: MusicBrainz is the source of
 * truth and an alias can be *removed* upstream. Merging would accumulate names
 * the editors have since rejected, and there is no other writer to conflict
 * with - `CLAUDE.md`'s read-only-downstream rule is what makes replace safe.
 *
 * **Returns rather than throws for an absent artist**, matching
 * `fetchAndStoreTracklist`: an artist that is not in the catalogue is not this
 * job's problem and must not be retried.
 */
export async function fetchAndStoreArtistAliases(
  artistMbid: string,
  admin: Admin = createAdminClient(),
): Promise<AliasResult> {
  const { data: artist, error } = await admin
    .from('artists')
    .select('id')
    .eq('mbid', artistMbid)
    .maybeSingle();
  if (error) throw error;

  if (!artist) {
    // No row to mark, which is the one `absent` that records nothing.
    return { status: 'absent', reason: 'No such artist in the catalogue.' };
  }

  let rows: ReturnType<typeof selectAliases>;
  try {
    const upstream = await getArtistWithAliases(artistMbid);
    rows = selectAliases(upstream.aliases);
  } catch (cause) {
    /*
     * **A 404 is an answer, not a failure**, and this branch exists because
     * without it the sweep never terminates for such an artist. MusicBrainz no
     * longer resolving an MBID almost always means a merge, which retrying
     * cannot undo - so it is recorded as absence. `failed` is retryable by
     * `enqueueMissingArtistAliases`, so leaving a permanent 404 there would
     * re-queue the same artist on every pass, forever, spending the shared
     * 1 req/sec budget to re-learn it.
     *
     * The same reasoning and the same treatment as `fetchAndStoreTracklist`.
     */
    if (cause instanceof NotFoundError) {
      await markAliasStatus(artist.id, 'absent', admin);
      return {
        status: 'absent',
        reason: `MusicBrainz no longer resolves artist ${artistMbid}`,
      };
    }

    // Handed back rather than thrown, so the caller decides whether this is a
    // retry. The job case re-raises; a direct caller may not want to.
    await markAliasStatus(artist.id, 'failed', admin);
    return { status: 'failed', reason: cause instanceof Error ? cause.message : String(cause) };
  }

  const { error: deleteError } = await admin
    .from('artist_aliases')
    .delete()
    .eq('artist_id', artist.id);
  if (deleteError) throw deleteError;

  if (rows.length === 0) {
    // **A real outcome, not a failure.** Plenty of artists have no alias worth
    // storing, and retrying would spend a request against the budget to learn
    // the same thing.
    await markAliasStatus(artist.id, 'absent', admin);
    return { status: 'absent', reason: 'MusicBrainz lists no usable alias.' };
  }

  const { error: insertError } = await admin
    .from('artist_aliases')
    .insert(rows.map((row) => ({ ...row, artist_id: artist.id })));
  if (insertError) throw insertError;

  await markAliasStatus(artist.id, 'stored', admin);
  return { status: 'stored', count: rows.length };
}

/**
 * How far alias ingestion has got.
 *
 * **Counted server-side rather than by reading rows.** `tracklistCoverage`
 * reads every album because it has to follow an embed to reach the status;
 * `alias_status` sits on `artists` directly, so five counts answer this without
 * transferring the catalogue.
 *
 * Through `countRows` rather than a raw count, which §16.2 requires and an
 * ESLint rule enforces: a bare `head: true` count reports a confident zero for
 * a relation the database could not resolve, so a brand-new column would read
 * as "no artists anywhere" rather than as an error.
 */
export async function aliasCoverage(admin: Admin = createAdminClient()): Promise<{
  stored: number;
  absent: number;
  failed: number;
  pending: number;
  total: number;
  aliasRows: number;
  /** stored / (stored + absent + failed). Failures are never hidden. */
  observedCoveragePercent: number;
}> {
  const statuses = ['stored', 'absent', 'failed', 'pending'] as const;

  const counted = await Promise.all(
    statuses.map(
      async (status) =>
        [
          status,
          await countRows(
            admin.from('artists').select('id', COUNT_ONLY).eq('alias_status', status),
            `artists.alias_status=${status}`,
          ),
        ] as const,
    ),
  );

  const aliasRows = await countRows(
    admin.from('artist_aliases').select('id', COUNT_ONLY),
    'artist_aliases',
  );

  const counts = Object.fromEntries(counted) as Record<(typeof statuses)[number], number>;
  const total = counts.stored + counts.absent + counts.failed + counts.pending;
  const attempted = counts.stored + counts.absent + counts.failed;

  return {
    ...counts,
    total,
    aliasRows,
    observedCoveragePercent:
      attempted === 0 ? 0 : Math.round((counts.stored / attempted) * 1000) / 10,
  };
}
