import type { Metadata } from 'next';
import { PayrollScreen } from './_components/payroll-screen';

export const metadata: Metadata = { title: 'Payroll' };

export default function PayrollPage() {
  return <PayrollScreen />;
}
