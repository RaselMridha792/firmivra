import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@firmivra/ui';

export const metadata: Metadata = { title: 'Welcome to Firmivra' };

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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 p-6 sm:p-10">
      <header className="max-w-2xl">
        <p className="text-sm font-medium text-link">Firmivra</p>
        <h1 className="mt-2 text-3xl font-semibold text-text">
          Your firm, ready for what&apos;s next
        </h1>
        <p className="mt-3 text-muted">Choose how you want to continue.</p>
      </header>
      <section aria-label="Choose an account action" className="grid gap-4 md:grid-cols-3">
        {options.map((option) => (
          <Card key={option.title} className="flex flex-col items-start gap-4">
            <div>
              <h2 className="text-lg font-semibold text-text">{option.title}</h2>
              <p className="mt-2 text-sm text-muted">{option.body}</p>
            </div>
            <Link
              href={option.href}
              className="mt-auto inline-flex min-h-11 items-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {option.action}
            </Link>
          </Card>
        ))}
      </section>
    </main>
  );
}
