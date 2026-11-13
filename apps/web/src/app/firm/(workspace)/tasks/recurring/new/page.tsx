import type { Metadata } from 'next';
import { RecurringFormScreen } from '../../_components/recurring-form';

export const metadata: Metadata = { title: 'Set up recurring task' };

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ clientId?: Param; engagementId?: Param }> };
const one = (v: Param) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

/** Create Task's Recurring switch (Review 2, Bookkeeping N05) carries the client and engagement. */
export default async function NewRecurringTaskPage({ searchParams }: Props) {
  const { clientId, engagementId } = await searchParams;
  return (
    <RecurringFormScreen prefill={{ clientId: one(clientId), engagementId: one(engagementId) }} />
  );
}
