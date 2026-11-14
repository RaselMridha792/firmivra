import type { Metadata } from 'next';
import { ModuleLinkTab } from '../../_components/manage/tabs';

export const metadata: Metadata = { title: 'Forms & Requests' };

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return (
    <ModuleLinkTab
      label="Intake Forms"
      href={`/clients/${clientId}/intake-forms`}
      text="This client's intake forms and their submissions are in their Intake Forms."
    />
  );
}
