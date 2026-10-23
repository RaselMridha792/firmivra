import type { Metadata } from 'next';
import { TemplateFormScreen } from '../../../_components/template-form';

export const metadata: Metadata = { title: 'Edit task template' };

type Props = { params: Promise<{ id: string }> };

export default async function EditTaskTemplatePage({ params }: Props) {
  const { id } = await params;
  return <TemplateFormScreen id={id} />;
}
