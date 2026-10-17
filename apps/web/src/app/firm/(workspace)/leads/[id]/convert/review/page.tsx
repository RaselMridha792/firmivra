import type { Metadata } from 'next';
import { ConvertLeadReviewScreen } from './_components/convert-lead-review-screen';

export const metadata: Metadata = { title: 'Convert lead: Review & confirm' };

export default function LeadsIdConvertReviewPage() {
  return <ConvertLeadReviewScreen />;
}
