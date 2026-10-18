import type { Metadata } from 'next';
import { DeadlineFormScreen } from '../../_components/deadline-form';

export const metadata: Metadata = { title: 'Edit deadline' };

type Props = { params: Promise<{ id: string }> };

export default async function EditDeadlinePage({ params }: Props) {
  const { id } = await params;
  return <DeadlineFormScreen id={id} />;
}
