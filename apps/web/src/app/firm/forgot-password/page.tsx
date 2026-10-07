import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <PagePlaceholder
        title="Forgot password"
        ticket="F02"
        owner="Fahad"
        mockup="super-admin/Super login.png (same style)"
      />
    </main>
  );
}
