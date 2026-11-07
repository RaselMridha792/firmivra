import type { Metadata } from 'next';
import { TaskFormScreen } from '../../_components/task-form';

export const metadata: Metadata = { title: 'Edit draft' };

type Props = { params: Promise<{ id: string }> };

/** A2: a draft reopened from the Drafts tab; Save Task publishes it. */
export default async function EditDraftPage({ params }: Props) {
  const { id } = await params;
  return <TaskFormScreen draftId={id} />;
}
