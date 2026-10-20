import type {
  MemberRef,
  TaxReturnActivityList,
  TaxReturnBlocker,
  TaxReturnRow,
  TaxReturnTab,
  TaxReturnWorkflowStatus,
  TaxpayerFilingStatus,
} from '@firmivra/types';
import { Badge, type ChartTone, type TileTone } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  Circle,
  Clock,
  FileText,
  type Icon,
  ListChecks,
  NotePencil,
  PaperPlaneTilt,
  PlusCircle,
  Seal,
  Signature,
  Swap,
  UserSwitch,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';

/** Every query of the Tax Returns module starts here: a change in one view refreshes the others. */
export const TR_KEY = ['tax-returns'] as const;

export const STATUS_LABEL: Record<TaxReturnWorkflowStatus, string> = {
  IN_PREPARATION: 'In Preparation',
  WAITING_ON_CLIENT: 'Waiting on Client',
  READY_FOR_REVIEW: 'Ready for Review',
  READY_FOR_SIGNATURE: 'Ready for Signature',
  READY_TO_FILE: 'Ready to File',
  TRANSMITTED: 'Transmitted',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};
export const STATUS_ORDER = Object.keys(STATUS_LABEL) as TaxReturnWorkflowStatus[];

const STATUS_BADGE: Record<
  TaxReturnWorkflowStatus,
  { tone: 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'neutral'; icon?: Icon }
