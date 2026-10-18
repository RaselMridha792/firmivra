import type { Metadata } from 'next';
import { TicketDetailScreen } from './_components/ticket-detail';

export const metadata: Metadata = { title: 'Support ticket' };

export default async function AdminSupportTicketsTicketIdPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return <TicketDetailScreen ticketId={ticketId} />;
}
