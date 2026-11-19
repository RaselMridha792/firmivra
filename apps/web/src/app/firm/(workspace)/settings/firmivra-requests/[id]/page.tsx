import type { Metadata } from 'next';
import { FirmivraRequestScreen } from '../_components/request-thread';

export const metadata: Metadata = { title: 'Request from Firmivra' };

export default async function FirmivraRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FirmivraRequestScreen id={id} />;
}
