import type { Metadata } from 'next';
import { DetailFrame } from '../_components/detail-frame';
import { DocumentsTab } from '../_components/tab-documents';

export const metadata: Metadata = { title: 'Intake form: Documents' };

export default function IntakeFormsIdDocumentsPage() {
  return (
    <DetailFrame tab="documents">
      <DocumentsTab />
    </DetailFrame>
  );
}
