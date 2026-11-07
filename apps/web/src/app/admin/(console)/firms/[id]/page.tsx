import type { Metadata } from 'next';
import { FirmDetail } from '../_components/firm-detail';

export const metadata: Metadata = { title: 'Firm' };

export default async function Firm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FirmDetail id={id} />;
}
