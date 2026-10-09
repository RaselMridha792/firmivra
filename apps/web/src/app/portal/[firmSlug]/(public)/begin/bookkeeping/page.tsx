import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Bookkeeping' };

export default function BookkeepingPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Bookkeeping"
        ticket="N07b"
        owner="Arfan"
        mockup="begin-online/Bookkeeping*.png (4 files)"
      />
    </PageContainer>
  );
}
