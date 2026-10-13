import type { Metadata } from 'next';
import { TaxDeductionsScreen } from './_components/tax-deductions-screen';

export const metadata: Metadata = { title: 'Tax Deductions for Small Businesses' };

export default function Page() {
  return <TaxDeductionsScreen />;
}
