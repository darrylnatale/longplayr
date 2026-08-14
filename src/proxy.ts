import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh.
 *
 * In Next.js 16 this file is `proxy.ts` — what earlier versions called
 * middleware. Same mechanism, new name.
 *
 * Its ONLY job is to refresh the auth token cookie so Server Components see a
 * valid session. It deliberately performs no authorisation: proxy runs on every
 * request including prefetches, and Next's own guidance is to keep it to
 * optimistic checks. Real authorisation lives in the service layer
 * (docs/architecture.md §4, §14).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not insert code between createServerClient and getUser(). Anything that
  // touches cookies in between can desynchronise the refreshed session and log
  // users out at random — a genuinely hard bug to trace.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Running session refresh
     * on asset requests would be pure overhead.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
