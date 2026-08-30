import { describe, expect, it } from 'vitest';

import { FOLLOW_PAGE_SIZE, toFollowUser } from './index';

/**
 * The relationship-list mapping, in isolation.
 *
 * This is the part of the read path the integration suite cannot reach:
 * `listFollowers` builds a cookie-bound client and there is no request scope in
 * a test, so those tests exercise the query and this exercises what happens to
 * the rows afterwards. Between them the path is covered end to end.
 */

const person = {
  id: 'profile-1',
  handle: 'nadia',
  display_name: 'Nadia Okonkwo',
  avatar_url: null,
  status: 'active',
};

describe('toFollowUser', () => {
  it('flattens the embedded profile onto the list item', () => {
    expect(toFollowUser({ person })).toEqual([
      { id: 'profile-1', handle: 'nadia', display_name: 'Nadia Okonkwo', avatar_url: null },
    ]);
  });

  it('drops `status` rather than carrying it into the UI', () => {
    // The filter belongs to the query. Passing the column onward would invite a
    // second, divergent check in a component.
    const [item] = toFollowUser({ person });
    expect(item).not.toHaveProperty('status');
  });

  it('keeps a handle with no display name', () => {
    const [item] = toFollowUser({ person: { ...person, display_name: null } });
    expect(item.display_name).toBeNull();
    expect(item.handle).toBe('nadia');
  });

  it('preserves an avatar url when one exists', () => {
    const [item] = toFollowUser({ person: { ...person, avatar_url: 'https://example/a.png' } });
    expect(item.avatar_url).toBe('https://example/a.png');
  });

  it('drops a row whose person did not come back', () => {
    // Unreachable through the inner join, and returning an array is what keeps
    // the return type honest instead of inventing a placeholder identity.
    expect(toFollowUser({ person: null })).toEqual([]);
  });
});

describe('FOLLOW_PAGE_SIZE', () => {
  it('is a relationship-list decision, not the collection grid size', () => {
    // Recorded as a test because the tempting cleanup is to share one constant,
    // and the two answer different questions: rows of people against a cover
    // grid whose 60 divides evenly across the density ramp.
    expect(FOLLOW_PAGE_SIZE).toBe(50);
  });
});
