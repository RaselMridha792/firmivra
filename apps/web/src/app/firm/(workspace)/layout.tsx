'use client';
import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from '../../../components/workspace-context';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { SignedIn } from '../../../components/signed-in';
import { FirmContext } from '../../../components/firm-context';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="firm" signInPath="/sign-in">
      <WorkspaceProvider site="firm">
        <VerifiedFirm>{children}</VerifiedFirm>
      </WorkspaceProvider>
    </SignedIn>
  );
}
function VerifiedFirm({ children }: { children: ReactNode }) {
  const { business, role } = useWorkspace();
  if (!business || role === 'SUPER_ADMIN') return null;
  return (
    <FirmContext value={{ firm: business, role }}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </FirmContext>
  );
}
