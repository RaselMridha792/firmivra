import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Calculator' };

export default function CalculatorPage() {
  return <PagePlaceholder title="Calculator" ticket="N10" owner="Nahid" />;
}
