import type { Metadata } from 'next';
import { TaskFormScreen } from '../_components/task-form';

export const metadata: Metadata = { title: 'New task' };

type Param = string | string[] | undefined;
type Props = {
  searchParams: Promise<{
    template?: Param;
    clientId?: Param;
    engagementId?: Param;
    period?: Param;
  }>;
};
const one = (v: Param) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

/**
 * `?template=` starts from a template. A service workspace's Create Task (SH4) adds `clientId`,
 * `engagementId` and `period`, so the form opens on that client, service and period.
 */
export default async function NewTaskPage({ searchParams }: Props) {
  const { template, clientId, engagementId, period } = await searchParams;
  return (
    <TaskFormScreen
      templateId={one(template)}
      prefill={{ clientId: one(clientId), engagementId: one(engagementId), period: one(period) }}
    />
  );
}
