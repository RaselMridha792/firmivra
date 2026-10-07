import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <PagePlaceholder
      title="Forgot password"
      ticket="N03"
      owner="Nahid"
      mockup="client-portal sign-up style"
    />
  );
}
