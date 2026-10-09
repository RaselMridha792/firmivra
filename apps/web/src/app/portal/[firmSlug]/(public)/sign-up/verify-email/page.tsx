import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Verify your email' };

export default function VerifyYourEmailPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Verify your email"
        ticket="N02"
        owner="Nahid"
        mockup="client-portal/Verify email .png"
      />
    </PageContainer>
  );
}
