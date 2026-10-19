import type { Metadata } from 'next';
import { GeneralSettingsScreen } from './_components/general-settings-screen';

export const metadata: Metadata = { title: 'General settings' };

export default function AdminSystemSettingsGeneralPage() {
  return <GeneralSettingsScreen platformUrl={process.env['APP_BASE_URL'] ?? ''} />;
}
