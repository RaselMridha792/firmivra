import type { Metadata } from 'next';
import { ActivityTab } from '../_components/activity-tab';

export const metadata: Metadata = { title: 'Staff security: Activity & audit' };

export default async function TeamIdSecurityActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ActivityTab id={id} />;
}
