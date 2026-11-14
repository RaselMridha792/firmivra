import type { Metadata } from 'next';
import { LeadTaskForm } from '../_components/lead-task-form';
import { TaskFormScreen } from '../_components/task-form';

export const metadata: Metadata = { title: 'New task' };

type Param = string | string[] | undefined;
type Props = {
  searchParams: Promise<{
    template?: Param;
    clientId?: Param;
    engagementId?: Param;
    period?: Param;
    leadId?: Param;
  }>;
};
const one = (v: Param) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

/**
 * `?template=` starts from a template. A service workspace's Create Task (SH4) adds `clientId`,
 * `engagementId` and `period`, so the form opens on that client, service and period. A lead's
 * Add Task (Leads R2 2) adds `leadId`: the task is that lead's, with a way back to it.
 */
export default async function NewTaskPage({ searchParams }: Props) {
  const { template, clientId, engagementId, period, leadId } = await searchParams;
  const lead = one(leadId);
  if (lead) return <LeadTaskForm leadId={lead} />;
  return (
    <TaskFormScreen
      templateId={one(template)}
      prefill={{ clientId: one(clientId), engagementId: one(engagementId), period: one(period) }}
    />
  );
}
