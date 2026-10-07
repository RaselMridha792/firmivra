import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Application sent' };

export default function ApplicationSentPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <PagePlaceholder title="Application sent" ticket="N04" owner="Tumit" />
    </main>
  );
}
