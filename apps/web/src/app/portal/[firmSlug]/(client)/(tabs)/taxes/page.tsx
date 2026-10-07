import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Tax Returns' };

export default function TaxReturnsPage() {
  return (
    <PagePlaceholder
      title="Tax Returns"
      ticket="N06"
      owner="Nahid"
      mockup="client-portal/Taxes tab.png"
    />
  );
}
