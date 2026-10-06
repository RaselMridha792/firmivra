import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Activate your account' };

export default function ActivateYourAccountPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <PagePlaceholder
        title="Activate your account"
        ticket="F02"
        owner="Fahad"
        mockup="super-admin/Super login.png (same style)"
      />
    </main>
  );
}
