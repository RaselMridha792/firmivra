import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Forgot password"
        ticket="N03"
        owner="Nahid"
        mockup="client-portal sign-up style"
      />
    </PageContainer>
  );
}
