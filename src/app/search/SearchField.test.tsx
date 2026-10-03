import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchField } from './SearchField';

/**
 * As-you-type search - F-002.
 *
 * **What is under test is how often the URL moves, not that it moves.** Each
 * navigation re-renders the page, and the page's MusicBrainz panel costs up to
 * three requests against a ceiling of one per second. A debounce that fired
 * per keystroke would be a rate-limit incident rather than a UX nicety.
 *
 * **Driven with `fireEvent` rather than `user-event`**, which is not a
 * dependency here. For a controlled input whose only behaviour is a timer,
 * a change event is the whole interaction.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => {
  replace.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Types a value one character at a time, without letting the debounce fire. */
function typeOut(input: HTMLElement, text: string) {
  for (let i = 1; i <= text.length; i += 1) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } });
    vi.advanceTimersByTime(50);
  }
}

describe('SearchField', () => {
  it('does not navigate while typing continues', () => {
    render(<SearchField initialQuery="" />);

    typeOut(screen.getByRole('textbox'), 'radiohead');

    // **The whole point.** Nine keystrokes 50ms apart, no navigation yet.
    expect(replace).not.toHaveBeenCalled();
  });

  it('navigates once when typing stops', () => {
    render(<SearchField initialQuery="" />);

    typeOut(screen.getByRole('textbox'), 'radiohead');
    vi.advanceTimersByTime(400);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/search?q=radiohead', { scroll: false });
  });

  it('does not scroll the page on each update', () => {
    render(<SearchField initialQuery="" />);

    typeOut(screen.getByRole('textbox'), 'abc');
    vi.advanceTimersByTime(400);

    expect(replace.mock.calls[0][1]).toEqual({ scroll: false });
  });

  it('encodes a query that would otherwise break the URL', () => {
    render(<SearchField initialQuery="" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'guns & roses' } });
    vi.advanceTimersByTime(400);

    expect(replace).toHaveBeenCalledWith('/search?q=guns%20%26%20roses', { scroll: false });
  });

  it('trims before navigating, so a trailing space is not a new search', () => {
    render(<SearchField initialQuery="" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'kid a  ' } });
    vi.advanceTimersByTime(400);

    expect(replace).toHaveBeenCalledWith('/search?q=kid%20a', { scroll: false });
  });

  it('clears to the bare path when the field is emptied', () => {
    render(<SearchField initialQuery="radiohead" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    vi.advanceTimersByTime(400);

    expect(replace).toHaveBeenCalledWith('/search', { scroll: false });
  });

  it('never re-navigates to the query it was given', () => {
    // **The wasteful case.** Deleting a character and retyping it returns the
    // field to a value already in the URL; navigating again would re-run the
    // upstream search for results already on screen.
    render(<SearchField initialQuery="radiohead" />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'radiohea' } });
    fireEvent.change(input, { target: { value: 'radiohead' } });
    vi.advanceTimersByTime(400);

    expect(replace).not.toHaveBeenCalled();
  });

  it('starts from the query already in the URL', () => {
    render(<SearchField initialQuery="kid a" />);
    expect(screen.getByRole('textbox')).toHaveValue('kid a');
  });
});
