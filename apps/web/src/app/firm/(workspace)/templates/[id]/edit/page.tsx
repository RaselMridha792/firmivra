import type { Metadata } from 'next';
import { TemplateEditorScreen } from '../../_components/template-editor';

export const metadata: Metadata = { title: 'Edit template' };

type Props = { params: Promise<{ id: string }> };

export default async function EditTemplatePage({ params }: Props) {
  const { id } = await params;
  return <TemplateEditorScreen id={id} />;
}
