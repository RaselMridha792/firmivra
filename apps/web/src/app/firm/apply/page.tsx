import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Apply' };

export default function ApplyPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <PagePlaceholder title="Apply" ticket="N04" owner="Tumit" />
    </main>
  );
}
