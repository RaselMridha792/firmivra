import type { Metadata } from 'next';
import { LogicScreen } from '../../_components/logic-screen';

export const metadata: Metadata = { title: 'Create intake form: Logic & rules' };

export default async function IntakeFormsBuilderFormidLogicPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  return <LogicScreen formId={formId} />;
}
