import type { Metadata } from 'next';
import { GeneralSettings } from './_components/general-settings';

export const metadata: Metadata = { title: 'General settings' };

export default function GeneralSettingsPage() {
  // The address firms sign in at, from the deployment's configuration (display only).
  const appUrl = new URL('/', process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000').href;
  return <GeneralSettings appUrl={appUrl} />;
}
