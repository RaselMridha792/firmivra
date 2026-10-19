import type { Metadata } from 'next';
import { ReportBuilder } from '../_components/report-builder';

export const metadata: Metadata = { title: 'Custom Report Builder' };

export default function ReportBuilderPage() {
  return <ReportBuilder />;
}
