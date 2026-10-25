import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DocumentSettingsScreen } from './_components/settings-screen';

export const metadata: Metadata = { title: 'Document Settings' };

export default function DocumentSettingsPage() {
  return (
    <Suspense>
      <DocumentSettingsScreen />
    </Suspense>
  );
}
