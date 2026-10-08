import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SigningFrame } from '../../../../components/esign/signing-frame';

// Not indexed: every signer page is reached through a private signing link.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Signer pages (/{firm}/sign#t=...): no account and no portal menu, in the firm's branding. The
 * signing link's token stays in the URL fragment. Firm Sign (R13-web).
 */
export default function SigningLayout({ children }: { children: ReactNode }) {
  return <SigningFrame>{children}</SigningFrame>;
}
