import type { Metadata } from 'next';
import { TemplatesScreen } from '../_components/templates-screen';

export const metadata: Metadata = { title: 'Automation templates' };

export default function AutomationTemplatesPage() {
  return <TemplatesScreen />;
}
