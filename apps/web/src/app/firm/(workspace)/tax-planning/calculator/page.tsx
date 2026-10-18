import type { Metadata } from 'next';
import { SavingsCalculator } from '../_components/calculator-screen';

export const metadata: Metadata = { title: 'Tax Savings Calculator' };

export default function CalculatorPage() {
  return <SavingsCalculator />;
}
