import type { Metadata } from 'next';
import { CreditNotes } from './_components/credit-notes';

export const metadata: Metadata = { title: 'Credit notes' };

/**
 * Credit Notes (firmivra-credit-notes-dashboard.jpg, docx §13): details are a drawer. `?note=`
 * opens a credit note's drawer and `?saved=` names what Create Credit Note just did.
 */
export default async function AdminBillingCreditNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string | string[]; saved?: string | string[] }>;
}) {
  const { note, saved } = await searchParams;
  return (
    <CreditNotes
      openId={typeof note === 'string' && note ? note : null}
      saved={typeof saved === 'string' ? saved : null}
    />
  );
}
