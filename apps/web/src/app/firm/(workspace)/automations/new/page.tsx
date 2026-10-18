import type { Metadata } from 'next';
import { RuleBuilderScreen } from '../_components/rule-builder';

export const metadata: Metadata = { title: 'New automation rule' };

export default function NewAutomationPage() {
  return <RuleBuilderScreen />;
}
