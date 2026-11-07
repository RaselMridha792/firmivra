import type { Metadata } from 'next';
import { DemoRunScreen } from '../../_components/demo-run';

export const metadata: Metadata = { title: 'Payroll run (demo)' };

/** PY-B02: the five Run Payroll steps on a synthetic run; nothing is saved or sent. */
export default function PayrollDemoRunPage() {
  return <DemoRunScreen />;
}
