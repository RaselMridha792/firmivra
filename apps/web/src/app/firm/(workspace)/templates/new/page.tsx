import type { Metadata } from 'next';
import { TemplateEditorScreen } from '../_components/template-editor';

export const metadata: Metadata = { title: 'New template' };

type Props = { searchParams: Promise<{ kind?: string }> };

export default async function NewTemplatePage({ searchParams }: Props) {
  const { kind } = await searchParams;
  return <TemplateEditorScreen kindSlug={kind} />;
}
