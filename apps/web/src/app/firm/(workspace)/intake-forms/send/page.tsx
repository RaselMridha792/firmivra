import type { Metadata } from 'next';
import { SendIntakeScreen } from './_components/send-intake-screen';

export const metadata: Metadata = { title: 'Send intake form' };

export default async function IntakeFormsSendPage({
  searchParams,
}: {
  searchParams: Promise<{ formId?: string | string[] }>;
}) {
  const { formId } = await searchParams;
  return <SendIntakeScreen initialFormId={typeof formId === 'string' ? formId : ''} />;
}
