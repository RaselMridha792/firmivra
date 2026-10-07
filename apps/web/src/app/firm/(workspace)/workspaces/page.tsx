import type { Metadata } from 'next';
import { Services } from '../../../../features/services';

export const metadata: Metadata = { title: 'Workspaces' };

export default function WorkspacesPage() {
  return <Services />;
}
