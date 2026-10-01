import { notFound } from 'next/navigation';

import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getAdminProfile, listAccounts } from '@/services/admin';
import { listOpenReports } from '@/services/reports';

import { AccountRow } from './AccountRow';
import { ReportRow } from './ReportRow';

/**
 * Moderation.
 *
 * **`notFound()` rather than a 403, for a signed-out visitor and a signed-in
 * non-admin alike.** A 403 confirms the route exists to exactly the people who
 * should not know that; a 404 tells them nothing they did not already have.
 *
 * **The queue leads, because it is the work.** Accounts are a list to browse;
 * open reports are things waiting for a decision, and a notice that has waited
 * longest is the one most overdue — so they are ordered oldest first, which is
 * the opposite of every other list in the product.
 */

export const metadata = { title: 'Moderation · longplayr' };

export default async function AdminPage() {
  const admin = await getAdminProfile();
  if (!admin) notFound();

  const [accounts, reports] = await Promise.all([listAccounts(), listOpenReports()]);

  return (
    <Container variant="content" className="py-8">
      <SectionHeader trailing={`${reports.length}`}>Open reports</SectionHeader>

      {reports.length === 0 ? (
        <p className="mb-10 max-w-prose text-sm leading-relaxed text-text-muted">
          Nothing waiting. Reports arrive here when somebody uses the report control on a review, a
          list or a profile.
        </p>
      ) : (
        <ul className="mb-10">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}

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
