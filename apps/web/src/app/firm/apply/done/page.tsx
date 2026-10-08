import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@firmivra/ui';

export const metadata: Metadata = { title: 'Application received' };

export default function ApplicationSentPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center p-6">
      <Card className="w-full">
        <p className="text-sm font-medium text-link">Firmivra business account</p>
        <h1 className="mt-2 text-2xl font-semibold text-text">Application received</h1>
        <p className="mt-3 text-muted">
          Thank you for applying. Our team will review your information and email the next steps to
          the contact address you provided.
        </p>
        <p className="mt-2 text-sm text-muted">
          You can close this page or return to the welcome screen.
        </p>
        <Link
          href="/welcome"
          className="mt-6 inline-flex min-h-11 items-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Back to welcome
        </Link>
      </Card>
    </main>
  );
}
