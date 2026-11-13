import type { Metadata } from 'next';
import { SendIntakeScreen } from './_components/send-intake-screen';

export const metadata: Metadata = { title: 'Send intake form' };

export default async function IntakeFormsSendPage({
  searchParams,
}: {
  searchParams: Promise<{ formId?: string | string[]; leadId?: string | string[] }>;
}) {
  // `?leadId=` (Leads R2 3): opened from a lead's profile, that lead is the recipient.
  const { formId, leadId } = await searchParams;
  return (
    <SendIntakeScreen
      initialFormId={typeof formId === 'string' ? formId : ''}
      initialLeadId={typeof leadId === 'string' && UUID.test(leadId) ? leadId : ''}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
