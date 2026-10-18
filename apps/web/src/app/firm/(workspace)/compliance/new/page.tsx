import type { Metadata } from 'next';
import { DeadlineFormScreen } from '../_components/deadline-form';

export const metadata: Metadata = { title: 'New deadline' };

export default function NewDeadlinePage() {
  return <DeadlineFormScreen />;
}
