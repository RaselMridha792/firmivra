import type { ReactNode } from 'react';
import { SignedIn } from '../../../components/signed-in';

/** First-time setup (F05): signed in, the Firmivra logo, no sidebar. */
export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="firm" signInPath="/sign-in">
      <header className="border-b border-border bg-surface px-6 py-4">
        <p className="text-xl font-bold text-brand-900">Firmivra</p>
      </header>
      <main className="mx-auto w-full max-w-3xl p-6">{children}</main>
    </SignedIn>
  );
}
