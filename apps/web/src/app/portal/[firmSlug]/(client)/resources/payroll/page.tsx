import type { Metadata } from 'next';
import { PayrollResourcesScreen } from './_components/payroll-resources-screen';

export const metadata: Metadata = { title: 'Payroll Resources' };

export default function Page() {
  return <PayrollResourcesScreen />;
}
