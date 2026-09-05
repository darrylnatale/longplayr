import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { Avatar } from '@/components/Avatar';
import { formatScore } from '@/components/ScoreBadge';
import type { FeedItem as Item } from '@/services/social/feed';

/**
 * One feed event, in one of two weights.
 *
 * **Two tiers, split by event type** — `design-reference.md` §4's borrowed
 * pattern, resolved onto the types that exist. A review is a full item; adds,
 * ratings and relistens are one-line items. §5.5 asked whether two tiers still
 * earn their complexity now that likes and follows are excluded from the feed,
 * and the answer is that the concern inverts here: the compact tier carries most
 * of the volume and the full tier is the thin one. The excerpt is required
 * either way, so a single tier would mean rendering prose inside a one-line row.
 *
 * **Server-rendered, and that is what makes the relative time safe.** A duration
 * carries no timezone, unlike every absolute date in the product, so the class
 * of bug `formatPartialDate` guards against cannot arise. Keeping this off the
 * client also keeps `new Date()` from being evaluated twice either side of a
 * hydration boundary, where "59s" and "1m" would disagree.
 */

/** Steps, largest unit that still reads as a small number. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * Terse relative time — `now`, `14h`, `2d`.
 *
 * **The feed is the only place the product shows time at all**
 * (`design-reference.md` §4), so this format exists here and nowhere else.
 *
 * Under a minute reads `now` rather than `0m`, because a count of zero is a
 * worse answer than a word. A future timestamp — clock skew between the database
 * and the renderer — also reads `now` rather than a negative count.
 *
 * `now` is injectable so the unit tests are not timing-dependent.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);

  if (seconds < MINUTE) return 'now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d`;
  if (seconds < YEAR) return `${Math.floor(seconds / WEEK)}w`;
  return `${Math.floor(seconds / YEAR)}y`;
}

/** Longest excerpt rendered. The row returns more than this, deliberately. */
const EXCERPT = 240;

/**
 * The review excerpt.
 *
 * Cut at the last word boundary at or before the budget, with an ellipsis only
 * when something was actually removed — a body that fits is rendered whole and
 * unmarked. The database already truncates to a larger bound purely to keep
 * ten-thousand-character bodies off the wire, so the text arriving here is
 * always longer than what this returns.
 */
