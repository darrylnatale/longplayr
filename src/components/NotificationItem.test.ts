import { describe, expect, it } from 'vitest';

import { notificationCopy, unreadBadgeLabel } from './NotificationItem';

/**
 * The two pure pieces of a notification, in isolation.
 *
 * The integration suite proves which notifications come back and who may read
 * them; neither is a statement about how a row reads or what the badge says.
 * These are the same kind of test `FeedItem.test.ts` runs against `compactCopy`,
 * and for the same reason.
 */

describe('notificationCopy', () => {
  it('reads as a follow without needing an album', () => {
    expect(notificationCopy('followed', null)).toBe('followed you');
  });

  it('ignores an album on a follow, which cannot carry one', () => {
    expect(notificationCopy('followed', 'In Rainbows')).toBe('followed you');
  });

  it('names the album a review was written about', () => {
    expect(notificationCopy('review_liked', 'In Rainbows')).toBe(
      'liked your review of In Rainbows',
    );
  });

  it('names the list that was liked', () => {
    expect(notificationCopy('list_liked', 'Best of 2026')).toBe('liked your list Best of 2026');
  });

  // The regression this file exists to hold. Before the switch was made
  // exhaustive, `list_liked` fell through to the review branch and rendered
  // "liked your review" — a false statement about content the recipient never
  // wrote, with no type error to catch it.
  it('never describes a liked list as a liked review', () => {
    expect(notificationCopy('list_liked', 'Best of 2026')).not.toContain('review');
    expect(notificationCopy('list_liked', null)).not.toContain('review');
  });

  it('drops the list rather than printing an absence', () => {
    expect(notificationCopy('list_liked', null)).toBe('liked your list');
  });

  it('drops the album rather than printing an absence', () => {
    // A review whose album vanished mid-cascade must not render "your review of
    // undefined". The sentence still stands on its own without it.
    expect(notificationCopy('review_liked', null)).toBe('liked your review');
  });
});

describe('unreadBadgeLabel', () => {
  it('renders nothing at zero rather than a zero', () => {
    expect(unreadBadgeLabel(0)).toBeNull();
  });

  it('is defensive about a negative, which should never arrive', () => {
    expect(unreadBadgeLabel(-1)).toBeNull();
  });

  it('shows the exact number up to nine', () => {
    expect(unreadBadgeLabel(1)).toBe('1');
    expect(unreadBadgeLabel(9)).toBe('9');
  });

  it('caps at ten, where the nav would otherwise start changing width', () => {
    // The boundary is the interesting part: 9 is exact, 10 is the first cap.
    expect(unreadBadgeLabel(10)).toBe('9+');
    expect(unreadBadgeLabel(2847)).toBe('9+');
  });
});
