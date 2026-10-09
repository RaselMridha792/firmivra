'use client';

import { Card, PageContainer, Stepper } from '@firmivra/ui';
import { LockKeyhole, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePortal } from '../../../layout';
import { SIGN_UP_STEPS, type SignUpStepId } from './shared';

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
}: {
  step: SignUpStepId;
  /** The heading's first words; `highlight` ends it in the firm's accent colour. */
  heading: string;
  highlight: string;
  intro: string;
  benefits: readonly Benefit[];
  children: ReactNode;
}) {
  const { branding } = usePortal();
  return (
    <PageContainer className="grid gap-8 py-8 lg:grid-cols-5 lg:py-12">
      <section className="lg:col-span-2 lg:pt-16" aria-label={branding.portalName}>
        <p className="text-sm font-bold tracking-eyebrow text-firm-primary uppercase">
          Client portal
        </p>
        <p className="mt-4 font-display text-4xl font-bold text-heading md:text-5xl">
          {heading} <span className="text-firm-accent">{highlight}</span>
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
        <div className="mb-8 flex justify-center">
          <Stepper steps={SIGN_UP_STEPS} current={step} label="Sign-up progress" />
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-text">
          <LockKeyhole aria-hidden className="size-5 shrink-0 text-firm-primary" />
          Your information is encrypted and secure.
        </p>
      </Card>
    </PageContainer>
  );
}

/** The step card's title and subtitle. */
export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-bold text-heading md:text-4xl">{title}</h1>
      {children ? <p className="mt-2 text-lg text-muted">{children}</p> : null}
    </header>
  );
}
