import type { Metadata } from 'next';
import { CalculatorsHub } from './_components/calculators-hub';

export const metadata: Metadata = { title: 'Calculator' };

export default function CalculatorPage() {
  return <CalculatorsHub />;
}
