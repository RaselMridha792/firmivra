import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Quarterly tax' };

export default function QuarterlyTaxPage() {
  return (
    <PagePlaceholder
      title="Quarterly tax"
      ticket="N07b"
      owner="Ibrahim"
      mockup="begin-online/business Information.png, Taxes & Income.png, Business Expenses.png, Review & Submit.png"
    />
  );
}
