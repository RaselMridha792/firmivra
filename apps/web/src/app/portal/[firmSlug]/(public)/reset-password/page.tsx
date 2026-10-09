import { PageContainer } from '@firmivra/ui';
import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return (
    <PageContainer className="py-8">
      <PagePlaceholder
        title="Reset password"
        ticket="N03"
        owner="Nahid"
        mockup="client-portal sign-up style"
      />
    </PageContainer>
  );
}
