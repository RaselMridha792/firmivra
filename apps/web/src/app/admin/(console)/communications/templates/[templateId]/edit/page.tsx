import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreateTemplateScreen } from '../../new/_components/create-template-screen';

export const metadata: Metadata = { title: 'Edit template' };

export default async function AdminCommunicationsTemplatesTemplateIdEditPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;

  return (
    <Suspense
      fallback={
        <div data-testid="edit-template-loading" className="flex flex-col gap-4">
          <div className="h-8 w-48 animate-pulse rounded-control bg-border" />
          <div className="h-4 w-80 animate-pulse rounded-control bg-border" />
          <div className="h-96 animate-pulse rounded-card border border-border bg-surface" />
        </div>
      }
    >
      <CreateTemplateScreen key={templateId} mode="edit" templateId={templateId} />
    </Suspense>
  );
}
