import { EsignRequestId } from '@firmivra/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrepareWizard } from './_components/prepare-wizard';
import { STEP_IDS, type StepId } from './_components/steps';

export const metadata: Metadata = { title: 'Prepare request' };

export default async function PrepareRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  if (!EsignRequestId.safeParse(id).success) notFound();
  const { step } = await searchParams;
  const current = STEP_IDS.find((s) => s === step) ?? 'documents';
  return <PrepareWizard id={id} step={current satisfies StepId} />;
}
