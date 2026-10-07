import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Workspace' };

export default function WorkspacePage() {
  return <PagePlaceholder title="Workspace" ticket="F11" owner="Fahad" />;
}
