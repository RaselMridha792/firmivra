import type { Metadata } from 'next';
import { TemplateFormScreen } from '../../_components/template-form';

export const metadata: Metadata = { title: 'New task template' };

export default function NewTaskTemplatePage() {
  return <TemplateFormScreen />;
}
