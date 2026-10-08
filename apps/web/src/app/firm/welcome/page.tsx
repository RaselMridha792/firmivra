import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, LogIn, UserRoundCheck } from 'lucide-react';
import { Card } from '@firmivra/ui';
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
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-center gap-8">
        <header className="rounded-2xl bg-brand-900 px-6 py-7 text-white shadow-card sm:px-10 sm:py-9">
          <BrandLockup subtitle="Firm workspace" />
          <div className="mt-8 max-w-2xl">
            <p className="text-sm font-semibold text-brand-100">Firm onboarding</p>
            <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              Your firm, ready for what&apos;s next
            </h1>
            <p className="mt-3 text-brand-100">Choose how you want to continue with Firmivra.</p>
          </div>
        </header>
        <section aria-label="Choose an account action" className="grid gap-5 md:grid-cols-3">
          {options.map((option) => (
            <Card
              key={option.title}
              className="flex min-h-64 flex-col items-start gap-5 border-t-4 border-t-action p-6 shadow-sm transition-shadow hover:shadow-card sm:p-7"
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
                <h2 className="font-serif text-xl font-bold text-heading">{option.title}</h2>
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
      </div>
    </main>
  );
}
