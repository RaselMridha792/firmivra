import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, PageContainer } from '@firmivra/ui';
import { BrandLockup } from '../../../../components/app-shell/brand-lockup';

export const metadata: Metadata = { title: 'Application sent' };

export default function ApplicationSentPage() {
  return (
    <main className="flex min-h-screen flex-col bg-canvas py-8">
      <PageContainer className="flex flex-1 flex-col">
        <BrandLockup subtitle="Firm application" />
        <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-8">
          <Card className="w-full p-7 text-center shadow-card sm:p-10">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckCircle2 aria-hidden className="size-9" />
            </span>
            <p className="mt-5 text-sm font-semibold text-success">Application submitted</p>
            <h1 className="mt-2 font-serif text-3xl font-bold text-heading">
              Application received
            </h1>
            <p className="mx-auto mt-4 max-w-lg leading-7 text-muted">
              Thank you for applying. Our team will review your information and email the next steps
              to the contact address you provided.
            </p>
            <Link
              href="/welcome"
              className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 py-2 text-sm font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Back to welcome
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Card>
        </div>
      </PageContainer>
    </main>
  );
}
