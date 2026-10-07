import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Workspaces' };

export default function WorkspacesPage() {
  return <PagePlaceholder title="Workspaces" ticket="F11" owner="Fahad" />;
}
