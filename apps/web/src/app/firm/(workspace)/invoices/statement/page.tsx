import type { Metadata } from 'next';
import { ClientStatementScreen } from '../_components/invoice-routes';

export const metadata: Metadata = { title: 'Client Statement' };

export default function ClientStatementPage() {
  return <ClientStatementScreen />;
}
