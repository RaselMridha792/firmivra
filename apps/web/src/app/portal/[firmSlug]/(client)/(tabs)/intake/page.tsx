import type { Metadata } from 'next';
import { IntakeCards } from './_components/intake-cards';

export const metadata: Metadata = { title: 'Intake Form' };

export default function IntakeFormPage() {
  return <IntakeCards />;
}
