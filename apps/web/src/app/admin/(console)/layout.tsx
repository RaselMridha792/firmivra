import type { ReactNode } from 'react';
import { SignedIn } from '../../../components/signed-in';
import { ConsoleShell } from './_components/console-shell';

/** Every signed-in Super Admin page: the sign-in check and the console's sidebar and header. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="admin" signInPath="/sign-in">
      <ConsoleShell>{children}</ConsoleShell>
    </SignedIn>
  );
}
