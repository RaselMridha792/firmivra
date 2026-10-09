import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Business development' };

export default function BusinessDevelopmentPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Business development"
        ticket="N07b"
        owner="Arfan"
        mockup="begin-online/Development intake*.png (4 files)"
      />
    </PageContainer>
  );
}
