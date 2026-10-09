import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Account created' };

export default function AccountCreatedPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Account created"
        ticket="N02"
        owner="Nahid"
        mockup="client-portal/LVP Client Portal Account Confirmation.png"
      />
    </PageContainer>
  );
}
