import type { Metadata } from 'next';
import { RuleBuilderScreen } from '../../_components/rule-builder';

export const metadata: Metadata = { title: 'Edit automation rule' };

type Props = { params: Promise<{ id: string }> };

export default async function EditAutomationPage({ params }: Props) {
  const { id } = await params;
  return <RuleBuilderScreen id={id} />;
}
