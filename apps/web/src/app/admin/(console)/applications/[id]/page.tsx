import type { Metadata } from 'next';
import { ApplicationDetail } from '../_components/application-detail';

export const metadata: Metadata = { title: 'Firm application' };

export default async function Application({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-side config (CLAUDE.md: site URLs come from config, never from code).
  const appBaseUrl = new URL('/', process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000').href;
  return <ApplicationDetail id={id} appBaseUrl={appBaseUrl} />;
}
