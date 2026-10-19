import type { Metadata } from 'next';
import { DataScreen } from './_components/data-screen';

export const metadata: Metadata = { title: 'Data & backups' };

export default function SettingsDataPage() {
  return <DataScreen />;
}
