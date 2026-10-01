'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  resendConfirmation,
  signInWithPassword,
  signOutCurrentUser,
  signUpWithPassword,
} from '@/services/auth';
import { passwordChoiceSchema } from '@/services/auth/password-policy';
import { signUpDestination } from '@/services/auth/signup-destination';

export type AuthFormState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string; confirmPassword?: string };
  /**
   * The address that was submitted, echoed back so a rejected attempt does not
   * also lose it. **No password field is ever echoed** — `architecture.md`
   * §6.2. React 19 resets an uncontrolled form once its action resolves, which
   * is why this is needed at all rather than being free.
   */
  email?: string;
};

/**
 * Sign-in and signup no longer share a schema, and that split is a prerequisite
 * rather than a tidy-up.
 *
 * Both ran one `credentialsSchema` with an 8-character rule. **Raising the
 * minimum under that arrangement would have locked out every existing account
 * with a shorter password** — not with a wrong-password error, but with a
 * validation message before the credentials were ever checked.
 *
 * **A policy is a rule for choosing a password, not a rule for presenting one
 * you already have.** Sign-in therefore checks only that an email is well-formed
 * and a password was supplied; whether it is the *right* password is Supabase's
 * job, and whether it meets today's policy is nobody's.
 */
const signInSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * **Length only, and the absence of composition rules is a decision.**
 *
 * Requiring a digit, a symbol or a capital pushes people towards predictable
 * substitutions — `Password1!` satisfies every such rule — while adding little
 * real entropy. Length is the lever that works. A breach-list check is the
 * genuinely effective addition and is deliberately out of scope: it means an
 * external call on every signup and a privacy question. `architecture.md` §6.
 */
/**
 * Signup is an email plus the shared password-choice rule.
 *
 * **The choice rule lives in `password-policy.ts` and is shared with reset**,
 * so the two cannot drift. The composition here is deliberate: signup needs an
 * address as well, reset already knows who it is talking to.
 */
const signUpSchema = z
  .object({ email: z.email('Enter a valid email address.') })
  .and(passwordChoiceSchema);

function parseSignIn(formData: FormData) {
  return signInSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
}

function parseSignUp(formData: FormData) {
  return signUpSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });
}

function fieldErrorsFrom(error: z.ZodError): AuthFormState['fieldErrors'] {
  const fieldErrors: NonNullable<AuthFormState['fieldErrors']> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'email' || field === 'password' || field === 'confirmPassword') {
      fieldErrors[field] ??= issue.message;
    }
  }
  return fieldErrors;
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const submitted = String(formData.get('email') ?? '');

  const parsed = parseSignUp(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), email: submitted };
  }

  const result = await signUpWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message, email: submitted };
  }

  revalidatePath('/', 'layout');

  /*
   * **Two destinations, because there are two outcomes.**
   *
   * `signUpWithPassword` already reported whether a session was issued, and
   * this action used to discard it and redirect to `/onboarding` regardless.
   * With confirmation enabled there is no session, so `/onboarding` bounced the
   * new account to a sign-in form — **asking somebody who has just registered to
   * sign in, with no mention of an email and no explanation.**
   *
   * **The switch is off everywhere today**, so this branch does not fire yet.
   * That is deliberate: `enable_confirmations` lives in version-controlled
   * config and roughly sixteen end-to-end specs sign up expecting a session.
   * Making the code correct for both states means enabling confirmation later is
   * a deployment change rather than a code change. `architecture.md` §6.
   */
  // The rule lives in the service layer so it can be tested directly — this
  // function ends in `redirect()`, which throws by design.
  redirect(
    signUpDestination({
      needsEmailConfirmation: result.data.needsEmailConfirmation,
      email: parsed.data.email,
    }),
  );
}

export type ResendState = { sent?: boolean; error?: string };

const resendSchema = z.object({ email: z.email('Enter a valid email address.') });

/**
 * Resend a confirmation email.
 *
 * **Reports success for any well-formed address**, including one with no
 * account. `architecture.md` §6 — a differing response would tell an attacker
 * which addresses are registered, and an email address is not public in
 * longplayr even though a handle is.
 *
 * **A malformed address is the one thing it does report**, because that is a
 * property of the input rather than of the account database.
 */
export async function resendConfirmationEmail(
  _prevState: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const parsed = resendSchema.safeParse({ email: String(formData.get('email') ?? '') });
  if (!parsed.success) {
    return { error: 'Enter a valid email address.' };
  }

  await resendConfirmation(parsed.data.email);

  // Unconditional. The service layer deliberately reports nothing, so there is
  // nothing here to branch on — see its docstring before "improving" this.
  return { sent: true };
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const submitted = String(formData.get('email') ?? '');

  const parsed = parseSignIn(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), email: submitted };
  }

  const result = await signInWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message, email: submitted };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  await signOutCurrentUser();
  revalidatePath('/', 'layout');
  redirect('/');
}
