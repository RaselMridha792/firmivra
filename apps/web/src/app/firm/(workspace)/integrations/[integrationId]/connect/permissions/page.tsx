import type { Metadata } from 'next';
import { ConnectScreen } from '../_components/connect-screen';

export const metadata: Metadata = { title: 'Connect integration: Permissions' };

export default async function Page({ params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  return <ConnectScreen providerKey={integrationId} step="permissions" />;
}
