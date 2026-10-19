import type { Metadata } from 'next';
import { ApiWebhooksPage } from './_components/api-webhooks-page';

export const metadata: Metadata = { title: 'API & webhooks' };

export default function AdminIntegrationsApiWebhooksPage() {
  return <ApiWebhooksPage />;
}
