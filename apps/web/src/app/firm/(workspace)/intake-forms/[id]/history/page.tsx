import type { Metadata } from 'next';
import { DetailFrame } from '../_components/detail-frame';
import { HistoryTab } from '../_components/tab-history';

export const metadata: Metadata = { title: 'Intake form: History' };

export default function IntakeFormsIdHistoryPage() {
  return (
    <DetailFrame tab="history">
      <HistoryTab />
    </DetailFrame>
  );
}
