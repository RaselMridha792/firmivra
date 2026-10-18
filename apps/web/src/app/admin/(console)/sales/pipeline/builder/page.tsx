import type { Metadata } from 'next';
import { PipelineBuilder } from './_components/pipeline-builder';

export const metadata: Metadata = { title: 'Build pipeline' };

export default function AdminSalesPipelineBuilderPage() {
  return <PipelineBuilder />;
}
