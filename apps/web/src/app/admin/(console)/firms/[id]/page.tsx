import type { Metadata } from 'next';
import { FirmDetail } from '../_components/firm-detail';

export const metadata: Metadata = { title: 'Firm' };

export default async function Firm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-side config (CLAUDE.md: site URLs come from config, never from code).
  const appBaseUrl = new URL('/', process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000').href;
  return <FirmDetail id={id} appBaseUrl={appBaseUrl} />;
}
