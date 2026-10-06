import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Tax Deductions for Small Businesses' };

export default function TaxDeductionsForSmallBusinessesPage() {
  return (
    <PagePlaceholder
      title="Tax Deductions for Small Businesses"
      ticket="N10"
      owner="Nahid"
      mockup="client-portal/LVP_Tax_Deductions_Small_Businesses.png"
    />
  );
}
