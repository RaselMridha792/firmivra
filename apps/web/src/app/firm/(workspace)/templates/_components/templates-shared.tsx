import type { MessageTemplateKind, MessageTemplateStatus } from '@firmivra/types';
import { Badge, tileTones, type TileTone } from '@firmivra/ui';
import {
  CalendarPlus,
  ChartBar,
  ChatCircleDots,
  CheckSquare,
  ClipboardText,
  CurrencyDollar,
  EnvelopeSimple,
  FileText,
  FolderOpen,
  Megaphone,
  PaperPlaneTilt,
  PenNib,
  Receipt,
  Target,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';

/** Every query of the Templates module starts here: a change in one view refreshes the others. */
export const TEMPLATES_KEY = ['templates'] as const;

export interface KindMeta {
  kind: MessageTemplateKind;
  slug: string;
  /** "Email Templates" */
  title: string;
  /** "Email" */
  noun: string;
  blurb: string;
  icon: Icon;
  tone: TileTone;
}

/** The sixteen kinds, in the design's order; the sixteenth (Announcement) is the contract's own. */
export const KINDS: KindMeta[] = [
  {
    kind: 'EMAIL',
    slug: 'email',
    title: 'Email Templates',
    noun: 'Email',
    blurb: 'Professional emails for clients, leads, reminders and more.',
    icon: EnvelopeSimple,
    tone: 'blue',
  },
  {
    kind: 'SMS',
    slug: 'sms',
    title: 'SMS/Text Templates',
    noun: 'SMS',
    blurb: 'Quick, effective text messages for clients and leads.',
    icon: ChatCircleDots,
    tone: 'purple',
  },
  {
    kind: 'PORTAL_MESSAGE',
    slug: 'portal-message',
    title: 'Portal Message Templates',
    noun: 'Portal Message',
    blurb: 'Secure messages for the client portal.',
    icon: ChatCircleDots,
    tone: 'amber',
  },
  {
    kind: 'DOCUMENT_REQUEST',
    slug: 'document-request',
    title: 'Document Request Templates',
    noun: 'Document Request',
    blurb: 'Predefined document request lists by service type.',
    icon: FileText,
    tone: 'green',
  },
  {
    kind: 'INTAKE_ORGANIZER',
    slug: 'intake-organizer',
    title: 'Intake & Organizer Templates',
    noun: 'Intake & Organizer',
    blurb: 'Client intake forms and organizers.',
    icon: ClipboardText,
    tone: 'red',
  },
  {
    kind: 'ENGAGEMENT_AGREEMENT',
    slug: 'engagement-agreement',
    title: 'Engagement Agreement Templates',
    noun: 'Engagement Agreement',
    blurb: 'Tax, bookkeeping, payroll and advisory agreements.',
    icon: PenNib,
    tone: 'amber',
  },
  {
    kind: 'INVOICE_PAYMENT',
    slug: 'invoice-payment',
    title: 'Invoice & Payment Templates',
    noun: 'Invoice & Payment',
    blurb: 'Invoices, payment reminders, overdue notices and receipts.',
    icon: CurrencyDollar,
    tone: 'green',
  },
  {
    kind: 'APPOINTMENT',
    slug: 'appointment',
    title: 'Appointment Templates',
    noun: 'Appointment',
    blurb: 'Confirmations, reminders, rescheduling and follow-ups.',
    icon: CalendarPlus,
    tone: 'blue',
  },
  {
    kind: 'TASK',
    slug: 'task',
    title: 'Task Templates',
    noun: 'Task',
    blurb: 'Reusable task lists and workflow checklists.',
    icon: CheckSquare,
    tone: 'purple',
  },
  {
    kind: 'TAX_WORKFLOW',
    slug: 'tax-workflow',
    title: 'Tax Workflow Templates',
    noun: 'Tax Workflow',
    blurb: 'Standardized workflows for different return types.',
    icon: ChartBar,
    tone: 'blue',
  },
  {
    kind: 'BOOKKEEPING',
    slug: 'bookkeeping',
    title: 'Bookkeeping Templates',
    noun: 'Bookkeeping',
    blurb: 'Monthly checklists, document requests and report delivery messages.',
    icon: FolderOpen,
    tone: 'navy',
  },
  {
    kind: 'PAYROLL',
    slug: 'payroll',
    title: 'Payroll Templates',
    noun: 'Payroll',
    blurb: 'Payroll checklists, document requests and client notices.',
    icon: UsersThree,
    tone: 'red',
  },
  {
    kind: 'LEAD_FOLLOW_UP',
    slug: 'lead-follow-up',
    title: 'Lead Follow-Up Templates',
    noun: 'Lead Follow-Up',
    blurb: 'First contact, follow-ups, consultation reminders and nurture sequences.',
    icon: Target,
    tone: 'amber',
  },
  {
    kind: 'CAMPAIGN',
    slug: 'campaign',
    title: 'Communication/Campaign Templates',
    noun: 'Campaign',
    blurb: 'Newsletters, announcements, seasonal campaigns and office updates.',
    icon: PaperPlaneTilt,
    tone: 'blue',
  },
  {
    kind: 'LETTER_NOTICE',
    slug: 'letter-notice',
    title: 'Letters & Notices',
    noun: 'Letter & Notice',
    blurb: 'Professional client letters on your company letterhead.',
    icon: Receipt,
    tone: 'blue',
  },
  {
    kind: 'ANNOUNCEMENT',
    slug: 'announcement',
    title: 'Announcement Templates',
    noun: 'Announcement',
    blurb: 'Service announcements and office news.',
    icon: Megaphone,
    tone: 'green',
  },
];
export const kindOf = (kind: MessageTemplateKind) => KINDS.find((k) => k.kind === kind)!;
export const kindBySlug = (slug: string) => KINDS.find((k) => k.slug === slug);

/** Kinds that have a subject line, and kinds that can be test-sent. */
export const HAS_SUBJECT: MessageTemplateKind[] = [
  'EMAIL',
  'CAMPAIGN',
  'LETTER_NOTICE',
  'ANNOUNCEMENT',
];
export const AUTOMATION_KINDS: MessageTemplateKind[] = [
  'EMAIL',
  'SMS',
  'PORTAL_MESSAGE',
  'DOCUMENT_REQUEST',
  'APPOINTMENT',
  'INVOICE_PAYMENT',
  'LEAD_FOLLOW_UP',
  'BOOKKEEPING',
  'PAYROLL',
  'TASK',
];

export const STATUS_LABEL: Record<MessageTemplateStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};
export function StatusPill({ status }: { status: MessageTemplateStatus }) {
  return (
    <Badge tone={status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral'}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** The kind's tile: a soft square with its solid icon. */
export function KindTile({
  kind,
  size = 'md',
}: {
  kind: MessageTemplateKind;
  size?: 'sm' | 'md' | 'lg';
}) {
  const meta = kindOf(kind);
  const Glyph = meta.icon;
  const box = { sm: 'size-8', md: 'size-12', lg: 'size-20' }[size];
  const glyph = { sm: 'size-4', md: 'size-6', lg: 'size-10' }[size];
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-xl ${tileTones[meta.tone]}`}
    >
      <Glyph weight="fill" className={glyph} />
    </span>
  );
}

export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The API's template codes, in the firm's words. */
export const TEMPLATE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'This name is already used. Choose another.',
  SAVE_CONFLICT: 'Someone saved this template after you opened it. Reload and try again.',
  AUTOMATION_IN_USE: 'An automation uses this template.',
  CATEGORY_NOT_ALLOWED: 'That category does not fit this kind of template.',
  SUBJECT_REQUIRED: 'Add a subject line before activating this template.',
  NOT_AUTOMATION_ELIGIBLE: 'This kind of template cannot be used in automations.',
  NOT_A_MEMBER: 'That person is not on your team.',
  NOT_THE_OWNER: 'Only the owner can change this template.',
  TEMPLATE_ARCHIVED: 'Restore the template before changing it.',
  FIELD_IN_USE: 'Templates still use this field.',
  TEST_SEND_REFUSED: 'The test could not be sent.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';
export const fieldCls =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
