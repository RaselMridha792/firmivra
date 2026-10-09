'use client';

import { Button, Card, PageContainer } from '@firmivra/ui';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import { usePortal } from '../../layout';
import { ButtonLink } from './button-link';
import { taglineWords } from './tagline';

// The last field colours or fills the icon, as the mockup draws it.
type Tile = readonly [icon: Icons.LucideIcon, title: string, description: string, icon?: string];
const ACCENT = 'text-firm-accent';
// A solid glyph: filled shapes, inner lines in the circle's colour.
const SOLID = 'fill-current [&_*]:stroke-accent-soft';

const features: Tile[] = [
  [
    Icons.FileText,
    'Access Your Documents',
    'View and download your past tax returns and important documents.',
  ],
  [
    Icons.CloudUpload,
    'Upload Documents',
    'Securely send us your tax documents and other files.',
    ACCENT,
  ],
  [
    Icons.ClipboardList,
    'Complete Forms',
    'Fill out and submit your client intake forms and other required documents.',
  ],
  [
    Icons.MessageSquareText,
    'Communicate with Our Team',
    'Send messages, ask questions, and get updates — all in one place.',
    ACCENT,
  ],
  [
    Icons.ReceiptText,
    'View Receipts',
    'Access your invoices, receipts, and payment history.',
    ACCENT,
  ],
];
const panel =
  'text-center [&_h2]:font-display [&_h2]:text-3xl [&_h2]:font-bold [&_h2]:text-firm-primary';

/** The landing page (/{firm}) from docs/mockups/client-portal/Client portal landing page.png. */
export function LandingScreen() {
  const { branding, business, signUpOpen } = usePortal();
  const headline = (branding.header ?? 'Your Documents. Your Information. All in One Place.').split(
    /(?<=\.)\s+/,
  );
  const trust: Tile[] = [
    [
      Icons.ShieldHalf,
      'Your Information is Secure',
      'We use industry-standard security to protect your data.',
      SOLID,
    ],
    [
      Icons.LockKeyhole,
      'Confidential & Private',
      'Your information is never shared with third parties.',
      SOLID,
    ],
    [
      Icons.UsersRound,
      'For Clients Only',
      `This portal is exclusively for current and prospective clients of ${business.name}.`,
      'fill-current',
    ],
  ];
  const motto = taglineWords(branding.tagline);
  return (
    <div data-testid="portal-landing" className="text-firm-primary">
      <section className="relative overflow-hidden bg-canvas">
        <HeroArt />
        <PageContainer className="relative py-12 md:py-16">
          <p className="text-base font-bold tracking-motto text-firm-accent uppercase">
            Client Portal
          </p>
          <h1 className="my-4 font-display text-4xl leading-none font-bold md:text-6xl [&_span:last-child]:text-firm-accent">
            {headline.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>
          <p className="text-2xl">
            {branding.welcomeMessage ?? 'Secure. Convenient. Designed for You.'}
          </p>
          <p className="mt-6 max-w-xl text-lg">
            Our client portal gives you a safe and easy way to access your tax documents,
            communicate with our team, complete forms, and stay organized — anytime, anywhere.
          </p>
          {motto.length > 0 ? (
            <p
              data-testid="landing-motto"
              className="mt-8 flex flex-wrap gap-x-6 text-sm font-bold tracking-motto uppercase"
            >
              {motto.map((word, index) => (
                <span key={word} className="flex gap-6">
                  {index > 0 ? (
                    <span aria-hidden className="text-firm-accent">
                      |
                    </span>
                  ) : null}
                  {word}
                </span>
              ))}
            </p>
          ) : null}
        </PageContainer>
      </section>
      <PageContainer className="pb-8">
        <h2 className="mt-10 text-center font-display text-3xl font-bold">
          What You Can Do in the Client Portal
        </h2>
        <p className="mt-2 text-center text-lg">
          Our client portal is designed to make managing your tax and financial information simple
          and secure.
        </p>
        <Tiles items={features} />
        <section className="grid gap-4 md:grid-cols-2">
          <Card title="Sign In to Your Account" className={`bg-folder-surface! ${panel}`}>
            <p className="mx-auto mb-4 max-w-sm text-lg text-muted">
              Already have an account? Sign in to access your documents, messages, and more.
            </p>
            <ButtonLink href={`/${business.slug}/sign-in`} className="max-w-xs">
              Sign In
            </ButtonLink>
            <hr className="mx-auto mt-6 w-1/2 border-folder-border" />
            <Link
              href={`/${business.slug}/forgot-password`}
              className="mt-3 block text-base hover:underline"
            >
              Forgot your password?
            </Link>
          </Card>
          <Card title="Create a New Account" className={panel}>
            <p className="mx-auto mb-4 max-w-sm text-lg text-muted">
              New to our client portal? Create an account to get started. It only takes a few
              minutes.
            </p>
            {signUpOpen ? (
              <ButtonLink variant="outline" href={`/${business.slug}/sign-up`} className="max-w-xs">
                Create an Account
              </ButtonLink>
            ) : (
              <Button variant="outline" disabled className="w-full max-w-xs">
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
    ? 'size-16 shrink-0 rounded-full bg-accent-soft p-4 text-firm-accent'
    : 'mx-auto mb-3 size-20 rounded-full bg-folder-surface p-5';
  return (
    <section
      className={`my-6 grid gap-6 ${secure ? 'rounded-card bg-folder-surface p-6 md:grid-cols-3 md:divide-x md:divide-firm-accent [&_h3]:font-sans [&_h3]:text-sm' : 'sm:grid-cols-2 md:grid-cols-5'}`}
    >
      {items.map(([Icon, title, description, icon = secure ? '' : 'text-firm-primary']) => (
        <article key={title} className={secure ? 'flex gap-3 md:pr-6' : 'text-center'}>
          <Icon aria-hidden className={`${iconClass} ${icon}`} />
          <div>
            <h3 className="font-display text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm text-muted">{description}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

/** The hero's soft waves, the thin accent arc and the dot grid from the mockup. */
function HeroArt() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 520"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <path d="M0 330 C 220 300 360 420 560 520 L 0 520 Z" className="fill-folder-surface" />
      <path
        d="M720 520 C 860 430 980 380 1200 360 L 1200 520 Z"
        className="fill-folder-surface opacity-70"
      />
      <path
        d="M980 520 C 1040 420 1110 330 1200 290"
        className="fill-none stroke-firm-accent"
        strokeWidth="2"
      />
      <path d="M0 400 C 60 430 110 470 150 520" className="fill-none stroke-firm-accent" />
      <defs>
        <pattern id="hero-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="2.5" className="fill-folder-border" />
        </pattern>
      </defs>
      <rect x="1060" y="40" width="144" height="120" fill="url(#hero-dots)" />
    </svg>
  );
}
