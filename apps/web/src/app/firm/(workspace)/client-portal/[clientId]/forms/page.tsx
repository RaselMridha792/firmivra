import type { Metadata } from 'next';
import { PortalForms } from '../../_components/forms-tab';

export const metadata: Metadata = { title: 'Forms & Requests' };

/** The client's intake forms (intake-form-client-portal.jpg). */
export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <PortalForms clientId={clientId} />;
}
