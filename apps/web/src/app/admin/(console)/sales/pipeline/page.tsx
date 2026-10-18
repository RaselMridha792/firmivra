import type { Metadata } from 'next';
import { PipelineScreen } from './_components/pipeline-screen';

export const metadata: Metadata = { title: 'Sales pipeline' };

export default function AdminSalesPipelinePage() {
  return <PipelineScreen />;
}
