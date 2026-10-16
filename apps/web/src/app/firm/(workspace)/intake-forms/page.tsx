import type { Metadata } from 'next';
import { IntakeFormsScreen } from './_components/intake-forms-screen';

export const metadata: Metadata = { title: 'Intake Forms' };

export default function IntakeFormsPage() {
  return <IntakeFormsScreen />;
}
