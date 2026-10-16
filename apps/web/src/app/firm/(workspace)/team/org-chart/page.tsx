import type { Metadata } from 'next';
import { OrgChartScreen } from './_components/org-chart-screen';

export const metadata: Metadata = { title: 'Teams & departments: Org chart' };

export default function TeamOrgChartPage() {
  return <OrgChartScreen />;
}
