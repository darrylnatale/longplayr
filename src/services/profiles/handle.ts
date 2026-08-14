import { z } from 'zod';

/**
 * Handle rules.
 *
 * Provisional — docs/product-spec.md §8.8 is still open. The format here
 * mirrors the CHECK constraint in the profiles migration; changing one means
 * changing both.
 *
 * Handles are lowercase-only so uniqueness needs no case folding, and because
 * mixed-case handles invite impersonation (darryl vs DarryI).
 */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/** Must start with a letter, then letters, digits or underscores. */
const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;

/**
 * Handles live at the site root (`/<handle>`), so every top-level route is a
 * potential collision. Anything added to the routing table must be added here
 * too, or the route silently shadows a user's profile.
 */
const RESERVED_HANDLES = new Set([
  // Routing collisions
  'about',
  'admin',
  'api',
  'albums',
  'artists',
  'auth',
  'blog',
  'contact',
  'feed',
  'help',
  'lists',
  'login',
  'logout',
  'members',
  'new',
  'notifications',
  'privacy',
  'search',
  'settings',
  'signin',
  'signout',
  'signup',
  'support',
  'terms',
  // Impersonation risks
  'longplayr',
  'moderator',
  'official',
  'root',
  'staff',
  'system',
  // Reserved for future use
  'me',
  'you',
]);

export type HandleError = 'too_short' | 'too_long' | 'invalid_format' | 'reserved';

/** Lowercases and trims. Applied before validation and before storage. */
export function normaliseHandle(input: string): string {
  return input.trim().toLowerCase();
}

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(normaliseHandle(handle));
}

export const handleSchema = z
  .string()
  .transform(normaliseHandle)
  .superRefine((value, ctx) => {
    if (value.length < HANDLE_MIN_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        params: { reason: 'too_short' satisfies HandleError },
        message: `Handles must be at least ${HANDLE_MIN_LENGTH} characters.`,
      });
      return;
    }

    if (value.length > HANDLE_MAX_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        params: { reason: 'too_long' satisfies HandleError },
        message: `Handles must be at most ${HANDLE_MAX_LENGTH} characters.`,
      });
      return;
    }

    if (!HANDLE_PATTERN.test(value)) {
      ctx.addIssue({
        code: 'custom',
        params: { reason: 'invalid_format' satisfies HandleError },
        message: 'Handles start with a letter and use only letters, numbers and underscores.',
      });
      return;
    }

    if (isReservedHandle(value)) {
      ctx.addIssue({
        code: 'custom',
        params: { reason: 'reserved' satisfies HandleError },
        message: 'That handle is not available.',
      });
    }
  });
