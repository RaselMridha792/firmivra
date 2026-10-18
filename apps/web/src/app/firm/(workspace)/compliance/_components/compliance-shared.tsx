import type { ComplianceDisplayStatus, DeadlineType, TaskPriority } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  CheckCircle,
  Clock,
  Flag,
  Hourglass,
  Prohibit,
  Spinner,
  Warning,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Every query of the Compliance module starts here: a change in one view refreshes the others. */
export const COMPLIANCE_KEY = ['compliance'] as const;

export const TYPE_LABEL: Record<DeadlineType, string> = {
  TAX_FILING: 'Tax Filing',
  ESTIMATED_TAX: 'Estimated Tax',
  ELECTION: 'Election',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  SALES_TAX: 'Sales Tax',
  STATE_FILING: 'State Filing',
  ANNUAL_REPORT: 'Annual Report',
  LICENSE_PERMIT: 'License / Permit',
  ADVISORY: 'Advisory',
  OTHER: 'Other',
};
export const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as DeadlineType[]).map((value) => ({
  value,
  label: TYPE_LABEL[value],
}));

export const STATUS_LABEL: Record<ComplianceDisplayStatus, string> = {
  UPCOMING: 'Upcoming',
  DUE_SOON: 'Due Soon',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_CLIENT: 'Waiting on Client',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed',
  NOT_APPLICABLE: 'Not Applicable',
  CANCELLED: 'Cancelled',
};
export const SOURCE_LABEL = {
  GOVERNMENT: 'Government / Statutory',
  FIRM: 'Firm / Internal',
  CLIENT_SPECIFIC: 'Client-Specific',
  IMPORTED: 'Imported',
} as const;
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
export const FAMILY_LABEL = {
  IRS_GENERAL: 'IRS General',
  IRS_EMPLOYER: 'IRS Employer',
  STATE_INCOME_FRANCHISE: 'State Income / Franchise',
  SECRETARY_OF_STATE: 'Secretary of State',
  SALES_USE_TAX: 'Sales & Use Tax',
  PAYROLL_WITHHOLDING: 'Payroll / Withholding',
  LOCAL_BUSINESS_LICENSE: 'Local Business License',
  PROFESSIONAL_LICENSE: 'Professional License',
  FIRM_INTERNAL: 'Firm Internal',
} as const;

/** The chart colour of each deadline type (the kit's chart tones). */
export const TYPE_TONE = {
  TAX_FILING: 'blue',
  ESTIMATED_TAX: 'green',
  ELECTION: 'purple',
  BOOKKEEPING: 'yellow',
  PAYROLL: 'red',
  SALES_TAX: 'navy',
  STATE_FILING: 'blue',
  ANNUAL_REPORT: 'purple',
  LICENSE_PERMIT: 'grey',
  ADVISORY: 'green',
  OTHER: 'grey',
} as const satisfies Record<DeadlineType, string>;

const STATUS_LOOK = {
  UPCOMING: { tone: 'info', icon: Clock },
  DUE_SOON: { tone: 'warning', icon: Hourglass },
  IN_PROGRESS: { tone: 'success', icon: Spinner },
  WAITING_ON_CLIENT: { tone: 'warning', icon: Hourglass },
  OVERDUE: { tone: 'danger', icon: Warning },
  COMPLETED: { tone: 'success', icon: CheckCircle },
  NOT_APPLICABLE: { tone: 'neutral', icon: Prohibit },
  CANCELLED: { tone: 'neutral', icon: Prohibit },
} as const;

export function StatusPill({ status }: { status: ComplianceDisplayStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span className="whitespace-nowrap">
      <Badge tone={look.tone} icon={look.icon}>
        {STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}

export function PriorityPill({ priority }: { priority: TaskPriority }) {
  return (
    <Badge
      tone={priority === 'HIGH' ? 'danger' : priority === 'MEDIUM' ? 'info' : 'success'}
      icon={Flag}
    >
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

/** "Oct 5, 2026" from a calendar date. */
export const dayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const timeText = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The API's compliance codes, in the firm's words. */
export const COMPLIANCE_ERRORS: Record<string, string> = {
  NOT_A_MEMBER: 'That person is not on your team.',
  CLIENT_NOT_ASSIGNED: 'You are not assigned to that client.',
  DEADLINE_STATE: 'This deadline is closed. Reopen it first.',
  OVERRIDE_REASON_REQUIRED: 'Give a reason for changing the statutory date.',
  OVERRIDE_NOT_ALLOWED: 'You cannot change a statutory date.',
  NOT_THIS_CLIENTS: 'Only this client’s deadlines can be linked.',
  DUPLICATE: 'That already exists. Choose another name or date.',
  TEMPLATE_NOT_FOUND: 'That task template was not found.',
  CALENDAR_STATE: 'This calendar cannot be changed in its current state.',
  ENTRIES_NEED_VERIFICATION: 'Some entries still need a verified date.',
  NO_ENTRIES: 'The calendar has no entries.',
  RECURRENCE_STATE: 'This recurring deadline cannot be changed in its current state.',
  DUE_DATE_REQUIRED: 'Choose a due date.',
  SUGGESTION_STATE: 'This suggestion is already decided.',
  RULE_INACTIVE: 'Turn the rule on first.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const outlined =
  'inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft';
export const subtle =
  'inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const filled =
  'inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-base font-medium text-on-action hover:bg-action-hover disabled:opacity-50';

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

export function Section({
  step,
  title,
  subtitle,
  aside,
  children,
  testId,
}: {
  step?: number;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {step ? (
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
            >
              {step}
            </span>
          ) : null}
          <div>
            <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
            {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const Label = ({
  text,
  required,
  children,
  htmlFor,
  error,
}: {
  text: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  error?: string | undefined;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm font-medium text-text">
      {text}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
    {children}
    {error ? <p className="text-xs text-danger">{error}</p> : null}
  </div>
);

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Monthly on the 15th", "Quarterly, 1 month after quarter end on the 30th"... */
export function frequencyText(r: {
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM' | 'AUTHORITY_DEFINED';
  interval: number | null;
  repeatRule: object;
}): string {
  const rule = r.repeatRule as Record<string, number | undefined>;
  const dayRule = rule['nth']
    ? `the ${ordinal(rule['nth'])} ${WEEKDAY[rule['weekday'] ?? 1]}`
    : `the ${ordinal(rule['dayOfMonth'] ?? 15)}`;
  if (r.frequency === 'MONTHLY') return `Monthly on ${dayRule}`;
  if (r.frequency === 'CUSTOM') return `Every ${r.interval ?? 1} months on ${dayRule}`;
  if (r.frequency === 'QUARTERLY') {
    const after = rule['monthsAfterQuarterEnd'] ?? 0;
    return `Quarterly, ${after === 0 ? 'in the quarter-end month' : `${after} month${after === 1 ? '' : 's'} after quarter end`}, on the ${ordinal(rule['dayOfMonth'] ?? 15)}`;
  }
  if (r.frequency === 'ANNUAL') {
    return `Annually on ${MONTH[(rule['month'] ?? 1) - 1]} ${rule['day'] ?? 1}`;
  }
  return 'Follows the authority’s calendar';
}

export const today = () => isoDay(new Date());
export const RECURRENCE_TONE = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ENDED: 'neutral',
  ARCHIVED: 'neutral',
} as const;
