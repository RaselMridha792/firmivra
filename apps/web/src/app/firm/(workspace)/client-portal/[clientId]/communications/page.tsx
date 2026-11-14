import type { Metadata } from 'next';
import { ModuleLinkTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Communications' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <ModuleLinkTab
      label="Messages"
      href={`/clients/${clientId}/messages`}
      text="This client's conversations with the firm are in their Messages."
    />
  );
}
