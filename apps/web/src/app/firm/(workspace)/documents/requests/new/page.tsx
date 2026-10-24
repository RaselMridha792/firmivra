import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CreateRequestScreen } from './_components/create-request-screen';

export const metadata: Metadata = { title: 'Create Document Request' };

export default function CreateDocumentRequestPage() {
  return (
    <Suspense>
      <CreateRequestScreen />
    </Suspense>
  );
}
