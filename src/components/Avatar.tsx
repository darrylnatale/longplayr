import Image from 'next/image';

/**
 * A profile avatar, or a placeholder.
 *
 * `avatar_url` is nullable and there is no upload path yet, so in practice the
 * placeholder is what every profile renders today. It follows the same rule as
 * the artwork placeholder: deterministic, derived from the identifier, and kept
 * dark enough that a wall of them reads as intentional rather than broken
 * (docs/design-reference.md §6.6).
 */

type Props = {
  handle: string;
  /**
   * The name actually shown beside the avatar, when there is one.
   *
   * The initial follows it rather than the handle: a "B" next to "Nadia
   * Okonkwo" reads as the wrong person's avatar. The **tint** stays keyed to
   * the handle, so an identity keeps its colour if the display name changes.
   */
  displayName?: string | null;
  url?: string | null;
  /** Rendered diameter in px. */
  px?: number;
};

function tint(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 12% 16%)`;
}

export function Avatar({ handle, displayName, url, px = 96 }: Props) {
  if (url) {
    return (
      <Image
        src={url}
        alt=""
        width={px}
        height={px}
        className="shrink-0 rounded-full border border-border object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden
      style={{ width: px, height: px, backgroundColor: tint(handle) }}
      className="flex shrink-0 items-center justify-center rounded-full border border-border"
    >
      <span className="font-serif leading-none text-text-secondary" style={{ fontSize: px * 0.4 }}>
        {(displayName?.trim() || handle)[0]?.toUpperCase() ?? '?'}
      </span>
    </div>
  );
}
