import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, LogIn, UserRoundCheck } from 'lucide-react';
import { Card, PageContainer } from '@firmivra/ui';
import { BrandLockup } from '../../../components/app-shell/brand-lockup';

export const metadata: Metadata = { title: 'Welcome' };

const options = [
  {
    title: 'Welcome back',
    body: 'Sign in to continue to your firm workspace.',
    href: '/sign-in',
    action: 'Sign in',
  },
  {
    title: 'Create a business account',
    body: 'Apply to bring your firm and team to Firmivra.',
    href: '/apply',
    action: 'Start an application',
  },
  {
    title: 'First sign-in',
    body: 'Already approved? Activate the owner account from your invitation.',
    href: '/activate',
    action: 'Activate account',
  },
];

export default function WelcomePage() {
  return (
    <main className="flex min-h-screen flex-col justify-center bg-canvas py-8 sm:py-12">
      <PageContainer className="flex flex-col gap-8">
        <header>
          <BrandLockup subtitle="Firm workspace" />
          <h1 className="mt-10 font-display text-4xl font-bold tracking-tight text-heading md:text-5xl">
            Your firm, ready for what&apos;s next
          </h1>
          <p className="mt-1 text-lg text-muted">Choose how you want to continue with Firmivra.</p>
        </header>
        <section aria-label="Choose an account action" className="grid gap-5 md:grid-cols-3">
          {options.map((option) => (
            <Card
              key={option.title}
              variant="elevated"
              className="flex min-h-64 flex-col items-start gap-5 transition-shadow hover:shadow-lg sm:p-7"
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-info-soft text-action">
                {option.href === '/sign-in' ? (
                  <LogIn aria-hidden className="size-6" />
                ) : option.href === '/apply' ? (
                  <Building2 aria-hidden className="size-6" />
                ) : (
                  <UserRoundCheck aria-hidden className="size-6" />
                )}
              </span>
              <div>
                <h2 className="text-xl font-semibold text-brand-900">{option.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{option.body}</p>
              </div>
              <Link
                href={option.href}
                className="mt-auto inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {option.action}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Card>
          ))}
        </section>
      </PageContainer>
    </main>
  );
}
