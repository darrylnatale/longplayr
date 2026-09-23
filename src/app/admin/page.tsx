import { notFound } from 'next/navigation';

import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getAdminProfile, listAccounts } from '@/services/admin';

import { AccountRow } from './AccountRow';

/**
 * Moderation.
 *
 * **`notFound()` rather than a 403, for a signed-out visitor and a signed-in
 * non-admin alike.** A 403 confirms the route exists to exactly the people who
 * should not know that; a 404 tells them nothing they did not already have.
 *
 * **Accounts only, in this slice.** Removing and restoring a review or a list
 * is built in the service and has no surface yet — it wants the reports queue
 * to hang off, which is slice 3 (`development-plan.md` Phase 6).
 */

export const metadata = { title: 'Moderation · longplayr' };

export default async function AdminPage() {
  const admin = await getAdminProfile();
  if (!admin) notFound();

  const accounts = await listAccounts();

  return (
    <Container variant="content" className="py-8">
      <SectionHeader trailing={`${accounts.length}`}>Accounts</SectionHeader>

      <p className="mb-6 max-w-prose text-sm leading-relaxed text-text-muted">
        Suspending an account hides everything it has published — ratings stop counting towards
        album averages, reviews leave album pages, likes stop counting, and its lists and profile
        stop resolving. It is reversible, and nothing is deleted.
      </p>

      <ul>
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </ul>
    </Container>
  );
}
