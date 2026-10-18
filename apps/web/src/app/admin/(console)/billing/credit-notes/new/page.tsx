import type { Metadata } from 'next';
import { CreditNoteEditor } from '../_components/credit-note-form';

export const metadata: Metadata = { title: 'Create credit note' };

/** Create Credit Note (credit-note-creation-dashboard.jpg, docx §14). */
export default function AdminBillingCreditNotesNewPage() {
  return <CreditNoteEditor />;
}
