import type { Metadata } from 'next';
import { PhaseNotice } from '@/components/app/phase-notice';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return (
    <>
      <header>
        <p className="cg-eyebrow">Contractors Guild</p>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Reports</h1>
      </header>

      <PhaseNotice
        phase={6}
        title="Reports"
        description="Reporting (revenue, outstanding, overdue, quote conversion rate, payments per customer, and date filters) is scheduled for Phase 6. The dashboard already shows live totals from real queries."
        planned={['Revenue and payment reports', 'Outstanding, paid and overdue invoice reports', 'Quote acceptance and conversion rate', 'Today, this week, this month, last month, this year and custom ranges', 'Revenue per customer']}
        relatedSettings={[{ href: '/app', label: 'Dashboard' }]}
      />
    </>
  );
}
