import type { Metadata } from 'next';
import { ActivityScreen } from './_components/activity-screen';

export const metadata: Metadata = { title: 'Activity & login history' };

export default function TeamActivityPage() {
  return <ActivityScreen />;
}
