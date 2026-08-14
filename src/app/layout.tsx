import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';

import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

import { signOut } from './(auth)/actions';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'longplayr',
  description: 'Keep a record of the albums you listen to.',
};

async function Nav() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  return (
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          longplayr
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              {profile ? (
                <Link href={`/${profile.handle}`} className="text-muted hover:text-foreground">
                  {profile.handle}
                </Link>
              ) : (
                <Link href="/onboarding" className="text-muted hover:text-foreground">
                  Finish setting up
                </Link>
              )}
              <form action={signOut}>
                <button type="submit" className="text-muted hover:text-foreground">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-foreground">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md border border-border px-3 py-1.5 hover:border-muted"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Nav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
