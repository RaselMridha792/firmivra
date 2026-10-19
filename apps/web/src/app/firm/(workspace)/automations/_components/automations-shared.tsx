import type { AutomationModule, AutomationRunStatus, AutomationStatus } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  Briefcase,
  Calendar,
  CalendarCheck,
  ChartBar,
  CheckCircle,
  CheckSquare,
  Clock,
  CurrencyDollar,
  EnvelopeSimple,
  FileText,
  Folder,
  Gear,
  GraduationCap,
  Hourglass,
  PuzzlePiece,
  Receipt,
  Spinner,
  Target,
  UserCircle,
  UsersThree,
  Warning,
  XCircle,
  MinusCircle,
  type Icon,
} from '@phosphor-icons/react';

/** Every query of the Automations module starts here: a change in one view refreshes the others. */
export const AUTOMATIONS_KEY = ['automations'] as const;

export const MODULE_ICON: Record<AutomationModule, Icon> = {
  CLIENTS: UserCircle,
  LEADS: Target,
  APPOINTMENTS: Calendar,
  INTAKE_FORMS: FileText,
  DOCUMENTS: Folder,
  TAX_RETURNS: Receipt,
  BOOKKEEPING: ChartBar,
  PAYROLL: CurrencyDollar,
  TAX_PLANNING: GraduationCap,
  BUSINESS_ADVISORY: Briefcase,
  INVOICES_PAYMENTS: CurrencyDollar,
  COMMUNICATIONS: EnvelopeSimple,
  TASKS: CheckSquare,
  COMPLIANCE_DEADLINES: CalendarCheck,
  STAFF_MANAGEMENT: UsersThree,
  INTEGRATIONS: PuzzlePiece,
  CUSTOM: Gear,
};

export const RULE_STATUS_LABEL: Record<AutomationStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  ARCHIVED: 'Archived',
};
export const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  SUCCESS: 'Success',
  PARTIAL_SUCCESS: 'Partial',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};
const RUN_LOOK = {
  PENDING: { tone: 'info', icon: Clock },
  RUNNING: { tone: 'info', icon: Spinner },
  SUCCESS: { tone: 'success', icon: CheckCircle },
  PARTIAL_SUCCESS: { tone: 'warning', icon: Warning },
  FAILED: { tone: 'danger', icon: XCircle },
  SKIPPED: { tone: 'warning', icon: MinusCircle },
} as const;
export function RunStatusPill({ status }: { status: AutomationRunStatus }) {
  const look = RUN_LOOK[status];
  return (
    <span className="whitespace-nowrap">
      <Badge tone={look.tone} icon={look.icon}>
        {RUN_STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}
export function RuleStatusPill({ status }: { status: AutomationStatus }) {
  const tone = {
    DRAFT: 'neutral',
    ACTIVE: 'success',
    PAUSED: 'warning',
    ARCHIVED: 'neutral',
  } as const;
  const icon = {
    DRAFT: Clock,
    ACTIVE: CheckCircle,
    PAUSED: Hourglass,
    ARCHIVED: MinusCircle,
  } as const;
  return (
    <span className="whitespace-nowrap">
      <Badge tone={tone[status]} icon={icon[status]}>
        {RULE_STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const seconds = (ms: number | null) =>
  ms === null ? '—' : `${Math.max(1, Math.round(ms / 1000))}s`;
export const hoursText = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;

/** The API's automation codes, in the firm's words. */
export const AUTOMATION_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'This name is already used. Choose another.',
  SAVE_CONFLICT: 'Someone saved this rule after you opened it. Reload and try again.',
  NOT_READY: 'This rule is not ready to turn on. Fix the checks first.',
  RULE_ARCHIVED: 'Restore the rule before changing it.',
  INVALID_STATUS: 'The rule is not in a state where that can happen.',
  INVALID_DEFINITION: 'The rule’s steps do not fit together. Check them and try again.',
  RERUN_NOT_ALLOWED: 'This run cannot be re-run.',
  INTEGRATION_INACTIVE: 'Connect the integration first.',
  NOT_A_MEMBER: 'That person is not on your team.',
  TOO_MANY_ROWS: 'Too many rows to export. Narrow the filters.',
  TEMPLATE_UNAVAILABLE: 'That template is not available.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const filled =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-medium text-on-action hover:bg-action-hover disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';

export function Selectbox({
  value,
  onChange,
  options,
  id,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={field}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
