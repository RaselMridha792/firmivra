import type { Metadata } from 'next';
import { QuarterlyScreen } from '../_components/quarterly-screen';

export const metadata: Metadata = { title: 'Quarterly Estimated Tax Calculator' };

export default function QuarterlyEstimatePage() {
  return <QuarterlyScreen />;
}
