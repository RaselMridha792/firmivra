import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Tax planning' };

export default function TaxPlanningPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Tax planning"
        ticket="N07b"
        owner="Arfan"
        mockup="begin-online/Tax planning*.png (4 files)"
      />
    </PageContainer>
  );
}
