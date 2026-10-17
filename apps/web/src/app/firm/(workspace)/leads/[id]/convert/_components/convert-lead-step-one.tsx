'use client';

import type { LeadProfile } from '@firmivra/types';
import { LEAD_STATUS_LABELS } from '@firmivra/types';
import { Avatar, Badge, Button, Callout, Card, Stepper } from '@firmivra/ui';
import {
  AddressBook,
  Buildings,
  CalendarBlank,
  Check,
  CheckCircle,
  Clock,
  FileText,
  Flag,
  FolderOpen,
  Info,
  LinkSimple,
  ListChecks,
  MapPin,
  Note,
  PencilSimple,
  Phone,
  Tag,
  UsersThree,
  EnvelopeSimple,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';

type LeadOptions = NonNullable<Awaited<ReturnType<typeof api.leadPipeline.options>>>;

const STEPS = [
  { id: 'review', label: 'Review Lead Information' },
  { id: 'details', label: 'Client Details & Services' },
  { id: 'portal', label: 'Portal & Settings' },
  { id: 'confirm', label: 'Review & Confirm' },
  { id: 'complete', label: 'Complete' },
];

const CARRY_OVER = [
  {
    id: 'contact',
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
    id: 'intake-forms',
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

const AFTER_CONVERSION = [
  'A new client record will be created.',
  'The lead will be marked as Converted.',
  'All selected information will be linked to the client.',
  'The client will appear in the Clients module under the appropriate service tabs.',
  'The original lead record will be stored for reference and linked to the client.',
].map((label, index) => ({ id: `after-${index}`, label, done: true }));

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

function date(value: string | null, withTime = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

function SectionTitle({
  icon: Glyph,
  title,
  subtitle,
  action,
  tone = 'blue',
  iconTone = 'action',
}: {
  icon: Icon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tone?: 'blue' | 'plain';
  iconTone?: 'action' | 'success';
}) {
  return (
    <div
      className={`mb-3 flex min-w-0 items-start gap-2.5 rounded-control ${tone === 'blue' ? 'bg-info-soft p-2.5' : 'p-0'}`}
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-control ${iconTone === 'success' ? 'bg-success text-on-action' : 'bg-action text-on-action'}`}
      >
        <Glyph aria-hidden weight="fill" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-heading">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs leading-4 text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function InfoRow({
  icon: Glyph,
  label,
  children,
  hideLabel = false,
}: {
  icon: Icon;
  label: string;
  children: ReactNode;
  hideLabel?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border py-1.5 last:border-b-0">
      <Glyph aria-hidden weight="fill" className="size-4 shrink-0 text-info" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {hideLabel ? null : <span className="shrink-0 text-xs text-muted">{label}</span>}
        <div className="min-w-0 break-words text-xs text-text">{children}</div>
      </div>
    </div>
  );
}

function QuietQueryState<T>({ query, noun }: { query: UseQueryResult<T>; noun: string }) {
  if (query.isPending) {
    return <p className="text-sm text-muted">Loading {noun}…</p>;
  }
  if (query.isError) {
    const code = errorCode(query.error);
    const message =
      code === 'FORBIDDEN'
        ? `You don't have permission to view this ${noun}.`
        : code === 'NOT_FOUND'
          ? noun === 'lead information'
            ? "This lead couldn't be found."
            : `These ${noun} could not be found.`
          : `Couldn't load ${noun}.`;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" role="status">
        <span>{message}</span>
        {query.data === undefined && code !== 'FORBIDDEN' && code !== 'NOT_FOUND' ? (
          <button
            type="button"
            className="font-medium text-link underline-offset-2 hover:underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}

function ReadonlyField({
  label,
  value,
  placeholder,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
      <span>{label}</span>
      <input
        aria-label={label}
        readOnly
        value={value ?? ''}
        placeholder={placeholder}
        className="h-9 min-w-0 rounded-control border border-border bg-surface px-2.5 text-sm text-text outline-none placeholder:text-muted"
      />
    </label>
  );
}

function PriorityBadge({ priority }: { priority: LeadProfile['priority'] }) {
  const tone = priority === 'HOT' ? 'danger' : priority === 'WARM' ? 'warning' : 'info';
  return <Badge tone={tone}>{titleCase(priority)}</Badge>;
}

function LeadOverview({
  lead,
  query,
  onEdit,
}: {
  lead: LeadProfile | undefined;
  query: UseQueryResult<LeadProfile>;
  onEdit: () => void;
}) {
  const name = lead ? `${lead.firstName} ${lead.lastName}` : 'Lead information';
  return (
    <Card className="p-3" data-testid="convert-lead-lead-info">
      <SectionTitle
        icon={AddressBook}
        title="Lead Information"
        subtitle="Basic information from the lead record."
        action={
          <Button
            variant="secondary"
            className="min-h-8 shrink-0 px-2.5 py-1 text-xs"
            onClick={onEdit}
          >
            <PencilSimple aria-hidden weight="fill" className="size-3.5" />
            Edit Lead
          </Button>
        }
      />
      {!lead ? null : (
        <div className="mb-3 flex min-w-0 items-start gap-3 px-1">
          <Avatar name={name} src={lead.avatarUrl ?? undefined} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-bold text-heading">{name}</h3>
              <PriorityBadge priority={lead.priority} />
            </div>
            <p className="mt-1 text-sm text-text">Lead ID: {lead.number}</p>
            <p className="mt-0.5 text-sm text-text">Source: {titleCase(lead.source)}</p>
            {lead.campaign ? (
              <p className="mt-0.5 break-words text-sm text-text">Campaign: {lead.campaign.name}</p>
            ) : null}
          </div>
        </div>
      )}
      <QuietQueryState query={query} noun="lead information" />
      {lead ? (
        <div className="border-t border-border px-1">
          <InfoRow icon={EnvelopeSimple} label="Email" hideLabel>
            {lead.email || '—'}
          </InfoRow>
          <InfoRow icon={Phone} label="Phone" hideLabel>
            {lead.phone || '—'}
          </InfoRow>
          <InfoRow icon={MapPin} label="Address" hideLabel>
            {lead.address || '—'}
          </InfoRow>
          <InfoRow icon={Clock} label="Preferred Contact">
            {lead.preferredContact.length ? lead.preferredContact.map(titleCase).join(', ') : '—'}
          </InfoRow>
          <InfoRow icon={Clock} label="Best Time to Contact">
            {lead.bestTimeToContact || '—'}
          </InfoRow>
        </div>
      ) : null}
      {!lead ? <p className="text-sm text-muted">Lead contact details will appear here.</p> : null}
    </Card>
  );
}

function LeadDetails({
  lead,
  query,
}: {
  lead: LeadProfile | undefined;
  query: UseQueryResult<LeadProfile>;
}) {
  const statusTone =
    lead?.stage === 'QUALIFIED' || lead?.stage === 'CONVERTED'
      ? 'success'
      : lead?.stage === 'DECLINED' || lead?.stage === 'LOST'
        ? 'neutral'
        : 'info';
  return (
    <Card className="p-3" data-testid="convert-lead-details">
      <SectionTitle icon={FolderOpen} title="Lead Details" />
      <QuietQueryState query={query} noun="lead details" />
      {lead ? (
        <div className="px-1">
          <InfoRow icon={Flag} label="Lead Status">
            <Badge tone={statusTone}>{LEAD_STATUS_LABELS[lead.stage]}</Badge>
          </InfoRow>
          <InfoRow icon={Tag} label="Services Interested In">
            {lead.services.length ? (
              <span className="flex flex-wrap gap-1.5">
                {lead.services.map((service) => (
                  <Badge key={service.id} tone="info">
                    {service.name}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-muted">No services selected.</span>
            )}
          </InfoRow>
          <InfoRow icon={Flag} label="Priority">
            <PriorityBadge priority={lead.priority} />
          </InfoRow>
          <InfoRow icon={UsersThree} label="Assigned To">
            {lead.assignedTo ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={lead.assignedTo.name} size="sm" />
                {lead.assignedTo.name}
              </span>
            ) : (
              'Unassigned'
            )}
          </InfoRow>
          <InfoRow icon={CalendarBlank} label="Date Added">
            {date(lead.createdAt)}
          </InfoRow>
          <InfoRow icon={Clock} label="Last Contact">
            {lead.lastContact ? date(lead.lastContact.at, true) : 'No contact yet'}
          </InfoRow>
          <InfoRow icon={CalendarBlank} label="Next Action">
            {lead.nextAction
              ? `${titleCase(lead.nextAction.type)} · ${date(lead.nextAction.dueAt, true)}`
              : 'No further action'}
          </InfoRow>
          <InfoRow icon={Tag} label="Tags">
            {lead.tags.length ? lead.tags.join(', ') : <span className="text-muted">No tags</span>}
          </InfoRow>
          <InfoRow icon={Note} label="Notes">
            {lead.recentActivity.find((item) => item.kind === 'NOTE')?.label ?? (
              <span className="text-muted">No recent notes are available.</span>
            )}
          </InfoRow>
        </div>
      ) : (
        <p className="text-sm text-muted">Lead details will appear here when available.</p>
      )}
    </Card>
  );
}

function ChoiceIndicator({ checked, radio = false }: { checked: boolean; radio?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-4 shrink-0 items-center justify-center border ${radio ? 'rounded-full' : 'rounded-sm'} ${checked ? 'border-action bg-action text-on-action' : 'border-control-border bg-surface text-transparent'}`}
    >
      {checked ? (
        radio ? (
          <span className="size-1.5 rounded-full bg-current" />
        ) : (
          <Check weight="bold" className="size-3" />
        )
      ) : null}
    </span>
  );
}

function ClientDetails({
  lead,
  query,
  services,
}: {
  lead: LeadProfile | undefined;
  query: UseQueryResult<LeadOptions>;
  services: LeadOptions['services'] | undefined;
}) {
  const selectedIds = new Set(lead?.services.map((service) => service.id) ?? []);
  return (
    <Card className="p-3" data-testid="convert-lead-client-fields">
      <SectionTitle
        icon={Buildings}
        title="Client Details & Services"
        subtitle="Confirm or update the client information. Select client type and services."
      />
      <div className="space-y-3 px-1">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-text">
            Client Type <span className="text-danger">*</span>
          </legend>
          <div className="flex flex-wrap gap-5 text-sm text-text">
            <span className="inline-flex items-center gap-2">
              <ChoiceIndicator checked />
              Individual
            </span>
            <span className="inline-flex items-center gap-2">
              <ChoiceIndicator checked={false} radio />
              Business
            </span>
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadonlyField
            label="Full Name *"
            value={lead ? `${lead.firstName} ${lead.lastName}` : null}
            placeholder="Lead name"
          />
          <ReadonlyField
            label="Business Name (if applicable)"
            value={lead?.businessName ?? null}
            placeholder="—"
          />
          <ReadonlyField label="Email *" value={lead?.email ?? null} placeholder="Lead email" />
          <ReadonlyField label="Phone *" value={lead?.phone ?? null} placeholder="Lead phone" />
        </div>
        <ReadonlyField
          label="Address"
          value={lead?.address ?? null}
          placeholder="Enter address (optional)"
        />
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-text">
            Services to Activate <span className="text-danger">*</span>
          </legend>
          {query.isPending || query.isError ? (
            <QuietQueryState query={query} noun="service options" />
          ) : services?.length ? (
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {services.map((service) => {
                const checked = selectedIds.has(service.id);
                return (
                  <span
                    key={service.id}
                    className="flex min-w-0 items-start gap-2 text-xs text-text"
                  >
                    <ChoiceIndicator checked={checked} />
                    <span className="min-w-0">{service.name}</span>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">No services are available.</p>
          )}
        </fieldset>
      </div>
    </Card>
  );
}

function StaffAssignment({
  lead,
  query,
  staff,
}: {
  lead: LeadProfile | undefined;
  query: UseQueryResult<LeadOptions>;
  staff: LeadOptions['staff'] | undefined;
}) {
  return (
    <Card className="p-3" data-testid="convert-lead-staff-assignment">
      <SectionTitle
        icon={UsersThree}
        title="Assign Staff"
        subtitle="Assign the primary staff member and any additional team members."
      />
      {query.isPending || query.isError ? (
        <div className="px-1">
          <QuietQueryState query={query} noun="staff options" />
        </div>
      ) : staff?.length ? (
        <div className="grid gap-3 px-1 sm:grid-cols-2">
          <ReadonlyField
            label="Primary Staff Member *"
            value={lead?.assignedTo?.name ?? null}
            placeholder="Select a staff member"
          />
          <ReadonlyField
            label="Additional Team Members"
            value={null}
            placeholder="Select team members"
          />
        </div>
      ) : (
        <p className="px-1 text-sm text-muted">No staff members are available.</p>
      )}
    </Card>
  );
}

function LeadConversionRightRail({ highlighted = false }: { highlighted?: boolean }) {
  const cardClassName = `p-3 ${highlighted ? 'border-info-soft' : ''}`;
  return (
    <div
      data-testid={highlighted ? 'convert-lead-portal-step-column' : undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <Card className={cardClassName} data-testid="convert-lead-carry-over">
        <SectionTitle
          icon={FolderOpen}
          title="What to Carry Over"
          subtitle="Select the information to move from the lead to the client record."
        />
        <ul className="space-y-1.5 px-1">
          {CARRY_OVER.map(({ id, icon: Glyph, tone, label }) => (
            <li key={id} className="flex min-w-0 items-center gap-2 text-xs text-text">
              <ChoiceIndicator checked />
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-control ${tone}`}
              >
                <Glyph aria-hidden weight="fill" className="size-3.5" />
              </span>
              <span className="min-w-0">{label}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className={cardClassName} data-testid="convert-lead-portal-access">
        <SectionTitle icon={UsersThree} title="Client Portal Access" tone="plain" />
        <div className="space-y-3 px-1 text-sm">
          <div className="flex items-start gap-2.5 text-text">
            <ChoiceIndicator checked />
            <div>
              <p className="font-medium">Send portal invitation after conversion</p>
              <p className="mt-0.5 text-xs text-muted">
                An email invitation will be sent to the client to create their portal account.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-text">
            <ChoiceIndicator checked={false} />
            <div>
              <p className="font-medium">Send later</p>
              <p className="mt-0.5 text-xs text-muted">
                Do not send an invitation now. You can send it manually later.
              </p>
            </div>
          </div>
        </div>
      </Card>
      <Card className={cardClassName} data-testid="convert-lead-after-conversion">
        <SectionTitle icon={CheckCircle} title="After Conversion" tone="plain" iconTone="success" />
        <ul className="space-y-2 rounded-control bg-success-soft p-3">
          {AFTER_CONVERSION.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-2 text-xs text-text">
              <CheckCircle
                aria-hidden
                weight="fill"
                className="mt-0.5 size-3.5 shrink-0 text-success"
              />
              <span className="min-w-0">{item.label}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type ConvertLeadStep = 'review' | 'details' | 'portal';

/** Shared lead conversion screen for reviewing lead, details, and portal setup steps. */
export function ConvertLeadStepOne({ activeStep = 'review' }: { activeStep?: ConvertLeadStep }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lead = useApiQuery(['lead-pipeline', 'profile', id], () => api.leadPipeline.profile(id));
  const options = useApiQuery(['lead-pipeline', 'options'], () => api.leadPipeline.options());
  const profile = lead.data;
  const optionData = options.data;

  return (
    <div data-testid="convert-lead-page" className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/leads" className="text-link hover:underline">
          Leads
        </Link>
        <span aria-hidden="true">›</span>
        <Link href={`/leads/${id}`} className="max-w-56 truncate text-link hover:underline">
          {profile ? `${profile.firstName} ${profile.lastName}` : 'Lead'}
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
            Convert Lead to Client
          </h1>
          <p className="mt-1 text-sm text-muted md:text-base">
            Turn this qualified lead into a client. Review and confirm the information below.
          </p>
        </div>
        <Callout icon={Info} surface="info" iconStyle="tile" size="compact">
          This will create a new client record and link it to this lead. All selected information,
          including communication history, appointments, documents, and notes, will be carried over.
        </Callout>
      </header>

      <div className="rounded-card border border-border bg-surface px-3 py-4 shadow-card md:px-5">
        <Stepper
          steps={STEPS}
          current={activeStep}
          label="Convert lead progress"
          variant="wizard"
        />
      </div>

      <section
        aria-label="Lead conversion information"
        className={`grid min-w-0 gap-4 ${activeStep === 'review' ? 'xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)_minmax(0,1fr)]' : activeStep === 'portal' ? 'w-full xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]' : 'mx-auto w-full max-w-2xl xl:grid-cols-1'}`}
      >
        {activeStep === 'review' || activeStep === 'portal' ? (
          <div
            data-testid="convert-lead-profile-step-column"
            className="flex min-w-0 flex-col gap-3"
          >
            <LeadOverview lead={profile} query={lead} onEdit={() => router.push(`/leads/${id}`)} />
            <LeadDetails lead={profile} query={lead} />
          </div>
        ) : null}
        {activeStep === 'details' ? (
          <div
            data-testid="convert-lead-details-step-column"
            className="flex min-w-0 flex-col gap-3 rounded-card border-2 border-info-soft p-2"
          >
            <ClientDetails lead={profile} query={options} services={optionData?.services} />
            <StaffAssignment lead={profile} query={options} staff={optionData?.staff} />
          </div>
        ) : null}
        {activeStep === 'review' ? <LeadConversionRightRail /> : null}
        {activeStep === 'portal' ? <LeadConversionRightRail highlighted /> : null}
      </section>

      <footer className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() =>
            router.push(activeStep === 'portal' ? `/leads/${id}/convert/details` : `/leads/${id}`)
          }
        >
          {activeStep === 'portal' ? 'Back' : 'Cancel'}
        </Button>
        <Button
          onClick={() =>
            router.push(
              activeStep === 'review'
                ? `/leads/${id}/convert/details`
                : activeStep === 'details'
                  ? `/leads/${id}/convert/portal`
                  : `/leads/${id}/convert/review`,
            )
          }
        >
          Review &amp; Continue <span aria-hidden="true">→</span>
        </Button>
      </footer>
    </div>
  );
}
