import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Welcome' };

export default function WelcomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <PagePlaceholder title="Welcome" ticket="N04" owner="Tumit" />
    </main>
  );
}
