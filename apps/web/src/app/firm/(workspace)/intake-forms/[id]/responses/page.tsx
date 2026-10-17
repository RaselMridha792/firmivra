import type { Metadata } from 'next';
import { DetailFrame } from '../_components/detail-frame';
import { ResponsesTab } from '../_components/tab-responses';

export const metadata: Metadata = { title: 'Intake form: Responses' };

export default function IntakeFormsIdResponsesPage() {
  return (
    <DetailFrame tab="responses">
      <ResponsesTab />
    </DetailFrame>
  );
}
