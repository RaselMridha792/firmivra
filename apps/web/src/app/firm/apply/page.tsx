import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ApplicationForm } from './_components/application-form';
import { BrandLockup } from '../../../components/app-shell/brand-lockup';

export const metadata: Metadata = { title: 'Apply' };

export default function ApplyPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <BrandLockup subtitle="Firm application" />
          <Link
            href="/welcome"
            className="inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-sm font-medium text-muted hover:bg-surface hover:text-heading"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to welcome
          </Link>
        </div>
        <header className="mb-6 rounded-2xl bg-brand-900 px-6 py-7 text-white shadow-card sm:px-8">
          <p className="text-sm font-semibold text-brand-100">Firm onboarding · Application</p>
          <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
            Apply for a business account
          </h1>
          <p className="mt-2 max-w-2xl text-brand-100">
            Share your firm details, review them carefully, then send your application to our team.
          </p>
        </header>
        <ApplicationForm />
        <p className="mt-6 text-center text-xs text-muted">
          Your information is used to review your Firmivra application.
        </p>
      </div>
    </main>
  );
}
