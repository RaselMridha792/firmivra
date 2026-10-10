import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '@firmivra/ui';
import { ApplicationForm } from './_components/application-form';
import { BrandLockup } from '../../../components/app-shell/brand-lockup';

export const metadata: Metadata = { title: 'Apply' };

export default function ApplyPage() {
  return (
    <main className="min-h-screen bg-canvas py-6 sm:py-10">
      <PageContainer>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <BrandLockup subtitle="Firm application" />
          <Link
            href="/welcome"
            className="inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-base font-medium text-link hover:underline"
          >
            <ArrowLeft aria-hidden className="size-5" /> Back to Welcome
          </Link>
        </div>
        <header className="mb-6">
          <h1
            data-testid="page-title"
            className="font-display text-4xl font-bold tracking-tight text-heading md:text-5xl"
          >
            Apply for a Business Account
          </h1>
          <p className="mt-1 text-lg text-muted">
            Share your firm details, review them carefully, then send your application to our team.
          </p>
        </header>
        <ApplicationForm />
        <p className="mt-6 text-center text-xs text-muted">
          Your information is used to review your Firmivra application.
        </p>
      </PageContainer>
    </main>
  );
}
