import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreateTemplateScreen } from './_components/create-template-screen';

export const metadata: Metadata = { title: 'Create template' };

export default function AdminCommunicationsTemplatesNewPage() {
  return (
    <Suspense
      fallback={
        <div data-testid="create-template-loading" className="flex flex-col gap-4">
          <div className="h-8 w-48 animate-pulse rounded-control bg-border" />
          <div className="h-4 w-80 animate-pulse rounded-control bg-border" />
          <div className="h-96 animate-pulse rounded-card border border-border bg-surface" />
        </div>
      }
    >
      <CreateTemplateScreen />
    </Suspense>
  );
}
