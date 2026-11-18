import type { Metadata } from 'next';
import { EditSeriesScreen } from '../../../_components/recurring-form';

export const metadata: Metadata = { title: 'Edit recurring task' };

type Props = { params: Promise<{ id: string }> };

/** Tasks Review Two T-D16: Edit Series, for this and future occurrences. */
export default async function EditRecurringTaskPage({ params }: Props) {
  const { id } = await params;
  return <EditSeriesScreen id={id} />;
}
