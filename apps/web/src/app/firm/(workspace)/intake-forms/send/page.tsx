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
    engagementId?: string | string[];
  }>;
}) {
  // `?leadId=` (Leads R2 3): opened from a lead's profile, that lead is the recipient.
  // `?clientId=` (the Client Portal module's Request Form): that client is.
  // `&engagementId=` (Tax Returns Review 2, TX-F11): the return's service, kept for its form.
  const { formId, leadId, clientId, engagementId } = await searchParams;
  return (
    <SendIntakeScreen
      initialFormId={typeof formId === 'string' ? formId : ''}
      initialLeadId={typeof leadId === 'string' && UUID.test(leadId) ? leadId : ''}
      initialClientId={typeof clientId === 'string' && UUID.test(clientId) ? clientId : ''}
      initialEngagementId={
        typeof engagementId === 'string' && UUID.test(engagementId) ? engagementId : ''
      }
    />
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
