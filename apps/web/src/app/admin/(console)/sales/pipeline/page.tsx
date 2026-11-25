import type { Metadata } from 'next';
import { PipelineScreen } from './_components/pipeline-screen';

export const metadata: Metadata = { title: 'Sales pipeline' };

export default async function AdminSalesPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const stageId = (await searchParams)['stageId'];
  return <PipelineScreen initialStageId={typeof stageId === 'string' ? stageId : ''} />;
}
