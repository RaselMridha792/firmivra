import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Thank you' };

export default function ThankYouPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Thank you"
        ticket="N07c"
        owner="Arfan"
        mockup="begin-online/Success Tax Prep.png, Success Page for all services except taxes.png"
      />
    </PageContainer>
  );
}
