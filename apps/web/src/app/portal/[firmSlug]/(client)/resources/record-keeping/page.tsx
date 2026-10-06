import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Record Keeping Best Practices' };

export default function RecordKeepingBestPracticesPage() {
  return (
    <PagePlaceholder
      title="Record Keeping Best Practices"
      ticket="N10"
      owner="Nahid"
      mockup="client-portal/Record Keeping Best Practices Dashboard.png"
    />
  );
}
