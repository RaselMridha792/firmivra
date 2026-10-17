import type { Metadata } from 'next';
import { WorkflowScreen } from './_components/workflow-screen';

export const metadata: Metadata = { title: 'Workflow & automations' };

export default function SettingsWorkflowPage() {
  return <WorkflowScreen />;
}
