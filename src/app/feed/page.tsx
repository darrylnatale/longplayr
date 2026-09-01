import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Container } from '@/components/Container';
import { FeedList } from '@/components/FeedItem';
import { SectionHeader } from '@/components/SectionHeader';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';
import { getFollowCounts } from '@/services/social';
import { FEED_PAGE_SIZE, listFeed, type FeedCursor } from '@/services/social/feed';

import { cursorFrom, feedPath } from './pagination';

/**
 * The following feed.
 *
 * **Its own destination, and not the home page.** `/` stays the orientation
 * surface that makes no catalogue queries; the signed-in home belongs to Phase 5
 * along with the cold-start and no-follows states, and claiming it here would
 * settle that phase's work by implementing it (`product-spec.md` §6).
 *
 * **Not cached, and it cannot be.** Personal by definition — `architecture.md`
 * §7 already records the feed as fully dynamic and per-user.
 *
 * **Signed out this redirects rather than rendering.** That is not an exception
 * to the all-public model: the rule governs user-generated content, and a feed is
 * not content — it is a per-viewer query whose only input is the viewer's own
 * follow graph, so there is nothing in it to make public. A signed-in user
 * without a profile cannot follow anyone, by foreign key, so they go to
 * onboarding rather than to an empty feed that answers a question they cannot
 * yet ask.
 */

export const metadata = { title: 'Feed · longplayr' };

/**
 * The three ways this page lists nothing, and they answer two different
 * questions.
 *
 * **`no-follows` and `no-events` answer "why is your feed empty?"** Following
 * nobody is a different fact from following people who have done nothing, and a
 * shared message would tell the second reader they had made a mistake. Neither
 * draws a panel, a heading or a zeroed counter — the rule the profile already
 * applies to absent favourites.
 *
 * **`end-of-feed` answers a different question — "why is *this page* empty?"**
 * The feed itself is not empty at all; the reader has run out of it. It is not a
 * 404, because the feed computes no total and its sequence is mutable — following
 * someone new inserts their older events below a point already passed — so an
 * empty result is never proof of permanent non-existence (`product-spec.md` §6,
 * `architecture.md` §16.1).
 *
 * The follows-nobody line points at album pages, which is where another person
 * is currently visible at all. Suggested accounts would be taste overlap
 * (`product-spec.md` §10.2) and charts are Phase 5; neither is improvised here.
 */
type EmptyKind = 'end-of-feed' | 'no-follows' | 'no-events';

/** Shared by the two states that carry a link, so they cannot drift apart. */
const INLINE_LINK =
  'text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent';

function Empty({ kind }: { kind: EmptyKind }) {
  if (kind === 'end-of-feed') {
    // **This state carries its own way back, and that is load-bearing.** The
    // `Older →` navigation below renders only when there is a next cursor, and
    // on this state there is not — so nothing else on the page would offer one.
    return (
      <p className="max-w-[46ch] text-sm leading-relaxed text-text-muted">
        You&apos;ve reached the end of your feed.{' '}
        <Link href="/feed" className={INLINE_LINK}>
          Back to top
        </Link>
      </p>
    );
  }

  if (kind === 'no-follows') {
    return (
      <p className="max-w-[46ch] text-sm leading-relaxed text-text-muted">
        You aren’t following anyone yet. When you do, what they add, rate and write about appears
        here. You’ll find people on{' '}
        <Link href="/albums" className={INLINE_LINK}>
          album pages
        </Link>
        , wherever someone has written a review.
      </p>
    );
  }

  return (
    <p className="max-w-[46ch] text-sm leading-relaxed text-text-muted">
      Nobody you follow has done anything yet.
    </p>
  );
}

/**
 * Which absence this is.
 *
 * **A cursor that ran out is not an empty feed**, so it never reaches the follow
 * graph: `getFollowCounts` exists only to separate the two states above it, and
 * asking it here would spend two counts answering a question nobody asked.
 */
async function emptyKind(profileId: string, cursor: FeedCursor | null): Promise<EmptyKind> {
  if (cursor) return 'end-of-feed';

  const { following } = await getFollowCounts(profileId);
  return following === 0 ? 'no-follows' : 'no-events';
}

export default async function FeedPage({ searchParams }: PageProps<'/feed'>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = await getCurrentProfile();
  if (!profile) redirect('/onboarding');

  const query = await searchParams;
  const cursor = cursorFrom(query.before, query.before_id);

  const { items, nextCursor } = await listFeed(profile.id, {
    limit: FEED_PAGE_SIZE,
    cursor,
  });

  // An empty page cannot tell the absences apart on its own, so the distinction
  // is drawn from the cursor and, only where that is not enough, from the follow
  // graph. `getFollowCounts` is reused rather than a narrower query added: it
  // already applies the same active-profile filter the feed does, and the cost
  // is two head counts on a page that is rendering nothing.
  const kind = items.length === 0 ? await emptyKind(profile.id, cursor) : null;

  return (
    <Container variant="content">
      <div className="py-8 sm:py-10">
        <SectionHeader>Feed</SectionHeader>

        {kind ? (
          <Empty kind={kind} />
        ) : (
          <>
            <FeedList items={items} />

            {/*
             * One direction only. A feed grows at the top while it is being
             * read, so a numbered page is not a stable address and a "Newer"
             * link is a journey nobody makes — the bare /feed is the way back.
             */}
            {nextCursor && (
              <nav
                aria-label="Feed pagination"
                className="mt-8 flex items-center justify-between border-t border-border pt-4"
              >
                <Link
                  href="/feed"
                  className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
                >
                  Back to top
                </Link>
                <Link
                  href={feedPath(nextCursor)}
                  rel="next"
                  className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
                >
                  Older <span aria-hidden>→</span>
                </Link>
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}
