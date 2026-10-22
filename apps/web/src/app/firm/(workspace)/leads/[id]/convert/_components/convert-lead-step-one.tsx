'use client';

import type { LeadProfile } from '@firmivra/types';
import { LEAD_STATUS_LABELS } from '@firmivra/types';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Input,
  Radio,
  Select,
  Stepper,
} from '@firmivra/ui';
import {
  AddressBook,
  Buildings,
  CalendarBlank,
  CaretDown,
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
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { type ConvertDraft, draftErrors, useConvertDraft } from './convert-draft';

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
    key: 'contactInfo' as const,
    icon: AddressBook,
    tone: 'bg-info-soft text-info',
    label: 'Contact information (name, email, phone, address)',
  },
  {
    id: 'notes',
    key: 'notes' as const,
    icon: Note,
    tone: 'bg-warning-soft text-gold',
    label: 'Notes',
  },
  {
    id: 'communications',
    key: 'communications' as const,
    icon: Phone,
    tone: 'bg-folder-surface text-heading',
    label: 'Communication history (emails, SMS, calls)',
  },
  {
    id: 'appointments',
    key: 'appointments' as const,
    icon: CalendarBlank,
    tone: 'bg-info-soft text-info',
    label: 'Appointments',
  },
  {
    id: 'tasks',
    key: 'tasks' as const,
    icon: ListChecks,
    tone: 'bg-purple-soft text-purple',
    label: 'Tasks / follow-ups',
  },
  {
    id: 'documents',
    key: 'documents' as const,
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
    label: 'Uploaded documents',
  },
  {
    id: 'intake-forms',
    key: 'intakeForms' as const,
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
    label: 'Submitted intake forms',
  },
  { id: 'tags', key: 'tags' as const, icon: Tag, tone: 'bg-warning-soft text-gold', label: 'Tags' },
  {
    id: 'attribution',
    key: 'attribution' as const,
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

type DraftErrors = Partial<Record<keyof ConvertDraft, string>>;

function ClientDetails({
  draft,
  update,
  errors,
  query,
  services,
  highlighted = false,
}: {
  draft: ConvertDraft | null;
  update: (patch: Partial<ConvertDraft>) => void;
  errors: DraftErrors;
  query: UseQueryResult<LeadOptions>;
  services: LeadOptions['services'] | undefined;
  highlighted?: boolean;
}) {
  const off = !draft;
  const chosen = new Set(draft?.serviceIds ?? []);
  return (
    <Card
      className={highlighted ? 'border-2 border-info-soft p-3' : 'p-3'}
      data-testid="convert-lead-client-fields"
    >
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
            <Radio
              name="client-type"
              label="Individual"
              disabled={off}
              checked={draft?.accountType === 'INDIVIDUAL'}
              onChange={() => update({ accountType: 'INDIVIDUAL' })}
            />
            <Radio
              name="client-type"
              label="Business"
              disabled={off}
              checked={draft?.accountType === 'BUSINESS'}
              onChange={() => update({ accountType: 'BUSINESS' })}
            />
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Full Name *"
            maxLength={120}
            disabled={off}
            value={draft?.fullName ?? ''}
            error={errors.fullName}
            onChange={(event) => update({ fullName: event.target.value })}
          />
          <Input
            label={
              draft?.accountType === 'BUSINESS'
                ? 'Business Name *'
                : 'Business Name (if applicable)'
            }
            maxLength={160}
            disabled={off}
            value={draft?.businessName ?? ''}
            error={errors.businessName}
            onChange={(event) => update({ businessName: event.target.value })}
          />
          <Input
            label="Email *"
            type="email"
            maxLength={254}
            disabled={off}
            value={draft?.email ?? ''}
            error={errors.email}
            onChange={(event) => update({ email: event.target.value })}
          />
          <Input
            label="Phone *"
            type="tel"
            maxLength={40}
            disabled={off}
            value={draft?.phone ?? ''}
            error={errors.phone}
            onChange={(event) => update({ phone: event.target.value })}
          />
        </div>
        <Input
          label="Address"
          placeholder="Enter address (optional)"
          maxLength={300}
          disabled={off}
          value={draft?.address ?? ''}
          onChange={(event) => update({ address: event.target.value })}
        />
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-text">
            Services to Activate <span className="text-danger">*</span>
          </legend>
          {query.isPending || query.isError ? (
            <QuietQueryState query={query} noun="service options" />
          ) : services?.length ? (
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {services.map((service) => (
                <Checkbox
                  key={service.id}
                  label={service.name}
                  disabled={off}
                  checked={chosen.has(service.id)}
                  onChange={(event) =>
                    update({
                      serviceIds: event.target.checked
                        ? [...chosen, service.id]
                        : [...chosen].filter((s) => s !== service.id),
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No services are available.</p>
          )}
          {errors.serviceIds ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.serviceIds}
            </p>
          ) : null}
        </fieldset>
      </div>
    </Card>
  );
}

/**
 * Additional Team Members: a select-like button that opens a list of checkboxes (the kit has no
 * multi-select yet; a local control until it does).
 */
function TeamMembersPicker({
  staff,
  value,
  exclude,
  disabled,
  onChange,
}: {
  staff: LeadOptions['staff'];
  value: string[];
  exclude: string;
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const choices = staff.filter((s) => s.userId !== exclude);
  const names = choices.filter((s) => value.includes(s.userId)).map((s) => s.name);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id="team-members-label" className="text-sm font-medium text-text">
        Additional Team Members
      </span>
      <details className="group relative min-w-0" data-testid="team-members">
        <summary
          aria-labelledby="team-members-label"
          className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-control border border-control-border bg-surface px-3 text-sm ${disabled ? 'pointer-events-none text-muted' : 'text-text'}`}
        >
          <span className="min-w-0 truncate">
            {names.length ? names.join(', ') : 'Select team members (optional)'}
          </span>
          <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
        </summary>
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-control border border-border bg-surface p-2 shadow-card">
          {choices.length ? (
            choices.map((s) => (
              <Checkbox
                key={s.userId}
                label={s.name}
                checked={value.includes(s.userId)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, s.userId]
                      : value.filter((u) => u !== s.userId),
                  )
                }
              />
            ))
          ) : (
            <p className="text-sm text-muted">No other staff members.</p>
          )}
        </div>
      </details>
    </div>
  );
}

function StaffAssignment({
  draft,
  update,
  errors,
  query,
  staff,
  highlighted = false,
}: {
  draft: ConvertDraft | null;
  update: (patch: Partial<ConvertDraft>) => void;
  errors: DraftErrors;
  query: UseQueryResult<LeadOptions>;
  staff: LeadOptions['staff'] | undefined;
  highlighted?: boolean;
}) {
  return (
    <Card
      className={highlighted ? 'border-2 border-info-soft p-3' : 'p-3'}
      data-testid="convert-lead-staff-assignment"
    >
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
          <Select
            label="Primary Staff Member *"
            disabled={!draft}
            value={draft?.primaryStaffUserId ?? ''}
            error={errors.primaryStaffUserId}
            onChange={(event) =>
              update({
                primaryStaffUserId: event.target.value,
                additionalStaffUserIds: (draft?.additionalStaffUserIds ?? []).filter(
                  (u) => u !== event.target.value,
                ),
              })
            }
            options={[
              { value: '', label: 'Select a staff member' },
              ...staff.map((s) => ({ value: s.userId, label: s.name })),
            ]}
          />
          <TeamMembersPicker
            staff={staff}
            value={draft?.additionalStaffUserIds ?? []}
            exclude={draft?.primaryStaffUserId ?? ''}
            disabled={!draft}
            onChange={(additionalStaffUserIds) => update({ additionalStaffUserIds })}
          />
        </div>
      ) : (
        <p className="px-1 text-sm text-muted">No staff members are available.</p>
      )}
    </Card>
  );
}

function LeadConversionRightRail({
  draft,
  update,
  highlighted = false,
}: {
  draft: ConvertDraft | null;
  update: (patch: Partial<ConvertDraft>) => void;
  highlighted?: boolean;
}) {
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
          {CARRY_OVER.map(({ id, key, icon: Glyph, tone, label }) => (
            <li key={id} className="flex min-w-0 items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                aria-label={label}
                disabled={!draft}
                checked={draft?.carryOver[key] ?? true}
                onChange={(event) =>
                  draft &&
                  update({ carryOver: { ...draft.carryOver, [key]: event.target.checked } })
                }
                className="size-4 shrink-0 cursor-pointer accent-action"
              />
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
        <fieldset className="space-y-3 px-1 text-sm">
          <legend className="sr-only">Client portal invitation</legend>
          <label className="flex items-start gap-2.5 text-text">
            <input
              type="radio"
              name="portal-invite"
              disabled={!draft}
              checked={draft?.sendPortalInvite ?? true}
              onChange={() => update({ sendPortalInvite: true })}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-action"
            />
            <span>
              <span className="block font-medium">Send portal invitation after conversion</span>
              <span className="mt-0.5 block text-xs text-muted">
                An email invitation will be sent to the client to create their portal account.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-text">
            <input
              type="radio"
              name="portal-invite"
              disabled={!draft}
              checked={draft ? !draft.sendPortalInvite : false}
              onChange={() => update({ sendPortalInvite: false })}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-action"
            />
            <span>
              <span className="block font-medium">Send later</span>
              <span className="mt-0.5 block text-xs text-muted">
                Do not send an invitation now. You can send it manually later.
              </span>
            </span>
          </label>
        </fieldset>
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

/**
 * Convert to Client, steps 1 to 3 (convert-lead-to-client.jpg; Octavia's Leads review, item 16):
 * the client's details, services and staff, what to carry over and the portal invitation are all
 * editable, from the lead's own values, and kept in one draft across the steps (the convert
 * layout); Review & Confirm sends what was set here. Continue checks the client's details first.
 */
export function ConvertLeadStepOne({ activeStep = 'review' }: { activeStep?: ConvertLeadStep }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lead = useApiQuery(['lead-pipeline', 'profile', id], () => api.leadPipeline.profile(id));
  const options = useApiQuery(['lead-pipeline', 'options'], () => api.leadPipeline.options());
  const profile = lead.data;
  const optionData = options.data;
  const { draft, update } = useConvertDraft(profile);
  const [checked, setChecked] = useState(false);
  const errors: DraftErrors = checked && draft ? draftErrors(draft) : {};
  const next =
    activeStep === 'review'
      ? `/leads/${id}/convert/details`
      : activeStep === 'details'
        ? `/leads/${id}/convert/portal`
        : `/leads/${id}/convert/review`;
  const onContinue = () => {
    // The client's details are checked before they leave the steps that show them.
    if (activeStep !== 'portal' && draft && Object.keys(draftErrors(draft)).length) {
      setChecked(true);
      return;
    }
    router.push(next);
  };

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

      {activeStep === 'details' ? (
        <section
          aria-label="Client details and staff assignment"
          className="grid min-w-0 gap-4 xl:grid-cols-2"
          data-testid="convert-lead-details-step-column"
        >
          <ClientDetails
            draft={draft}
            update={update}
            errors={errors}
            query={options}
            services={optionData?.services}
            highlighted
          />
          <StaffAssignment
            draft={draft}
            update={update}
            errors={errors}
            query={options}
            staff={optionData?.staff}
            highlighted
          />
        </section>
      ) : (
        <section
          aria-label="Lead conversion information"
          className={`grid min-w-0 gap-4 ${activeStep === 'portal' ? 'w-full xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]' : 'xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)_minmax(0,1fr)]'}`}
        >
          <div
            data-testid="convert-lead-profile-step-column"
            className="flex min-w-0 flex-col gap-3"
          >
            <LeadOverview lead={profile} query={lead} onEdit={() => router.push(`/leads/${id}`)} />
            <LeadDetails lead={profile} query={lead} />
          </div>
          {activeStep !== 'portal' ? (
            <div
              data-testid="convert-lead-details-step-column"
              className="flex min-w-0 flex-col gap-3"
            >
              <ClientDetails
                draft={draft}
                update={update}
                errors={errors}
                query={options}
                services={optionData?.services}
              />
              <StaffAssignment
                draft={draft}
                update={update}
                errors={errors}
                query={options}
                staff={optionData?.staff}
              />
            </div>
          ) : null}
          <LeadConversionRightRail
            draft={draft}
            update={update}
            highlighted={activeStep === 'portal'}
          />
        </section>
      )}

      <footer className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        {Object.keys(errors).length ? (
          <p role="alert" className="mr-auto text-sm text-danger">
            Some client details need fixing before you continue.
          </p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() =>
            router.push(activeStep === 'portal' ? `/leads/${id}/convert/details` : `/leads/${id}`)
          }
        >
          {activeStep === 'portal' ? 'Back' : 'Cancel'}
        </Button>
        <Button disabled={!draft} onClick={onContinue}>
          Review &amp; Continue <span aria-hidden="true">→</span>
        </Button>
      </footer>
    </div>
  );
}
