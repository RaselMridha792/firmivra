import type { Metadata } from 'next';
import { DetailFrame } from '../_components/detail-frame';
import { CommunicationTab } from '../_components/tab-communication';

export const metadata: Metadata = { title: 'Intake form: Communication' };

export default function IntakeFormsIdCommunicationPage() {
  return (
    <DetailFrame tab="communication">
      <CommunicationTab />
    </DetailFrame>
  );
}
