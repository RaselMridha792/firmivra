import { Card, PageContainer } from '@firmivra/ui';
import * as Icons from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import hero from './begin-hero.png';
import styles from './begin-online.module.css';

const services = [
  {
    slug: 'annual-tax',
    title: 'Tax Preparation',
    subtitle: 'Individual & Business Tax Returns',
    description: 'Complete your tax intake form to get started with your TAX_YEAR tax return.',
    button: 'Tax Intake Form',
    icon: Icons.FilePenLine,
  },
  {
    slug: 'bookkeeping',
    title: 'Business Bookkeeping',
    subtitle: 'Keep Your Business on Track',
    description: 'Complete the bookkeeping intake form so we can set up your customized solution.',
    button: 'Bookkeeping Intake Form',
    icon: Icons.Calculator,
  },
  {
    slug: 'payroll',
    title: 'Payroll Services',
    subtitle: 'Simple. Accurate. On Time.',
    description:
      'Complete the payroll intake form to get started with your payroll setup or support.',
    button: 'Payroll Intake Form',
    icon: Icons.UsersRound,
  },
  {
    slug: 'business-development',
    title: 'Business Development',
    subtitle: 'Plan. Grow. Succeed.',
    description:
      'Complete the business development intake form to tell us about your goals and how we can help.',
    button: 'Business Development Intake Form',
    icon: Icons.ChartNoAxesCombined,
  },
  {
    slug: 'quarterly-tax',
    title: 'File Business Quarterly Taxes',
    subtitle: 'Stay Compliant. Avoid Penalties.',
    description:
      'Complete the quarterly tax intake form for your business so we can prepare and file your quarterly taxes.',
    button: 'Quarterly Tax Intake Form',
    icon: Icons.CalendarDays,
  },
  {
    slug: 'tax-planning',
    title: 'Tax Planning',
    subtitle: 'Strategize Today for a Brighter Tomorrow.',
    description:
      'Tell us about your goals so we can create a personalized tax planning strategy for you or your business.',
    button: 'Tax Planning Intake Form',
    icon: Icons.Lightbulb,
  },
] as const;

const steps = [
  {
    title: 'Business Information',
    icon: Icons.FileText,
    description:
      'Tell us about you or your business. This helps us understand your needs and get things started.',
  },
  {
    title: 'Additional Details',
    icon: Icons.UsersRound,
    description:
      'Answer a few more questions so we can make sure the service is the right fit for you and provide the best support possible.',
  },
  {
    title: 'Upload Documents',
    icon: Icons.CloudUpload,
    description:
      'Securely upload your required documents. (Examples will be provided in the intake form.)',
  },
  {
    title: 'Review & Submit',
    icon: Icons.CircleCheck,
    description:
      'Review your information, read and sign (if required), then submit your form securely.',
  },
] as const;

const trust = [
  { label: 'Secure & Encrypted', icon: Icons.Shield },
  { label: 'Quick & Easy', icon: Icons.Clock3 },
  { label: 'Trusted Professionals', icon: Icons.UserRound },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-2 text-xs font-semibold tracking-eyebrow text-accent uppercase">
      <span aria-hidden="true" className="h-px w-7 bg-accent" />
      {children}
      <span aria-hidden="true" className="h-px w-7 bg-accent" />
    </p>
  );
}

function AppointmentLink({ firmSlug }: { firmSlug: string }) {
  return (
    <Link
      href={`/${firmSlug}/appointments`}
      className={`inline-flex min-h-11 items-center justify-center gap-3 rounded-control px-4 py-2 text-sm font-semibold text-on-action transition-colors hover:bg-action-hover ${styles.action}`}
    >
      <Icons.CalendarDays aria-hidden="true" className="size-6 shrink-0" />
      Schedule an Appointment
      <Icons.ArrowRight aria-hidden="true" className="size-5 shrink-0" />
    </Link>
  );
}

