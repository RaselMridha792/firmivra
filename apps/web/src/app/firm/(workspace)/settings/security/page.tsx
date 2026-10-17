import type { Metadata } from 'next';
import { SecurityScreen } from './_components/security-screen';

export const metadata: Metadata = { title: 'Security & access' };

export default function SettingsSecurityPage() {
  return <SecurityScreen />;
}