export function excerpt(body: string, max: number = EXCERPT): string {
  const text = body.trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');

  // A single word longer than the budget has no boundary to cut on; take the
  // hard cut rather than returning an empty string.
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The words for a one-line event.
 *
 * **`added … to their collection`, not `listened to`.** longplayr is a
 * collection rather than a diary, and "listened to X" reads as a dated play —
 * the exact reading the one-entry-per-album rule exists to prevent. Naming the
 * collection also keeps the sentence unambiguous once lists arrive and there is
 * more than one thing an album can be added to.
 *
 * **`relistened to X` carries no count.** `relisten_count` is the entry's
 * running total, not this event's ordinal, so rendering it beside one event
 * would show a current total against a historical action — the claim that has
 * stopped being true that `data-model.md` §7 forbids. The feed row does not
 * receive the count at all.
 */
export function compactCopy(type: 'listened' | 'rated' | 'relistened'): {
  verb: string;
  trailing: string | null;
} {
  switch (type) {
    case 'listened':
      return { verb: 'added', trailing: 'to their collection' };
    case 'rated':
      return { verb: 'rated', trailing: null };
    case 'relistened':
      return { verb: 'relistened to', trailing: null };
  }
}

function ActorLink({ item }: { item: Item }) {
  return (
    <Link href={`/${item.actor.handle}`} className="text-text transition-colors hover:text-accent">
      {item.actor.displayName ?? item.actor.handle}
    </Link>
  );
}

/**
 * The album-bearing half of the union.
 *
 * Four of the five event types resolve to an album; `list_created` does not.
 * Naming the narrowed type once keeps every album renderer honest without each
 * one repeating the exclusion.
 */
type AlbumItem = Extract<Item, { album: unknown }>;
type ListItem = Extract<Item, { type: 'list_created' }>;

function AlbumLink({ item }: { item: AlbumItem }) {
  return (
    <Link
      href={`/albums/${item.album.mbid}`}
      className="text-text transition-colors hover:text-accent"
    >
      {item.album.title}
    </Link>
  );
}

/** The relative time, right-aligned and never the loudest thing in the row. */
function Time({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="tabular shrink-0 text-xs text-text-faint">
      {formatRelativeTime(iso)}
    </time>
  );
}

function Compact({ item }: { item: AlbumItem }) {
  const { verb, trailing } = compactCopy(item.type as 'listened' | 'rated' | 'relistened');

  return (
    <li className="flex items-center gap-3 border-b border-border py-3">
      <Avatar
        handle={item.actor.handle}
        displayName={item.actor.displayName}
        url={item.actor.avatarUrl}
        px={40}
      />

      <p className="min-w-0 flex-1 text-sm leading-snug text-text-secondary">
        <ActorLink item={item} /> {verb} <AlbumLink item={item} />
        {item.type === 'rated' && item.score !== null && (
          <>
            {' '}
            <span className="tabular font-medium text-accent">{formatScore(item.score)}</span>
          </>
        )}
        {trailing && <> {trailing}</>}
      </p>

      <Time iso={item.createdAt} />
    </li>
  );
}

function Full({ item }: { item: AlbumItem }) {
  return (
    <li className="flex gap-4 border-b border-border py-4">
      <Link href={`/albums/${item.album.mbid}`} className="w-16 shrink-0">
        <AlbumCover
          mbid={item.album.mbid}
          title={item.album.title}
          hasArtwork={item.album.hasArtwork}
          px={64}
          size={250}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 text-sm text-text-secondary">
            <ActorLink item={item} /> reviewed <AlbumLink item={item} />
            {item.score !== null && (
              <>
                {' '}
                <span className="tabular font-medium text-accent">{formatScore(item.score)}</span>
              </>
            )}
          </p>
          <Time iso={item.createdAt} />
        </div>

        <p className="mt-1 text-xs text-text-muted">{item.album.credit}</p>

        {/* Editorial prose takes the serif, the same division the review
            interface and the album page already use. */}
        {item.reviewBody && (
          <p className="mt-2 font-serif text-sm leading-relaxed text-text">
            {excerpt(item.reviewBody)}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * A made list, in the compact tier.
 *
 * **Only creation is an event, and the item reads the list's live state**, so
 * the title shown is whatever the list is called when the follower sees it. No
 * cover: a list has no single artwork, and inventing one from its first album
 * would make the row claim something about that album instead.
 */
function ListCreated({ item }: { item: ListItem }) {
  return (
    <li className="flex items-center gap-3 border-b border-border py-3">
      <Avatar
        handle={item.actor.handle}
        displayName={item.actor.displayName}
        url={item.actor.avatarUrl}
        px={40}
      />

      <p className="min-w-0 flex-1 text-sm leading-snug text-text-secondary">
        <ActorLink item={item} /> made a list{' '}
        <Link
          href={`/lists/${item.list.id}`}
          className="text-text transition-colors hover:text-accent"
        >
          {item.list.title}
        </Link>
      </p>

      <Time iso={item.createdAt} />
    </li>
  );
}

/**
 * **Exhaustive by construction.** A sixth event type will fail to compile here
 * rather than rendering as a silent blank row, which is the same guard
 * `NotificationItem` uses for its own union.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled feed item: ${JSON.stringify(value)}`);
}

export function FeedItem({ item }: { item: Item }) {
  switch (item.type) {
    case 'reviewed':
      return <Full item={item} />;
    case 'listened':
    case 'rated':
    case 'relistened':
      return <Compact item={item} />;
    case 'list_created':
      return <ListCreated item={item} />;
    default:
      return assertNever(item);
  }
}

export function FeedList({ items }: { items: Item[] }) {
  // Named, so assistive technology announces what the list is — and so a test
  // can address the feed rather than every <li> on the page, the tab bar's
  // included.
  return (
    <ul aria-label="Feed" className="border-t border-border">
      {items.map((item) => (
        <FeedItem key={item.id} item={item} />
      ))}
    </ul>
  );
}
