'use client';

import { Button, Card } from '@firmivra/ui';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePortal } from '../layout';

const features = [
  [Icons.FileText, 'Access Your Documents', 'Download tax returns and important documents.'],
  [Icons.CloudUpload, 'Upload Documents', 'Securely send tax documents and other files.'],
  [Icons.ListChecks, 'Complete Forms', 'Complete and submit your client intake forms.'],
  [Icons.MessageSquare, 'Communicate with Our Team', 'Send messages and get updates.'],
  [Icons.Receipt, 'View Receipts', 'Access invoices, receipts, and payment history.'],
] as const;
const trust = [
  [Icons.ShieldCheck, 'Your Information is Secure', 'Industry-standard security.'],
  [Icons.LockKeyhole, 'Confidential & Private', 'Never shared with third parties.'],
  [Icons.Users, 'For Clients Only', 'For current and prospective clients of our firm.'],
] as const;

export default function ClientPortalPage() {
  const { branding, business, signUpOpen } = usePortal();
  const router = useRouter();
  const headline = (branding.header ?? 'Your Documents. Your Information. All in One Place.').split(
    /(?<=\.)\s+/,
  );
  return (
    <div data-testid="portal-landing" className="mx-auto max-w-public px-6 py-8 text-firm-primary">
      <section className="relative overflow-hidden px-6 py-12 md:py-16 after:absolute after:bottom-0 after:right-0 after:h-64 after:w-1/3 after:rounded-tl-full after:border-l after:border-firm-accent after:bg-folder-surface [&>*]:relative [&>*]:z-10">
        <p className="text-sm font-bold tracking-eyebrow text-firm-accent uppercase">
          {branding.portalName}
        </p>
        <h1 className="my-4 font-display text-4xl font-bold md:text-6xl [&_span:last-child]:text-firm-accent">
          {headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="text-xl font-semibold">
          {branding.welcomeMessage ?? 'Secure. Convenient. Designed for You.'}
        </p>
        <p className="my-6 max-w-xl text-lg">
          Access your tax documents, communicate with our team, complete forms, and stay organized —
          anytime, anywhere.
        </p>
        <p className="text-sm font-bold tracking-eyebrow">PLAN · PREPARE · PROSPER</p>
      </section>
      <h2 className="mt-6 text-center font-display text-3xl font-bold">
        What You Can Do in the Client Portal
      </h2>
      <p className="mt-2 text-center">Manage your information simply and securely.</p>
      <Tiles items={features} />
      <section className="grid gap-4 md:grid-cols-2">
        {['sign-in', 'sign-up'].map((path) => (
          <Card
            key={path}
            className={`text-center [&_h2]:font-display [&_h2]:text-3xl [&_h2]:text-firm-primary ${path === 'sign-in' ? 'bg-folder-surface!' : ''}`}
            title={path === 'sign-in' ? 'Sign In to Your Account' : 'Create a New Account'}
          >
            <p className="mb-4">
              {path === 'sign-in'
                ? 'Already have an account? Access your documents, messages, and more.'
                : 'New to our client portal? Create an account in just a few minutes.'}
            </p>
            <Button
              variant={path === 'sign-in' ? 'primary' : 'outline'}
              disabled={path === 'sign-up' && !signUpOpen}
              className="w-full max-w-sm"
              onClick={() => router.push(`/${business.slug}/${path}`)}
            >
              {path === 'sign-in' ? 'Sign In' : 'Create an Account'}
              <Icons.ArrowRight aria-hidden className="size-5" />
            </Button>
            {path === 'sign-in' && (
              <Link
                href={`/${business.slug}/forgot-password`}
                className="mt-4 block text-sm underline"
              >
                Forgot your password?
              </Link>
            )}
            {path === 'sign-up' && !signUpOpen && (
              <p className="mt-4 text-sm text-muted">Registration is currently closed.</p>
            )}
          </Card>
        ))}
      </section>
      <Tiles items={trust} />
    </div>
  );
}

function Tiles({ items }: { items: typeof features | typeof trust }) {
  const secure = items === trust;
  const iconClass = secure
    ? 'size-12 shrink-0 rounded-full bg-accent-soft p-3 text-firm-accent'
    : 'mx-auto mb-3 size-20 rounded-full bg-folder-surface p-5 text-firm-accent';
  return (
    <section
      className={`my-6 grid gap-6 ${secure ? 'rounded-card bg-folder-surface p-6 md:grid-cols-3 [&_h3]:font-sans [&_h3]:text-sm' : 'sm:grid-cols-2 md:grid-cols-5'}`}
    >
      {items.map(([Icon, title, description]) => (
        <article key={title} className={secure ? 'flex gap-3' : 'text-center'}>
          <Icon aria-hidden className={iconClass} />
          <div>
            <h3 className="font-display text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm">{description}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
