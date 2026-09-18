/**
 * Whether someone typed their own handle to confirm deletion.
 *
 * **The confirmation is the handle rather than the password, and that is
 * structural rather than stylistic.** The stack is email/password **plus
 * Google** (`CLAUDE.md`), and a Google-authenticated account has no password to
 * re-enter — so a password prompt is a confirmation that some users cannot
 * complete at all. `product-spec.md` §6, Settings.
 *
 * **Pure and separate so the comparison can be proven without a database**, the
 * way the rest of this codebase's small rules already are. Deletion is the one
 * action in the product with no undo; the check in front of it should be the
 * easiest thing here to read.
 */

/**
 * Compares typed input against the account's own handle.
 *
 * **Lenient about the things that are not the point, strict about the one that
 * is.** Surrounding whitespace, a pasted `@` prefix and capitalisation are all
 * forgiven — handles are stored lowercase and `@darryl` is how people write one
 * — while any difference in the handle itself fails. Someone who typed their
 * handle correctly and lost to a leading space would reasonably conclude the
 * form was broken.
 */
export function confirmationMatches(input: string, handle: string): boolean {
  const typed = normaliseConfirmation(input);

  // An empty handle can only mean a caller passed something it should not
  // have. Returning false is the safe answer: empty input must never confirm.
  if (handle.length === 0) return false;

  return typed === normaliseConfirmation(handle);
}

/** Trims, drops one leading `@`, lowercases. */
function normaliseConfirmation(value: string): string {
  return value.trim().replace(/^@/, '').trim().toLowerCase();
}
