import type { Metadata } from 'next';
import { SignUpsScreen } from './_components/sign-ups-screen';

// Rendered per request so the portal's address comes from the running config, not from the build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Client sign-ups' };

export default function SignUpsPage() {
  // The tab, search, sort, filters, page and open request live in the address (the screen reads
  // them). The portal's address comes from config (PORTAL_BASE_URL), read on the server.
  return <SignUpsScreen portalBase={process.env['PORTAL_BASE_URL'] ?? ''} />;
}
