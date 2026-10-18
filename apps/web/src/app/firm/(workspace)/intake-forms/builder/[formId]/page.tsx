import type { Metadata } from 'next';
import { BuilderScreen } from '../_components/builder-screen';

export const metadata: Metadata = { title: 'Create intake form' };

export default async function IntakeFormsBuilderFormidPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  return <BuilderScreen formId={formId} />;
}
