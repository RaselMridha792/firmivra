import type { Metadata } from 'next';
import { PreviewScreen } from '../../_components/preview-screen';

export const metadata: Metadata = { title: 'Create intake form: Preview' };

export default async function IntakeFormsBuilderFormidPreviewPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  return <PreviewScreen formId={formId} />;
}
