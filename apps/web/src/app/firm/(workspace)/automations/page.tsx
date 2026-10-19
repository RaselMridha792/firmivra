import type { Metadata } from 'next';
import { AutomationsScreen } from './_components/automations-screen';

export const metadata: Metadata = { title: 'Automations' };

export default function AutomationsPage() {
  return <AutomationsScreen />;
}
