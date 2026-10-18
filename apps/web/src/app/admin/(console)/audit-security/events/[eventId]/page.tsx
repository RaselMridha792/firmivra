import type { Metadata } from 'next';
import { EventDetail } from './_components/event-detail';

export const metadata: Metadata = { title: 'Security event' };

export default async function AdminAuditSecurityEventsEventIdPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  // Keyed, so Previous and Next Event open on the Overview tab.
  return <EventDetail key={eventId} eventId={eventId} />;
}
