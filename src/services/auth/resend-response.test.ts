import { describe, expect, it, vi } from 'vitest';

/**
 * What a resend is allowed to reveal. `architecture.md` §6.
 *
 * **The property under test is an absence**: the response must not distinguish
 * an address that has an account from one that does not, and must not
 * distinguish a rate-limited request from an accepted one. Each of those would
 * tell an attacker which addresses are registered — and an email address is not
 * public in longplayr even though a handle is.
 *
 * **`enable_confirmations` is `false` in every environment**, so nothing here is
 * reachable in use yet. That is exactly why it is tested: this file is the only
 * thing standing between the decision and a well-meaning future change that
 * surfaces the provider's error.
 */

const resend = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { resend } }),
}));

const { resendConfirmation } = await import('./index');

describe('resendConfirmation', () => {
  it('returns nothing, so there is no outcome a caller could branch on', async () => {
    resend.mockResolvedValueOnce({ data: {}, error: null });
    await expect(resendConfirmation('reader@example.com')).resolves.toBeUndefined();
  });

  it('swallows an unknown-address error rather than reporting it', async () => {
    // The enumeration guard. Reporting this would answer "is this address
    // registered?" to anyone who asks.
    resend.mockResolvedValueOnce({ data: null, error: { message: 'User not found' } });
    await expect(resendConfirmation('nobody@example.com')).resolves.toBeUndefined();
  });

  it('swallows a rate-limit rejection for the same reason', async () => {
    // Supabase applies a 60-second window per user. Surfacing "try again in 60
    // seconds" for one address and nothing for another leaks the same fact by a
    // different route.
    resend.mockResolvedValueOnce({
      data: null,
      error: { message: 'For security purposes, you can only request this after 60 seconds.' },
    });
    await expect(resendConfirmation('reader@example.com')).resolves.toBeUndefined();
  });

  it('asks the provider for a signup confirmation, for the address given', async () => {
    resend.mockResolvedValueOnce({ data: {}, error: null });
    await resendConfirmation('reader+longplayr@example.com');
    expect(resend).toHaveBeenLastCalledWith({
      type: 'signup',
      email: 'reader+longplayr@example.com',
    });
  });
});