export function BeginOnlineScreen({ firmSlug, taxYear }: { firmSlug: string; taxYear: number }) {
  return (
    <div data-theme="begin-online" className="bg-surface text-firm-primary">
      <section
        aria-labelledby="begin-heading"
        className="relative isolate flex flex-col overflow-hidden bg-subtle"
      >
        <div className="relative order-last aspect-3/2 w-full md:absolute md:inset-y-0 md:right-0 md:order-0 md:aspect-auto md:w-1/2">
          <Image
            src={hero}
            alt="A laptop with the steps: Fill Out Intake Form, Upload Documents, Submit Securely."
            fill
            sizes="(min-width: 768px) 512px, 100vw"
            preload
            className="object-cover object-right"
          />
          <div className={`absolute inset-0 hidden md:block ${styles.photoFade}`} />
        </div>
        <PageContainer className="relative">
          <div className="max-w-xl py-5">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-eyebrow text-accent uppercase">
              <span aria-hidden="true" className="h-px w-7 bg-accent" /> Secure. Simple. Convenient.
            </p>
            <h1
              id="begin-heading"
              className="mb-2 font-display text-5xl leading-none font-bold tracking-tight sm:text-6xl"
            >
              Begin <span className="text-accent">Online</span>
            </h1>
            <p className="mb-2 max-w-md font-display text-xl leading-tight font-bold">
              Complete your intake form and securely submit your documents — all online.
            </p>
            <p className="max-w-lg text-sm leading-snug">
              Our secure online platform makes it easy to provide your information and upload the
              documents needed for your tax, bookkeeping, payroll or business services. Your
              information is encrypted and kept confidential, giving you a safe and convenient way
              to get started.
            </p>
            <div className="mt-3 inline-flex max-w-full flex-col items-center gap-1">
              <AppointmentLink firmSlug={firmSlug} />
              <p className="text-xs">Let&apos;s find a time that works for you.</p>
            </div>
          </div>
        </PageContainer>
      </section>

      <section id="services" aria-labelledby="services-heading" className="pt-3 pb-2">
        <PageContainer>
          <div className="mb-2 text-center">
            <Eyebrow>Get Started Online</Eyebrow>
            <h2
              id="services-heading"
              className="font-display text-3xl leading-tight font-bold sm:text-4xl"
            >
              Choose Your <span className="text-accent">Service</span>
            </h2>
            <p className="text-sm">
              Select a service below to complete the appropriate intake form and securely submit
              your information.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {services.map(({ slug, title, subtitle, description, button, icon: Icon }, index) => (
              <Card
                key={slug}
                data-testid={`service-${slug}`}
                className={`flex min-w-0 flex-col items-center rounded-lg border-accent/15! p-2! text-center shadow-none! ${styles.service}`}
              >
                <div
                  aria-hidden="true"
                  className="mb-1 flex size-16 items-center justify-center rounded-full border border-accent/15 bg-accent-soft"
                >
                  <Icon className="size-11" strokeWidth={2} />
                </div>
                <h3 className="font-display text-xl leading-tight font-bold tracking-tight">
                  {title}
                </h3>
                <p className="text-sm leading-tight">{subtitle}</p>
                <p className="mb-2 text-sm leading-tight">
                  {description.replace('TAX_YEAR', String(taxYear))}
                </p>
                <Link
                  href={`/${firmSlug}/begin/${slug}`}
                  data-testid={`intake-${slug}`}
                  className={`mt-auto flex min-h-11 w-full items-center justify-center gap-2 rounded-control px-2 py-2 text-sm font-semibold text-on-action transition-colors ${index % 2 ? styles.darkAction : styles.action}`}
                >
                  {button}
                  <Icons.ArrowRight aria-hidden="true" className="size-5 shrink-0" />
                </Link>
              </Card>
            ))}
          </div>
        </PageContainer>
      </section>

      <section aria-labelledby="steps-heading" className="pt-1 pb-3">
        <PageContainer>
          <div className="mb-3 text-center">
            <Eyebrow>It&apos;s Easy</Eyebrow>
            <h2
              id="steps-heading"
              className="font-display text-3xl leading-tight font-bold sm:text-4xl"
            >
              4 Simple Steps
            </h2>
            <p className="text-sm">
              Complete your intake form, upload your documents, and we&apos;ll take it from there.
            </p>
          </div>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {steps.map(({ title, description, icon: Icon }, index) => (
              <li key={title} className="relative text-center">
                <div className="relative mx-auto mb-1 flex w-full max-w-40 justify-center">
                  <span
                    className={`absolute top-0 left-0 flex size-9 items-center justify-center rounded-full text-xl font-bold text-on-action ${styles.action}`}
                  >
                    <span className="sr-only">Step </span>
                    {index + 1}
                  </span>
                  <div
                    aria-hidden="true"
                    className="mt-2 flex size-18 items-center justify-center rounded-full border border-accent/15 bg-accent-soft"
                  >
                    <Icon className="size-11" strokeWidth={2} />
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <Icons.ArrowRight
                    aria-hidden="true"
                    className="absolute top-8 -right-7 hidden size-6 text-accent lg:block"
                  />
                )}
                <h3 className="font-display text-xl leading-tight font-bold tracking-tight">
                  {title}
                </h3>
                <p className="mx-auto mt-1 max-w-48 text-sm leading-snug">{description}</p>
              </li>
            ))}
          </ol>
          <div
            className={`mt-4 flex flex-col items-center justify-center gap-3 rounded-control border border-accent/15 px-5 py-2 text-center text-sm text-text sm:flex-row ${styles.service}`}
          >
            <Icons.LockKeyhole aria-hidden="true" className="size-9 shrink-0" />
            <p>
              These are the usual steps for all intake forms. The specific questions and documents
              may vary based on the service you select.
              <br />
              Your information is <strong>encrypted</strong> and secure. We take your{' '}
              <strong>privacy seriously.</strong>
            </p>
          </div>
        </PageContainer>
      </section>

      <section
        aria-labelledby="ready-heading"
        className="relative isolate overflow-hidden bg-navigation py-3 text-on-action"
      >
        <div
          aria-hidden="true"
          className="absolute -top-6 -left-8 -z-10 h-48 w-12 rotate-35 bg-accent/35"
        />
        <div
          aria-hidden="true"
          className="absolute -right-8 -bottom-6 -z-10 h-48 w-12 rotate-35 bg-accent/35"
        />
        <PageContainer className="grid items-center gap-5 text-center lg:grid-cols-4 lg:gap-6">
          <p className="font-display text-2xl leading-relaxed italic lg:border-r lg:border-on-action/40 lg:pr-5">
            Same Goals
            <br />
            <span className="underline decoration-accent decoration-2 underline-offset-8">
              Bigger Possibilities!
            </span>
          </p>
          <div className="lg:col-span-2">
            <h2 id="ready-heading" className="font-display text-2xl font-bold">
              Ready to Get Started?
            </h2>
            <p className="mt-1 mb-2 text-sm">
              Choose a service above or schedule an appointment today.
            </p>
            <AppointmentLink firmSlug={firmSlug} />
          </div>
          <ul className="flex justify-center gap-5 text-xs lg:border-l lg:border-on-action/40 lg:pl-5">
            {trust.map(({ label, icon: Icon }) => (
              <li key={label} className="flex flex-1 flex-col items-center gap-1">
                <Icon aria-hidden="true" className="size-7 text-accent" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </PageContainer>
      </section>
    </div>
  );
}
