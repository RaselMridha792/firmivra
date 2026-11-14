import type { Metadata } from 'next';
import { SendIntakeScreen } from './_components/send-intake-screen';

export const metadata: Metadata = { title: 'Send intake form' };

export default async function IntakeFormsSendPage({
  searchParams,
}: {
  searchParams: Promise<{
    formId?: string | string[];
    leadId?: string | string[];
    clientId?: string | string[];
  }>;
}) {
  // `?leadId=` (Leads R2 3): opened from a lead's profile, that lead is the recipient.
  // `?clientId=` (the Client Portal module's Request Form): that client is.
  const { formId, leadId, clientId } = await searchParams;
  return (
    <SendIntakeScreen
      initialFormId={typeof formId === 'string' ? formId : ''}
      initialLeadId={typeof leadId === 'string' && UUID.test(leadId) ? leadId : ''}
      initialClientId={typeof clientId === 'string' && UUID.test(clientId) ? clientId : ''}
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
