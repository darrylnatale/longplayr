'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { signInWithPassword, signOutCurrentUser, signUpWithPassword } from '@/services/auth';
import { MIN_PASSWORD_LENGTH } from '@/services/auth/password-policy';
import { signUpDestination } from '@/services/auth/signup-destination';

export type AuthFormState = {
  error?: string;
  fieldErrors?: { email?: string; password?: string; confirmPassword?: string };
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
const signUpSchema = z
  .object({
    email: z.email('Enter a valid email address.'),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    // Reported against the field the reader must change, not against the first
    // one they typed.
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

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
  const parsed = parseSignUp(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const result = await signUpWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message };
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

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = parseSignIn(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const result = await signInWithPassword(parsed.data);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  await signOutCurrentUser();
  revalidatePath('/', 'layout');
  redirect('/');
}
