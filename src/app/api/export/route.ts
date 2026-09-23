import { buildUserExport, exportFilename } from '@/services/export';

/**
 * Your data, as a file.
 *
 * **A route handler rather than a server action**, because this produces a
 * download: an action returns a value to React, and there is no way to hand
 * that to the browser as a file without building a blob client-side and
 * inventing a second copy of the data.
 *
 * **401 rather than a redirect.** Nothing renders here — a redirect would send
 * a `fetch` somewhere it cannot use, and this URL is only ever reached from a
 * link on `/settings` by someone already signed in.
 *
 * **`no-store`, and it matters more than it looks.** This response is
 * per-user and contains everything the user has written; a shared cache holding
 * it would be the most consequential caching mistake available in this product.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await buildUserExport();

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const filename = exportFilename(result.data.profile.handle);

  return new Response(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, private',
    },
  });
}
