'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { signInWithPassword, signOutCurrentUser, signUpWithPassword } from '@/services/auth';
import { MIN_PASSWORD_LENGTH } from '@/services/auth/password-policy';

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

  // A new account has no profile yet, so onboarding is the only sensible
  // destination. When email confirmation is on there is no session, and
  // /onboarding sends them back to sign in.
  redirect('/onboarding');
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
