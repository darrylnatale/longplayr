/**
 * Result type for expected failures.
 *
 * Expected failures — a handle already taken, a malformed field — are outcomes
 * the UI renders, not exceptions. Modelling them as values means the type
 * system forces callers to handle them.
 *
 * Genuinely unexpected failures (database down, bug) still throw.
 */
export type Ok<T> = { ok: true; data: T };
export type Err<E extends string = string> = { ok: false; error: E; message: string };
export type Result<T, E extends string = string> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err<E extends string>(error: E, message: string): Err<E> {
  return { ok: false, error, message };
}
