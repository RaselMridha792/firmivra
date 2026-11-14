import type { Metadata } from 'next';
import { ModuleLinkTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Portal Documents' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <ModuleLinkTab
      label="Documents"
      href={`/clients/${clientId}/documents`}
      text="This client's documents, uploads and requests are in their Documents."
    />
  );
}
