import type { Metadata } from 'next';
import { AllPaymentsScreen } from '../_components/invoice-routes';

export const metadata: Metadata = { title: 'All Payments' };

export default function AllPaymentsPage() {
  return <AllPaymentsScreen />;
}
