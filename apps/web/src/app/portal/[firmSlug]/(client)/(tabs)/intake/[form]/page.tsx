import type { Metadata } from 'next';
import { IntakeFrame } from '../_components/intake-frame';

export const metadata: Metadata = { title: 'Intake Form' };

export default function IntakeFormFramePage() {
  return <IntakeFrame />;
}
