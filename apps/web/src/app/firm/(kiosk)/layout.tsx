'use client';

import type { ReactNode } from 'react';
import { SignedIn } from '../../../components/signed-in';

/**
 * In-person signing on a firm device (/firm-sign/in-person/...): a signed-in staff member hands the
 * screen to the signer, so there is no sidebar or menu. Firm Sign (R13-web).
 */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="firm" signInPath="/sign-in">
      <main className="min-h-screen bg-canvas p-6 text-text">{children}</main>
    </SignedIn>
  );
}
