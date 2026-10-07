import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Tax planning' };

export default function TaxPlanningPage() {
  return (
    <PagePlaceholder
      title="Tax planning"
      ticket="N07b"
      owner="Ibrahim"
      mockup="begin-online/Tax planning*.png (4 files)"
    />
  );
}
