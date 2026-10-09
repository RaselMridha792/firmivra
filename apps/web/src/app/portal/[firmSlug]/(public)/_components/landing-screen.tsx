'use client';

import { Button, Card, PageContainer, PageSection } from '@firmivra/ui';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import { usePortal } from '../../layout';
import { ButtonLink } from './button-link';

type Tile = readonly [icon: Icons.LucideIcon, title: string, description: string];

const features: Tile[] = [
  [Icons.FileText, 'Access Your Documents', 'View and download your past tax returns.'],
  [Icons.CloudUpload, 'Upload Documents', 'Securely send us your tax documents and files.'],
  [Icons.ListChecks, 'Complete Forms', 'Fill out and submit your client intake forms.'],
  [Icons.MessageSquare, 'Communicate with Our Team', 'Send messages and get updates.'],
  [Icons.Receipt, 'View Receipts', 'Access your invoices, receipts, and payment history.'],
];
const panel = 'text-center [&_h2]:font-display [&_h2]:text-3xl [&_h2]:text-firm-primary';

/** The landing page (/{firm}) from docs/mockups/client-portal/Client portal landing page.png. */
export function LandingScreen() {
  const { branding, business, signUpOpen } = usePortal();
  const headline = (branding.header ?? 'Your Documents. Your Information. All in One Place.').split(
    /(?<=\.)\s+/,
  );
  const trust: Tile[] = [
    [Icons.ShieldCheck, 'Your Information is Secure', 'We use industry-standard security.'],
    [Icons.LockKeyhole, 'Confidential & Private', 'Never shared with third parties.'],
    [Icons.Users, 'For Clients Only', `For current and prospective clients of ${business.name}.`],
  ];
  return (
    <div data-testid="portal-landing" className="text-firm-primary">
      <PageSection className="relative overflow-hidden bg-linear-to-br from-surface to-folder-surface py-12 md:py-16 lg:after:absolute lg:after:right-0 lg:after:bottom-0 lg:after:h-64 lg:after:w-1/3 lg:after:rounded-tl-full lg:after:border-l lg:after:border-firm-accent lg:after:bg-folder-surface *:relative *:z-10">
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
        <p className="mt-6 max-w-xl text-lg">
          Our client portal gives you a safe and easy way to access your tax documents, communicate
          with our team, complete forms, and stay organized — anytime, anywhere.
        </p>
      </PageSection>
      <PageContainer className="pb-8">
        <h2 className="mt-10 text-center font-display text-3xl font-bold">
          What You Can Do in the Client Portal
        </h2>
        <p className="mt-2 text-center">Manage your information simply and securely.</p>
        <Tiles items={features} />
        <section className="grid gap-4 md:grid-cols-2">
          <Card title="Sign In to Your Account" className={`bg-folder-surface! ${panel}`}>
            <p className="mb-4">Already have an account? Sign in to access your documents.</p>
            <ButtonLink href={`/${business.slug}/sign-in`} className="max-w-sm">
              Sign In
            </ButtonLink>
            <Link
              href={`/${business.slug}/forgot-password`}
              className="mt-4 block text-sm underline"
            >
              Forgot your password?
            </Link>
          </Card>
          <Card title="Create a New Account" className={panel}>
            <p className="mb-4">
              New to our client portal? Create an account in just a few minutes.
            </p>
            {signUpOpen ? (
              <ButtonLink variant="outline" href={`/${business.slug}/sign-up`} className="max-w-sm">
                Create an Account
              </ButtonLink>
            ) : (
              <Button variant="outline" disabled className="w-full max-w-sm">
                Registration is currently closed
              </Button>
            )}
          </Card>
        </section>
        <Tiles items={trust} secure />
      </PageContainer>
    </div>
  );
}

function Tiles({ items, secure = false }: { items: Tile[]; secure?: boolean }) {
  const iconClass = secure
    ? 'size-12 shrink-0 rounded-full bg-accent-soft p-3 text-firm-accent'
    : 'mx-auto mb-3 size-20 rounded-full bg-folder-surface p-5 text-firm-primary';
  return (
    <section
      className={`my-6 grid gap-6 ${secure ? 'rounded-card bg-folder-surface p-6 md:grid-cols-3 md:divide-x md:divide-firm-accent [&_h3]:font-sans [&_h3]:text-sm' : 'sm:grid-cols-2 md:grid-cols-5'}`}
    >
      {items.map(([Icon, title, description]) => (
        <article key={title} className={secure ? 'flex gap-3 md:pr-6' : 'text-center'}>
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
