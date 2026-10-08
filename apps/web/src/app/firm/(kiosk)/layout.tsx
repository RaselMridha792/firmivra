import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { KioskFrame } from '../../../components/esign/kiosk-frame';

// Not indexed: every kiosk page is a signing session on a firm device.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * In-person signing on a firm device (/firm-sign/in-person/...): a signed-in staff member hands the
 * screen to the signer, so there is no sidebar or menu. Firm Sign (R13-web).
 */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <KioskFrame>{children}</KioskFrame>;
}
