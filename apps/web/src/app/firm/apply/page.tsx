import type { Metadata } from 'next';
import { ApplicationForm } from './_components/application-form';

export const metadata: Metadata = { title: 'Business application' };

export default function ApplyPage() {
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-link">Firmivra business account</p>
        <h1 className="mt-2 text-3xl font-semibold text-text">Apply for a business account</h1>
        <p className="mt-2 text-muted">
          Share your firm details. You can review everything before sending.
        </p>
      </header>
      <ApplicationForm />
    </main>
  );
}
