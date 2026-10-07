import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../../components/workspace-context';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { SignedIn } from '../../../components/signed-in';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="admin" signInPath="/sign-in">
      <WorkspaceProvider site="admin">
        <WorkspaceShell>{children}</WorkspaceShell>
      </WorkspaceProvider>
    </SignedIn>
  );
}
