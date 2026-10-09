import type { Metadata } from 'next';
import { InPersonKiosk } from '../../../../../../components/esign/in-person';

export const metadata: Metadata = { title: 'In-person signing' };

export default async function InPersonSigningPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <InPersonKiosk requestId={requestId} />;
}
