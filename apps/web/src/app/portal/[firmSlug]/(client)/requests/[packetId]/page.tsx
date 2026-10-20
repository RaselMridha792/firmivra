import type { Metadata } from 'next';
import { PacketScreen } from './_components/packet-screen';

export const metadata: Metadata = { title: 'Document Request & Upload' };

export default function DocumentRequestPage() {
  return <PacketScreen />;
}
