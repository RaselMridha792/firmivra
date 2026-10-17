import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { NotesTab } from '../_components/tab-notes';

export const metadata: Metadata = { title: 'Lead: Notes' };

export default function LeadsIdNotesPage() {
  return (
    <ProfileFrame tab="notes">
      <NotesTab />
    </ProfileFrame>
  );
}
