'use client';

import type { ConvertLeadToClientRequest, LeadProfile } from '@firmivra/types';
import { Avatar, Badge, Button, Callout, Card, Stepper } from '@firmivra/ui';
import {
  AddressBook,
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  Check,
  FileText,
  FolderOpen,
  Info,
  LinkSimple,
  ListChecks,
  Note,
  Phone,
  Tag,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../../lib/query';

const STEPS = [
  { id: 'review', label: 'Review Lead Information' },
  { id: 'details', label: 'Client Details & Services' },
  { id: 'portal', label: 'Portal & Settings' },
  { id: 'confirm', label: 'Review & Confirm' },
  { id: 'complete', label: 'Complete' },
];
const MOBILE_STEPS = [
  { id: 'review', label: 'Lead' },
  { id: 'details', label: 'Details' },
  { id: 'portal', label: 'Portal' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'complete', label: 'Done' },
];

type CarryOverKey = keyof NonNullable<ConvertLeadToClientRequest['carryOver']>;

const CARRY_OVER_ITEMS: ReadonlyArray<{
  id: CarryOverKey;
  icon: Icon;
  tone: string;
  label: string;
}> = [
  {
    id: 'contactInfo',
    icon: AddressBook,
    tone: 'bg-info-soft text-info',
    label: 'Contact information (name, email, phone, address)',
  },
  { id: 'notes', icon: Note, tone: 'bg-warning-soft text-gold', label: 'Notes' },
  {
    id: 'communications',
    icon: Phone,
    tone: 'bg-folder-surface text-heading',
    label: 'Communication history (emails, SMS, calls)',
  },
  {
    id: 'appointments',
    icon: CalendarBlank,
    tone: 'bg-info-soft text-info',
    label: 'Appointments',
  },
  {
    id: 'tasks',
    icon: ListChecks,
    tone: 'bg-purple-soft text-purple',
    label: 'Tasks / follow-ups',
  },
  {
    id: 'documents',
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
    label: 'Uploaded documents',
  },
  {
    id: 'intakeForms',
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
    label: 'Submitted intake forms',
  },
  { id: 'tags', icon: Tag, tone: 'bg-warning-soft text-gold', label: 'Tags' },
  {
    id: 'attribution',
    icon: LinkSimple,
    tone: 'bg-success-soft text-success',
    label: 'Source / campaign attribution',
  },
];

function SectionHeading({
  icon: Glyph,
  title,
  subtitle,
}: {
  icon: Icon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex min-w-0 items-start gap-3 rounded-control bg-info-soft p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-action text-on-action">
        <Glyph aria-hidden weight="fill" className="size-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs leading-4 text-muted">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function SummaryField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={'min-w-0 border-b border-border pb-3 ' + className}>
      <dt className="mb-1 text-xs font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-text">{children}</dd>
    </div>
  );
}

function QueryMessage({
  query,
  onRetry,
}: {
  query: UseQueryResult<LeadProfile>;
  onRetry: () => void;
}) {
  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading lead details…
      </p>
    );
  }

  const code = errorCode(query.error);
  const message =
    code === 'FORBIDDEN'
      ? "You don't have permission to review this lead."
      : code === 'NOT_FOUND'
        ? 'No lead details are available to review.'
        : "Couldn't load lead information.";
  const canRetry = code !== 'FORBIDDEN' && code !== 'NOT_FOUND';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" role="status">
      <span>{message}</span>
      {canRetry ? (
        <button
          type="button"
          className="font-medium text-link underline-offset-2 hover:underline"
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

function SelectionMark({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={checked ? 'Selected: ' + label : 'Not selected: ' + label}
      className={
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ' +
        (checked ? 'border-action bg-action text-on-action' : 'border-control-border bg-surface')
      }
    >
      {checked ? <Check aria-hidden weight="bold" className="size-3" /> : null}
    </span>
  );
}

function LeadSummary({ lead }: { lead: LeadProfile }) {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  const staffName = lead.assignedTo?.name;

  return (
    <dl className="grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-2">
      <SummaryField label="Client Type">
        <Badge tone="info">Individual</Badge>
      </SummaryField>
      <SummaryField label="Full Name">{fullName || 'Not provided'}</SummaryField>
      <SummaryField label="Email">{lead.email || 'Not provided'}</SummaryField>
      <SummaryField label="Phone">{lead.phone || 'Not provided'}</SummaryField>
      <SummaryField label="Services to Activate" className="sm:col-span-2">
        {lead.services.length ? (
          <div className="flex flex-wrap gap-2">
            {lead.services.map((service) => (
              <Badge key={service.id} tone="info">
                {service.name}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="font-normal text-muted">No services selected.</span>
        )}
      </SummaryField>
      <SummaryField label="Primary Staff Member">
        {staffName ? (
          <span className="inline-flex items-center gap-2">
            <Avatar name={staffName} size="sm" />
            <span>{staffName}</span>
          </span>
        ) : (
          <span className="font-normal text-muted">No primary staff member selected.</span>
        )}
      </SummaryField>
      <SummaryField label="Additional Team Members" className="border-b-0">
        <span className="font-normal text-muted">No additional team members selected.</span>
      </SummaryField>
    </dl>
  );
}

function CarryOverSummary() {
  return (
    <section aria-labelledby="carry-over-heading">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-info-soft text-info">
          <FolderOpen aria-hidden weight="fill" className="size-4" />
        </span>
        <h2 id="carry-over-heading" className="text-sm font-bold text-heading">
          What to Carry Over
        </h2>
      </div>
      <ul className="space-y-2" aria-label="Selected items to carry over">
        {CARRY_OVER_ITEMS.map(({ id, icon: Glyph, tone, label }) => (
          <li key={id} className="flex min-w-0 items-center gap-2.5 text-xs text-text">
            <SelectionMark checked label={label} />
            <span
              className={'flex size-6 shrink-0 items-center justify-center rounded-control ' + tone}
            >
              <Glyph aria-hidden weight="fill" className="size-3.5" />
            </span>
            <span className="min-w-0">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PortalInviteSummary() {
  return (
    <section className="mt-5 border-t border-border pt-4" aria-labelledby="portal-invite-heading">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-info-soft text-info">
          <UsersThree aria-hidden weight="fill" className="size-4" />
        </span>
        <div>
          <h2 id="portal-invite-heading" className="text-sm font-bold text-heading">
            Client Portal Invitation
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Choose when the client receives portal access.
          </p>
        </div>
      </div>
      <div className="space-y-3 pl-1">
        <div className="flex items-start gap-2.5 text-sm text-text">
          <SelectionMark checked label="Send now" />
          <div>
            <p className="font-medium">Send now</p>
            <p className="mt-0.5 text-xs text-muted">
              Send the portal invitation after conversion.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 text-sm text-text">
          <SelectionMark checked={false} label="Send later" />
          <div>
            <p className="font-medium">Send later</p>
            <p className="mt-0.5 text-xs text-muted">
              Send the invitation manually at a later time.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function canConvertLead(lead: LeadProfile | undefined) {
  return Boolean(
    lead?.email && lead.phone?.trim() && lead.services.length && lead.assignedTo?.userId,
  );
}

export function ConvertLeadReviewScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const idempotencyKeyRef = useRef<string | null>(null);
  const leadQuery = useApiQuery(['lead-pipeline', 'profile', id], () =>
    api.leadPipeline.profile(id),
  );
  const lead = leadQuery.data;
  const convert = useApiMutation(
    (body: ConvertLeadToClientRequest) => api.leadPipeline.convertToClient(id, body),
    { invalidate: ['lead-pipeline'] },
  );

  const submitConversion = () => {
    if (!lead || !canConvertLead(lead)) return;
    idempotencyKeyRef.current ??= globalThis.crypto.randomUUID();

    const body: ConvertLeadToClientRequest = {
      idempotencyKey: idempotencyKeyRef.current,
      accountType: 'INDIVIDUAL',
      fullName: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
      businessName: lead.businessName,
      email: lead.email,
      phone: lead.phone ?? '',
      address: lead.address,
      serviceIds: lead.services.map((service) => service.id),
      primaryStaffUserId: lead.assignedTo?.userId ?? '',
      additionalStaffUserIds: [],
      carryOver: {
        contactInfo: true,
        notes: true,
        communications: true,
        appointments: true,
        tasks: true,
        documents: true,
        intakeForms: true,
        tags: true,
        attribution: true,
      },
      sendPortalInvite: true,
    };

    convert.mutate(body, {
      onSuccess: () => router.push('/leads/' + id + '/convert/done'),
    });
  };

  return (
    <div data-testid="convert-lead-page" className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/leads" className="text-link hover:underline">
          Leads
        </Link>
        <span aria-hidden="true">›</span>
        <Link href={'/leads/' + id} className="max-w-56 truncate text-link hover:underline">
          {lead ? [lead.firstName, lead.lastName].filter(Boolean).join(' ') : 'Lead'}
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-semibold text-text">Convert to Client</span>
      </nav>

      <header className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(28rem,0.78fr)] xl:items-center">
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="font-display text-3xl font-bold leading-tight text-heading md:text-4xl"
          >
            Review &amp; Confirm
          </h1>
          <p className="mt-1 text-sm text-muted md:text-base">
            Check the client details and selected information before converting this lead.
          </p>
        </div>
        <div data-testid="convert-lead-review-info">
          <Callout icon={Info} surface="info" iconStyle="tile" size="compact">
            This will create a new client record and link it to this lead. All selected information,
            including communication history, appointments, documents, and notes, will be carried
            over.
          </Callout>
        </div>
      </header>

      <div className="rounded-card border border-border bg-surface px-3 py-4 shadow-card md:px-5">
        <div className="hidden md:block">
          <Stepper steps={STEPS} current="confirm" label="Convert lead progress" variant="wizard" />
        </div>
        <div className="md:hidden">
          <Stepper
            steps={MOBILE_STEPS}
            current="confirm"
            label="Convert lead progress"
            variant="wizard"
          />
        </div>
      </div>

      <section
        data-testid="convert-lead-review-columns"
        aria-label="Lead conversion review"
        className="grid min-w-0 gap-4 lg:grid-cols-2"
      >
        <Card className="min-w-0 p-4 md:p-5" data-testid="convert-lead-review-summary">
          <SectionHeading
            icon={AddressBook}
            title="Client Summary"
            subtitle="Review the client details, services, and staff assignment."
          />
          {lead ? (
            <LeadSummary lead={lead} />
          ) : (
            <QueryMessage query={leadQuery} onRetry={() => void leadQuery.refetch()} />
          )}
        </Card>

        <Card className="min-w-0 p-4 md:p-5" data-testid="convert-lead-review-selections">
          <CarryOverSummary />
          <PortalInviteSummary />
        </Card>
      </section>

      <footer className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        {convert.error ? (
          <p role="alert" className="mr-auto text-sm text-danger">
            {errorMessage(convert.error)}
          </p>
        ) : null}
        <Button
          variant="secondary"
          className="sm:min-w-28"
          onClick={() => router.push('/leads/' + id + '/convert/portal')}
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back
        </Button>
        <Button
          className="sm:min-w-44"
          disabled={!lead || !canConvertLead(lead) || leadQuery.isPending || convert.isPending}
          onClick={submitConversion}
        >
          {convert.isPending ? 'Converting…' : 'Convert to Client'}
          {!convert.isPending ? <ArrowRight aria-hidden weight="bold" className="size-4" /> : null}
        </Button>
      </footer>
    </div>
  );
}
