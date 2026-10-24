import type { Metadata } from 'next';
import { SecurityDefaultsScreen } from './_components/security-defaults-screen';

export const metadata: Metadata = { title: 'New account security' };

export default function SecurityDefaultsPage() {
  return <SecurityDefaultsScreen />;
}
