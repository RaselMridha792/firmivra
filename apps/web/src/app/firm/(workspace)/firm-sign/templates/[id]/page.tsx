import { EsignTemplateId } from '@firmivra/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TemplateDetail } from './_components/template-detail';

export const metadata: Metadata = { title: 'Signing template' };

export default async function SigningTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!EsignTemplateId.safeParse(id).success) notFound();
  return <TemplateDetail id={id} />;
}
