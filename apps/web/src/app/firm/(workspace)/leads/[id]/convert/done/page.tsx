import type { Metadata } from 'next';
import { ConvertLeadCompleteScreen } from './_components/convert-lead-complete-screen';

export const metadata: Metadata = { title: 'Convert lead: Complete' };

interface LeadsIdConvertDonePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ inviteSent?: string | string[] }>;
}

export default async function LeadsIdConvertDonePage({
  params,
  searchParams,
}: LeadsIdConvertDonePageProps) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const inviteSentParam = Array.isArray(search.inviteSent)
    ? search.inviteSent[0]
    : search.inviteSent;
  const inviteSent =
    inviteSentParam === 'true' ? true : inviteSentParam === 'false' ? false : undefined;

  return <ConvertLeadCompleteScreen leadId={id} inviteSent={inviteSent} />;
}
