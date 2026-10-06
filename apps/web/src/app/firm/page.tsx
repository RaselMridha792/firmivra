import type { Metadata } from 'next';
import { WorkspaceProvider } from '../../components/workspace-context';
import { WorkspaceShell } from '../../components/workspace-shell';
import { Dashboard } from '../../features/dashboard';
import { FirmLanding } from '../../features/landing';

export const metadata: Metadata = { title: 'Firmivra workspace' };

export default function FirmHome() {
  return (
    <WorkspaceProvider site="firm" signedOut={<FirmLanding />}>
      <WorkspaceShell>
        <Dashboard routeHome />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
