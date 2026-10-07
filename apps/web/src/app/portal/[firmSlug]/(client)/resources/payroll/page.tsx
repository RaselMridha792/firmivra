import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Payroll Resources' };

export default function PayrollResourcesPage() {
  return (
    <PagePlaceholder
      title="Payroll Resources"
      ticket="N10"
      owner="Nahid"
      mockup="client-portal/payroll_resources_dashboard.png"
    />
  );
}
