'use client';

import type { IntakeFormKey } from '@firmivra/types';
import { Card, IconCircle, type PortalTint } from '@firmivra/ui';
import {
  ArrowRight,
  BriefcaseBusiness,
  Calculator,
  ChartColumn,
  ChartNoAxesColumn,
  ClipboardCheck,
  CloudUpload,
  CreditCard,
  FileText,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { FORMS } from './forms';

/** Each card's icon and circle colour, measured from Intake form tab.png (R61). */
const CARD_ICONS: Record<IntakeFormKey, { icon: LucideIcon; tint: PortalTint }> = {
  ANNUAL_TAX: { icon: UserRound, tint: 'blue' },
  QUARTERLY_TAX: { icon: BriefcaseBusiness, tint: 'peach' },
  TAX_PLANNING: { icon: ChartNoAxesColumn, tint: 'mint' },
  BOOKKEEPING: { icon: Calculator, tint: 'lavender' },
  PAYROLL: { icon: Users, tint: 'rose' },
  BUSINESS_DEVELOPMENT: { icon: Lightbulb, tint: 'blue' },
};

const primaryButton = 'min-h-9! px-2! py-1! text-xs! bg-firm-button! hover:bg-firm-button-hover!';

const nextSteps: { icon: LucideIcon; title: string; action: string; path: string }[] = [
  { icon: FileText, title: 'Complete Intake Form', action: 'Get Started', path: 'intake' },
  {
    icon: CloudUpload,
    title: 'Upload Requested Documents',
    action: 'Upload Now',
    path: 'documents',
  },
  { icon: ListChecks, title: 'Review Pending Items', action: 'View Items', path: 'notifications' },
  {
    icon: CreditCard,
    title: 'Pay Outstanding Invoice',
    action: 'Make a Payment',
    path: 'invoices',
  },
];

/**
 * "Select an Intake Form" (docs/mockups/client-portal/Intake form tab.png, N06): one card per
 * service. Each opens the form's frame; the form itself (autosave, submit, the signature) comes
 * with the portal intake API.
 */
export function IntakeCards() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  return (
    <div className="grid min-w-0 gap-4">
      <Card className="grid min-w-0 gap-4 bg-folder-surface!">
        <header className="flex flex-col gap-4 md:flex-row md:items-start">
          <IconCircle icon={FileText} tint="blue" size="lg" />
          <div className="flex-1">
            <h1 className="font-display text-4xl font-bold text-heading md:text-5xl">
              Select an Intake Form
            </h1>
            <p className="text-lg leading-relaxed text-text">
              Choose the intake form for the service you need. This helps us gather the information
              needed for providing accurate services and the best possible support.
            </p>
          </div>
        </header>
        <ul aria-label="Intake forms" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {FORMS.slice(0, 4).map((form) => (
            <IntakeFormOption key={form.path} form={form} slug={slug} />
          ))}
        </ul>
        <ul
          aria-label="More intake forms"
          className="grid gap-2 sm:grid-cols-2 xl:mx-auto xl:w-3/4 xl:grid-cols-3"
        >
          {FORMS.slice(4).map((form) => (
            <IntakeFormOption key={form.path} form={form} slug={slug} />
          ))}
          <li className="col-span-full flex min-w-0 flex-col items-center gap-2 rounded-card border border-folder-border bg-surface p-3 text-center shadow-card sm:col-span-1">
            <IconCircle icon={FileText} tint="slate" />
            <h2 className="flex-1 font-display text-base font-bold leading-tight text-heading">
              Other Tax Services Intake Form
            </h2>
            <span
              aria-disabled="true"
              className={`inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-control px-2 py-1 text-xs font-semibold text-on-action ${primaryButton}`}
            >
              Go to Intake Form <ArrowRight aria-hidden className="size-4" />
            </span>
          </li>
        </ul>
      </Card>
      <IntakeOverview slug={slug} />
    </div>
  );
}

function IntakeFormOption({ form, slug }: { form: (typeof FORMS)[number]; slug: string }) {
  const { icon, tint } = CARD_ICONS[form.key];
  return (
    <li className="col-span-full flex min-w-0 flex-col items-center gap-2 rounded-card border border-folder-border bg-surface p-3 text-center shadow-card sm:col-span-1">
      <IconCircle icon={icon} tint={tint} />
      <h2 className="flex-1 font-display text-base font-bold leading-tight text-heading">
        {form.title}
      </h2>
      <ButtonLink
        href={`/${slug}/intake/${form.path}`}
        aria-label={`Go to ${form.title}`}
        className={primaryButton}
      >
        Go to Intake Form
      </ButtonLink>
    </li>
  );
}

/** Static, display-only panels from the Intake tab mockup; they do not add page actions or data flow. */
function IntakeOverview({ slug }: { slug: string }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
      <Card className="min-w-0 p-4! 2xl:col-span-2">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardCheck aria-hidden className="size-6 text-action" />
          <h2 className="flex-1 font-display text-lg font-bold text-heading">Your Next Steps</h2>
          <Link
            className="inline-flex items-center text-sm text-firm-accent underline"
            href={`/${slug}/notifications`}
          >
            View All <ArrowRight aria-hidden className="inline size-4" />
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
          {nextSteps.map(({ icon: Icon, title, action, path }) => (
            <li
              key={title}
              className="flex min-w-0 flex-col items-center gap-2 rounded-card border border-border bg-surface p-2 text-center shadow-card"
            >
              <Icon aria-hidden className="size-6 text-firm-text" />
              <span className="flex-1 text-xs font-semibold leading-tight text-heading">
                {title}
              </span>
              <Link
                href={`/${slug}/${path}`}
                className="inline-flex items-center gap-1 text-xs text-firm-accent underline"
              >
                {action} <ArrowRight aria-hidden className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="min-w-0 p-4!">
        <div className="mb-3 flex items-center gap-2">
          <ChartColumn aria-hidden className="size-6 text-action" />
          <h2 className="flex-1 font-display text-lg font-bold text-heading">Service Progress</h2>
          <Link
            className="inline-flex items-center text-sm text-firm-accent underline"
            href={`/${slug}/services`}
          >
            View All <ArrowRight aria-hidden className="inline size-4" />
          </Link>
        </div>
        <div className="grid min-h-36 content-center justify-items-center gap-2 rounded-card bg-folder-surface px-4 py-5 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface text-firm-text">
            <ChartColumn aria-hidden className="size-6" />
          </span>
          <h3 className="font-semibold text-heading">No active services yet</h3>
          <p className="max-w-xs text-sm text-muted">
            Service milestones and updates will be ready once work gets underway.
          </p>
        </div>
      </Card>
      <Card className="min-w-0 p-4! xl:col-span-2 2xl:col-span-1">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard aria-hidden className="size-6 text-firm-text" />
          <h2 className="flex-1 font-display text-lg font-bold text-heading">Payments</h2>
          <Link
            className="inline-flex items-center text-sm text-firm-accent underline"
            href={`/${slug}/invoices`}
          >
            View All <ArrowRight aria-hidden className="inline size-4" />
          </Link>
        </div>
        <p className="grid min-h-24 place-items-center text-center text-sm text-muted">
          Invoice and payment details are managed in Receipts &amp; Invoices.
        </p>
        <Link
          href={`/${slug}/invoices`}
          className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-control bg-firm-button px-3 py-2 text-sm font-semibold text-on-firm-button hover:bg-firm-button-hover"
        >
          Make a Payment <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>
    </div>
  );
}
