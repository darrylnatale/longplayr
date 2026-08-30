import Link from 'next/link';

/**
 * The profile stat cluster.
 *
 * **It arrives now because it finally has companions.** The profile page
 * carried a written decision that a cluster of one statistic — or one padded
 * with "0 following · 0 followers" — would imply surfaces that did not exist.
 * The follows slice supplies them, which is the condition that decision named.
 *
 * **Two statistics: following and followers** (`product-spec.md` §6).
 *
 * **Albums is deliberately absent, and this was learned the hard way.** A first
 * implementation carried it here as well, which printed the same number twice
 * on one screen and broke four profile tests on a strict-mode violation — the
 * duplication the profile page's own comment had warned about before this
 * component existed. The album count already has an established role in the
 * Collection section header, where **the count is the navigation** to
 * `/<handle>/collection` (decided 2026-08-19, and still authoritative). Adding
 * it here duplicated the information without adding a function; removing it
 * from the Collection section would have overturned a decided interaction. Two
 * social statistics are enough to establish the cluster.
 *
 * **"Listened this year" is deliberately absent too** — §6 names it, but its
 * semantics are undecided (calendar or rolling year, and what an entry with no
 * `listened_on` counts as) and it must not be added as a substitute third
 * statistic.
 *
 * **The counts are the navigation.** Following and followers link to their
 * destinations, which is the same "count at the far right becomes the way
 * through" pattern the collection preview already uses, rather than a separate
 * control competing with it.
 *
 * **Zero is stated, not hidden.** An unfollowed account reading "0 followers"
 * is true and legible; suppressing the number would leave a gap the reader has
 * to interpret. What the profile page refused earlier was a cluster made
 * *entirely* of zeroed counters standing in for absent features — not an honest
 * zero beside real ones.
 */

type Props = {
  handle: string;
  following: number;
  followers: number;
};

/** `href` is required: both remaining statistics are navigation. */
function Stat({ value, label, href }: { value: number; label: string; href: string }) {
  return (
    <Link href={href} className="text-sm transition-colors hover:text-text">
      <span className="tabular text-text">{value.toLocaleString()}</span>{' '}
      <span className="text-text-muted">{label}</span>
    </Link>
  );
}

export function ProfileStats({ handle, following, followers }: Props) {
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <Stat value={following} label="following" href={`/${handle}/following`} />
      <Stat
        value={followers}
        label={followers === 1 ? 'follower' : 'followers'}
        href={`/${handle}/followers`}
      />
    </div>
  );
}
