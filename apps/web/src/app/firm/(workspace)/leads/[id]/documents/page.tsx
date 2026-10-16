import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { DocumentsTab } from '../_components/tab-documents';

export const metadata: Metadata = { title: 'Lead: Documents & forms' };

export default function LeadsIdDocumentsPage() {
  return (
    <ProfileFrame tab="documents">
      <DocumentsTab />
    </ProfileFrame>
  );
}
