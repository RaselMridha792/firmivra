import type { Metadata } from 'next';
import { TemplatesScreen } from './_components/templates-screen';

export const metadata: Metadata = { title: 'Form templates' };

export default function IntakeFormsTemplatesPage() {
  return <TemplatesScreen />;
}
