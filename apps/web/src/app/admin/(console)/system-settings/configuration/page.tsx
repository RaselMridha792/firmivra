import type { Metadata } from 'next';
import { SystemConfiguration } from './_components/system-configuration';

export const metadata: Metadata = { title: 'System configuration & maintenance' };

export default function SystemConfigurationPage() {
  // The deployment's addresses (display only): the firm workspace, and the API it calls.
  const appUrl = new URL('/', process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000').href;
  return <SystemConfiguration appUrl={appUrl} apiUrl={new URL('/api/v1', appUrl).href} />;
}
