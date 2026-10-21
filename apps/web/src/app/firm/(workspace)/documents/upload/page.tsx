import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UploadDocumentScreen } from './_components/upload-document-screen';

export const metadata: Metadata = { title: 'Upload Document' };

export default function UploadDocumentPage() {
  return (
    <Suspense>
      <UploadDocumentScreen />
    </Suspense>
  );
}
