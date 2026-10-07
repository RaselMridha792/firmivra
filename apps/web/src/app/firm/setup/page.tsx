import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Set up your firm' };

export default function SetUpYourFirmPage() {
  return <PagePlaceholder title="Set up your firm" ticket="F05" owner="Tumit" />;
}