> = {
  IN_PREPARATION: { tone: 'danger' },
  WAITING_ON_CLIENT: { tone: 'warning', icon: Clock },
  READY_FOR_REVIEW: { tone: 'info' },
  READY_FOR_SIGNATURE: { tone: 'purple', icon: CheckCircle },
  READY_TO_FILE: { tone: 'success' },
  TRANSMITTED: { tone: 'neutral', icon: PaperPlaneTilt },
  ACCEPTED: { tone: 'success', icon: CheckCircle },
  REJECTED: { tone: 'danger', icon: XCircle },
  CLOSED: { tone: 'neutral', icon: CheckCircle },
};
export function StatusBadge({ status }: { status: TaxReturnWorkflowStatus }) {
  const b = STATUS_BADGE[status];
  return <span className="whitespace-nowrap [&>span]:px-2.5">{badge(b, status)}</span>;
}
function badge(b: (typeof STATUS_BADGE)[TaxReturnWorkflowStatus], status: TaxReturnWorkflowStatus) {
  return b.icon ? (
    <Badge tone={b.tone} icon={b.icon}>
      {STATUS_LABEL[status]}
    </Badge>
  ) : (
    <Badge tone={b.tone} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Tax Season Progress: one colour per status (the kit's chart tones). */
export const STATUS_CHART: Record<TaxReturnWorkflowStatus, ChartTone> = {
  ACCEPTED: 'green',
  CLOSED: 'green',
  TRANSMITTED: 'grey',
  READY_TO_FILE: 'navy',
  READY_FOR_SIGNATURE: 'purple',
  READY_FOR_REVIEW: 'blue',
  IN_PREPARATION: 'yellow',
  WAITING_ON_CLIENT: 'purple',
  REJECTED: 'red',
};

export const TABS: { id: TaxReturnTab; label: string }[] = [
  { id: 'all', label: 'All Returns' },
  { id: 'personal', label: 'Personal Tax' },
  { id: 'business', label: 'Business Tax' },
  { id: 'quarterly', label: 'Quarterly Taxes' },
  { id: 'amended', label: 'Amended Returns' },
  { id: 'prior_year', label: 'Prior Year Returns' },
];

/** The design's "Individual 1040 / Personal Tax" cell: the form, then the tax-type tab it is in. */
export function returnKind(
  r: Pick<TaxReturnRow, 'filingType' | 'formType' | 'quarter' | 'amendsReturnId' | 'taxYear'>,
) {
  const form = r.formType ?? '';
  if (r.amendsReturnId)
    return {
      title: 'Amended Return',
      group: 'Amended Returns',
      tone: 'amber' as const,
    };
  if (r.quarter)
    return {
      title: `Quarterly Estimate Q${r.quarter}`,
      group: 'Quarterly Taxes',
      tone: 'purple' as const,
    };
  if (r.taxYear < new Date().getUTCFullYear() - 1)
    return {
      title: 'Prior Year Return',
      group: 'Prior Year Returns',
      tone: 'grey' as const,
    };
  return r.filingType === 'INDIVIDUAL'
    ? { title: `Individual ${form}`.trim(), group: 'Personal Tax', tone: 'blue' as const }
    : { title: `Business ${form}`.trim(), group: 'Business Tax', tone: 'blue' as const };
}
const KIND_TONE = {
  blue: 'bg-info-soft text-action',
  amber: 'bg-warning-soft text-warning',
  purple: 'bg-purple-soft text-purple',
  grey: 'bg-disabled text-text',
};
export function ReturnKind({ row }: { row: Parameters<typeof returnKind>[0] }) {
  const k = returnKind(row);
  return (
    <span
      className={`inline-flex flex-col rounded-md px-2.5 py-1 leading-tight whitespace-nowrap ${KIND_TONE[k.tone]}`}
    >
      <span className="font-medium">{k.title}</span>
      <span className="text-[11px] opacity-80">{k.group}</span>
    </span>
  );
}

/** "Return type" choices: the forms the firm files most (any other form can be typed). */
export const FORM_TYPES = [
  { value: '1040', label: '1040 (Individual)', filingType: 'INDIVIDUAL' },
  { value: '1040-SR', label: '1040-SR (Senior)', filingType: 'INDIVIDUAL' },
  { value: '1040-NR', label: '1040-NR (Nonresident)', filingType: 'INDIVIDUAL' },
  { value: '1040-ES', label: '1040-ES (Estimated tax)', filingType: 'INDIVIDUAL' },
  { value: '1040-X', label: '1040-X (Amended)', filingType: 'INDIVIDUAL' },
  { value: '1120', label: '1120 (C corporation)', filingType: 'BUSINESS' },
  { value: '1120S', label: '1120S (S corporation)', filingType: 'BUSINESS' },
  { value: '1065', label: '1065 (Partnership)', filingType: 'BUSINESS' },
  { value: '1120-W', label: '1120-W (Corporate estimated tax)', filingType: 'BUSINESS' },
  { value: '990', label: '990 (Exempt organization)', filingType: 'BUSINESS' },
  { value: '1041', label: '1041 (Estate or trust)', filingType: 'BUSINESS' },
  { value: '941', label: '941 (Quarterly payroll)', filingType: 'BUSINESS' },
] as const;

export const FILING_STATUS_LABEL: Record<TaxpayerFilingStatus, string> = {
  SINGLE: 'Single',
  MARRIED_FILING_JOINTLY: 'Married Filing Jointly',
  MARRIED_FILING_SEPARATELY: 'Married Filing Separately',
  HEAD_OF_HOUSEHOLD: 'Head of Household',
  QUALIFYING_SURVIVING_SPOUSE: 'Qualifying Surviving Spouse',
};

export const BLOCKER_LABEL: Record<TaxReturnBlocker, string> = {
  VALIDATION_NOT_RUN: 'Run final validation',
  VALIDATION_ERRORS: 'Fix the validation errors',
  WARNINGS_NOT_ACKNOWLEDGED: 'Acknowledge the validation warnings',
  APPROVAL_PENDING: 'Complete the required approvals',
  APPROVAL_RETURNED: 'A reviewer returned it: fix it and ask again',
  AUTHORIZATION_UNSIGNED: 'Obtain the client signatures',
  NO_FILING_TRANSMITTED: 'Record a transmission (or paper filing) first',
  FILINGS_NOT_ACCEPTED: 'Every required filing must be accepted or paper filed',
  ORIGINAL_NOT_FILED: 'The original return was never filed',
};

/** The module's error codes in plain words (lib/errors has the generic ones). */
export const TR_ERRORS: Record<string, string> = {
  DUPLICATE_RETURN: 'This client already has this return for that year.',
  STATUS_BLOCKED: 'This return cannot move there yet. Check its next steps.',
  REASON_REQUIRED: 'Say why the return goes back a step.',
  RETURN_LOCKED: 'A filed return, a transmission or a decided approval does not change.',
  ATTEMPT_PENDING: 'Record the answer to the last transmission first.',
  FILING_IN_USE: 'A jurisdiction with transmissions stays on the return.',
  DOCUMENT_LOCKED: 'A filed return or an acknowledgment stays linked.',
  INVALID_DOCUMENT: "That file is not one of this client's documents.",
  NOT_A_MEMBER: 'Choose an active member of your firm.',
  ORIGINAL_NOT_FILED: 'Only a filed return can be amended.',
  CLIENT_ARCHIVED: 'Restore the client first.',
  FORBIDDEN: "Your role can't do this. Ask an Owner or Admin.",
};

/** "T. Williams": the design's short name in lists. */
export const shortName = (m: MemberRef | null | undefined) => {
  if (!m) return null;
  const parts = m.name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(' ')}` : m.name;
};
export const dayText = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const numericDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
export const dateTimeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const today = () => new Date().toISOString().slice(0, 10);

export const card = 'rounded-xl bg-surface p-5 shadow-md';
export const primary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 font-semibold text-on-action hover:bg-gold-hover disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-5 font-semibold text-action hover:bg-accent-soft disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas px-3 py-2 text-sm text-muted';
export const linkText = 'font-medium text-link hover:underline';

/** A quiet line when a part of the page could not load. */
export function LoadError({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      <WarningCircle aria-hidden weight="fill" className="size-4 shrink-0" />
      {text}
    </p>
  );
}

/** The workflow's dot for a step that has not started. */
export const NotStartedDot = () => <Circle aria-hidden weight="fill" className="size-2" />;

type ActivityKind = TaxReturnActivityList['items'][number]['kind'];
/** The Activity timeline's icon and tile colour per kind of event. */
export const ACTIVITY_ICON: Record<ActivityKind, { icon: Icon; tone: TileTone }> = {
  CREATED: { icon: PlusCircle, tone: 'blue' },
  UPDATED: { icon: NotePencil, tone: 'grey' },
  STATUS: { icon: Swap, tone: 'purple' },
  ASSIGNED: { icon: UserSwitch, tone: 'blue' },
  CHECKLIST: { icon: ListChecks, tone: 'green' },
  VALIDATION: { icon: Seal, tone: 'green' },
  APPROVAL: { icon: CheckCircle, tone: 'green' },
  AUTHORIZATION: { icon: Signature, tone: 'amber' },
  FILING: { icon: FileText, tone: 'blue' },
  TRANSMISSION: { icon: PaperPlaneTilt, tone: 'navy' },
  DOCUMENT: { icon: FileText, tone: 'green' },
  ARCHIVED: { icon: Archive, tone: 'grey' },
  RESTORED: { icon: ArrowCounterClockwise, tone: 'blue' },
  OTHER: { icon: Circle, tone: 'grey' },
};
