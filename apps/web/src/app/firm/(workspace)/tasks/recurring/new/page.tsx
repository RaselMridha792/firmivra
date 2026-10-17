import type { Metadata } from 'next';
import { RecurringFormScreen } from '../../_components/recurring-form';

export const metadata: Metadata = { title: 'Set up recurring task' };

export default function NewRecurringTaskPage() {
  return <RecurringFormScreen />;
}
