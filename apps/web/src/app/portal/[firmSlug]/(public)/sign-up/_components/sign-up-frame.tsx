'use client';

import { Card, PageContainer, Stepper } from '@firmivra/ui';
import { LockKeyhole, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePortal } from '../../../layout';
import { SIGN_UP_STEPS, type SignUpStepId } from './shared';

const SIGN_UP_PROGRESS_CLASSES = [
  '[&_ol]:grid [&_ol]:w-full [&_ol]:grid-cols-4 [&_ol]:gap-0',
  '[&_li]:relative [&_li]:flex-col [&_li]:gap-2 [&_li]:text-center',
  '[&_li:not(:last-child)]:after:absolute [&_li:not(:last-child)]:after:top-5.5 [&_li:not(:last-child)]:after:left-1/2 [&_li:not(:last-child)]:after:-right-1/2 [&_li:not(:last-child)]:after:mx-7 [&_li:not(:last-child)]:after:h-px [&_li:not(:last-child)]:after:bg-folder-border',
  "[&_li:not(:last-child)]:after:content-['']",
  '[&_li>span:first-child]:size-11 [&_li>span:first-child]:shrink-0 [&_li>span:first-child]:bg-linear-to-b/srgb [&_li>span:first-child]:from-subtle [&_li>span:first-child]:to-disabled [&_li>span:first-child]:text-lg [&_li>span:first-child]:font-bold [&_li>span:first-child]:text-platform-navy',
  '[&_li>span:first-child.bg-action]:from-platform-blue [&_li>span:first-child.bg-action]:to-platform-blue-pressed [&_li>span:first-child.bg-action]:text-white',
  '[&_li>span:last-child]:font-normal [&_li>span:last-child]:text-platform-blue',
  '[&_li[aria-current=step]>span:last-child]:font-medium [&_li[aria-current=step]>span:last-child]:text-platform-navy',
].join(' ');

export type Benefit = readonly [icon: LucideIcon, title: string, description: string];

/**
 * The four sign-up pages (docs/mockups/client-portal/LVP Client Portal Sign-Up Page.png,
 * Verify email .png, Verify phone.png, LVP Client Portal Account Confirmation.png): the
 * introduction and benefits on the left, the stepper and the step's card on the right.
 */
export function SignUpFrame({
  step,
  heading,
  highlight,
  intro,
  benefits,
  children,
  signUpLook = false,
}: {
  /** The sign-up step; none on sign-in and the password pages. */
  step?: SignUpStepId;
  /** The heading's first words; `highlight` ends it in the page's highlight colour. */
  heading: string;
  highlight: string;
  intro: string;
  benefits: readonly Benefit[];
  children: ReactNode;
  /** The sign-up mockup's appearance, without changing the other portal screens. */
  signUpLook?: boolean;
}) {
  const { branding } = usePortal();
  const verificationLook = signUpLook && (step === 'email' || step === 'phone');
  const SecurityIcon = verificationLook ? ShieldCheck : LockKeyhole;
  return (
    <PageContainer className="grid gap-8 py-8 lg:grid-cols-5 lg:py-12">
      <section className="lg:col-span-2 lg:pt-16" aria-label={branding.portalName}>
        <p className="text-sm font-bold tracking-eyebrow text-firm-primary uppercase">
          Client portal
        </p>
        <p
          className={`mt-4 font-display text-4xl font-bold md:text-5xl ${verificationLook ? 'text-platform-navy' : 'text-heading'}`}
        >
          {heading}{' '}
          <span
            className={`${signUpLook ? 'text-platform-blue' : 'text-firm-accent'} ${verificationLook ? 'block' : ''}`}
          >
            {highlight}
          </span>
        </p>
        <p className="mt-4 text-text">{intro}</p>
        <ul className="mt-8 grid gap-6">
          {benefits.map(([Icon, title, description]) => (
            <li key={title} className="flex items-center gap-4">
              <Icon
                aria-hidden
                className="size-14 shrink-0 rounded-full bg-folder-surface p-3 text-firm-primary"
              />
              <div>
                <p className="font-bold text-heading">{title}</p>
                <p className="text-sm text-text">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Card className="lg:col-span-3 md:p-8">
        {step ? (
          <div className={`mb-8 flex justify-center ${signUpLook ? SIGN_UP_PROGRESS_CLASSES : ''}`}>
            <Stepper steps={SIGN_UP_STEPS} current={step} label="Sign-up progress" />
          </div>
        ) : null}
        {children}
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-text">
          <SecurityIcon
            aria-hidden
            className={`size-5 shrink-0 ${verificationLook ? 'fill-platform-blue text-white' : 'text-firm-primary'}`}
          />
          Your information is encrypted and secure.
        </p>
      </Card>
    </PageContainer>
  );
}

/** The step card's title and subtitle. */
export function StepHeading({
  title,
  level = 1,
  children,
}: {
  title: string;
  /** 2 where the page already has its h1. */
  level?: 1 | 2;
  children?: ReactNode;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <header className="mb-6">
      <Heading className="font-display text-3xl font-bold text-heading md:text-4xl">
        {title}
      </Heading>
      {children ? <p className="mt-2 text-lg text-muted">{children}</p> : null}
    </header>
  );
}
