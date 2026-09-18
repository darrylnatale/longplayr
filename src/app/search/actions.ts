'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { drainJobs } from '@/services/catalogue/jobs';
import { addAlbumFromUpstream } from '@/services/catalogue/self-service';

export type AddState = { error?: string; addedSlug?: string };

/**
 * How many queued jobs to run once the response has been sent.
 *
 * Small on purpose. The album's own artwork job is enqueued at
 * `INTERACTIVE_JOB_PRIORITY` and jobs are claimed `order by priority asc`, so
 * it is claimed first; the remaining slots opportunistically clear whatever
 * backfill is sitting behind it. Cover Art Archive imposes no rate limit
 * (`artwork.ts`), so these do not queue behind the MusicBrainz limiter and a
 * small batch is genuinely quick.
 */
const AFTER_ADD_BATCH = 3;

export async function addAlbum(_prev: AddState, formData: FormData): Promise<AddState> {
  const mbid = String(formData.get('mbid') ?? '');
  if (!mbid) return { error: 'Missing record identifier.' };

  const result = await addAlbumFromUpstream(mbid);

  if (!result.ok) return { error: result.message };

  /**
   * Fetch the artwork now, without making the caller wait for it.
   *
   * `after` runs once the response has been sent, so the add stays exactly as
   * fast as it was while the cover lands seconds later instead of on the next
   * daily cron. That gap was never a design choice: **Vercel's Hobby plan caps
   * cron at one run per day**, so an album added on Tuesday showed a
   * placeholder until Wednesday — on the one surface where a missing cover
   * reads as a broken feature rather than a thin catalogue.
   *
   * **Deliberately not awaited inline.** Doing the fetch before returning would
   * add a third round trip to a path that already costs two rate-limited
   * MusicBrainz requests, trading a slow-appearing cover for a slower add.
   *
   * **Failure is swallowed on purpose.** This is an optimisation over a queue
   * that still holds the job: if the drain throws, or the platform freezes the
   * function first, the row stays queued and the daily cron collects it. The
   * failure mode is the old behaviour, which is why it is safe to let it go
   * quiet rather than surfacing an error for work the user never asked for.
   */
  after(async () => {
    try {
      await drainJobs(AFTER_ADD_BATCH);
    } catch {
      // Intentionally ignored — see above. The queue is the source of truth.
    }
  });

  revalidatePath('/search');
  return { addedSlug: result.data.slug };
}
