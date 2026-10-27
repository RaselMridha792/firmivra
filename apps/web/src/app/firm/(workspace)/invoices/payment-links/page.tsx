import type { Metadata } from 'next';
import { PaymentLinksScreen } from '../_components/invoice-routes';

export const metadata: Metadata = { title: 'Payment Link Generator' };

export default function PaymentLinksPage() {
  // The portal's address comes from config (PORTAL_BASE_URL), read on the server.
  return <PaymentLinksScreen portalBase={process.env['PORTAL_BASE_URL'] ?? ''} />;
}
