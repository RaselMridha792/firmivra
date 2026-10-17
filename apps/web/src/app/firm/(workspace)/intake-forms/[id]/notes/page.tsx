import type { Metadata } from 'next';
import { DetailFrame } from '../_components/detail-frame';
import { NotesTab } from '../_components/tab-notes';

export const metadata: Metadata = { title: 'Intake form: Notes' };

export default function IntakeFormsIdNotesPage() {
  return (
    <DetailFrame tab="notes">
      <NotesTab />
    </DetailFrame>
  );
}
