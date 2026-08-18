/**
 * A score, 0.0-10.0 to one decimal.
 *
 * Three rules govern this component, and each one is a decision rather than a
 * style preference:
 *
 * 1. **Monochrome.** Scores are never tinted by value. A green-to-red ramp is
 *    the visual grammar of score-obsessed music discourse, and the product is
 *    supposed to push against that register rather than amplify it
 *    (docs/product-spec.md §1). Size, weight and container carry hierarchy.
 *
 * 2. **Unrated is not zero.** An unrated album renders nothing at all. 0.0 is a
 *    real, deliberate score and must never be confused with absence
 *    (docs/design-reference.md §6.2).
 *
 * 3. **Tabular figures.** These sit in grids and columns where a shifting
 *    baseline reads as sloppiness.
 *
 * `variant` separates the two things a numeral can mean here. Yours is a
 * statement and carries the accent; the average is a fact and stays neutral.
 */

type Props = {
  /** Null renders nothing — see rule 2. */
  score: number | null;
  variant: 'user' | 'average';
  size?: 'sm' | 'md' | 'lg';
  /** Rating count, shown beside an average when there is room. */
  count?: number;
};

/** Always one decimal: `8` would read as a different kind of number than `8.0`. */
export function formatScore(score: number): string {
  return score.toFixed(1);
}

const SIZE = {
  sm: { text: 'text-xs', pad: 'px-1.5 py-0.5', bare: 'text-sm' },
  md: { text: 'text-sm', pad: 'px-2 py-0.5', bare: 'text-2xl' },
  lg: { text: 'text-lg', pad: 'px-2.5 py-1', bare: 'text-5xl' },
} as const;

export function ScoreBadge({ score, variant, size = 'md', count }: Props) {
  if (score === null) return null;

  const s = SIZE[size];

  if (variant === 'user') {
    // A bordered chip: compact enough to sit on artwork, and unmistakably a
    // deliberate mark rather than ambient metadata.
    return (
      <span
        className={`tabular inline-flex items-center rounded-sm border border-accent-dim bg-bg/80 font-medium text-accent ${s.text} ${s.pad}`}
        title="Your score"
      >
        {formatScore(score)}
      </span>
    );
  }

  // The average is presented as a bare numeral. It is the loudest thing on an
  // album page by size alone, without a container competing with the artwork.
  return (
    <span className="inline-flex items-baseline gap-2" title="Average score">
      <span className={`tabular font-semibold leading-none text-text ${s.bare}`}>
        {formatScore(score)}
      </span>
      {count !== undefined && (
        <span className="text-xs text-text-muted">
          {count} {count === 1 ? 'rating' : 'ratings'}
        </span>
      )}
    </span>
  );
}
