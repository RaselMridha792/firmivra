'use client';

import type { ReactNode } from 'react';
import { usePortal } from '../layout';

/**
 * Signer pages (/{firm}/sign#t=...): no account and no portal menu, in the firm's branding, built
 * for phones first. The signing link's token stays in the URL fragment. Firm Sign (R13-web).
 */
export default function SigningLayout({ children }: { children: ReactNode }) {
  const { business } = usePortal();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="border-b border-border bg-folder-surface px-4 py-3">
        <p data-testid="signing-firm" className="text-lg font-bold text-firm-primary">
          {business.name}
        </p>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
