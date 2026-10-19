'use client';

import { Badge, tileTones, type TileTone } from '@firmivra/ui';
import {
  ChatCircleDots,
  CheckCircle,
  Clock,
  Cloud,
  CreditCard,
  EnvelopeSimple,
  House,
  PencilSimple,
  Plugs,
  Prohibit,
  Robot,
  ShieldCheck,
  Signature,
  Trash,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import {
  CATALOG_STATUS_LABELS,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  LOG_SEVERITY_LABELS,
  RUN_STATUS_LABELS,
  STATUS_LABELS,
  type CatalogStatus,
  type DeliveryStatus,
  type IntegrationCategory,
  type IntegrationEnvironment,
  type IntegrationStatus,
  type LogSeverity,
  type RunStatus,
} from '../../../../../mocks/admin-integrations';

/**
 * Shared badges and marks of the Integrations pages: the status pills (docx §11: green Active,
 * amber Needs Attention, red Error, grey Inactive/Disabled), the environment badge, the category
 * pill and icon, and the service mark that stands in for a provider's logo.
 */

/** One solid icon per category (the setup design's "Common Integration Categories"). */
export const CATEGORY_ICONS: Record<IntegrationCategory, Icon> = {
  PAYMENTS_BILLING: CreditCard,
  COMMUNICATION: ChatCircleDots,
  EMAIL: EnvelopeSimple,
  CLOUD_STORAGE: Cloud,
  AI_AUTOMATION: Robot,
  MLS_DATA: House,
  ESIGN: Signature,
  SECURITY_INFRASTRUCTURE: ShieldCheck,
  OTHER: Plugs,
};
/** The tile colour of each category's service mark. */
export const CATEGORY_TONES: Record<IntegrationCategory, TileTone> = {
  PAYMENTS_BILLING: 'purple',
  COMMUNICATION: 'red',
  EMAIL: 'blue',
  CLOUD_STORAGE: 'amber',
  AI_AUTOMATION: 'navy',
  MLS_DATA: 'navy',
  ESIGN: 'green',
  SECURITY_INFRASTRUCTURE: 'amber',
  OTHER: 'grey',
};

/** The category as the dashboard design shows it: a soft blue-grey pill. */
export function CategoryPill({ category }: { category: IntegrationCategory }) {
  return (
    <span className="inline-flex rounded-md bg-folder-surface px-2.5 py-1 text-xs whitespace-nowrap text-heading">
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/**
 * The square mark before a service's name. Provider logos are not in the repo (and an uploaded
 * logo is metadata only in the mock), so it shows the category's icon on its tile colour.
 */
export function ServiceLogo({
  category,
  size = 'md',
}: {
  category: IntegrationCategory;
  /** `sm` 32px (lists), `md` 40px, `lg` 64px (the manage page header). */
  size?: 'sm' | 'md' | 'lg';
}) {
  const Glyph = CATEGORY_ICONS[category];
  const box = { sm: 'size-8 rounded-md', md: 'size-10 rounded-lg', lg: 'size-16 rounded-xl' }[size];
  const glyph = { sm: 'size-4.5', md: 'size-5.5', lg: 'size-9' }[size];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${box} ${tileTones[CATEGORY_TONES[category]]}`}
    >
      <Glyph weight="fill" className={glyph} />
    </span>
  );
}

const STATUS_LOOK: Record<
  IntegrationStatus,
  { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; icon?: Icon }
> = {
  ACTIVE: { tone: 'success' },
  NEEDS_ATTENTION: { tone: 'warning', icon: WarningCircle },
  ERROR: { tone: 'danger', icon: XCircle },
  INACTIVE: { tone: 'neutral' },
  DISABLED: { tone: 'neutral', icon: Prohibit },
  DRAFT: { tone: 'info', icon: PencilSimple },
  REMOVED: { tone: 'neutral', icon: Trash },
};
/** A platform integration's status: a dot for Active and Inactive, an icon for the rest. */
export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <Badge tone={look.tone} dot={!look.icon} icon={look.icon}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const CATALOG_LOOK = {
  ENABLED: { tone: 'success', icon: CheckCircle },
  DISABLED: { tone: 'neutral', icon: Prohibit },
  COMING_SOON: { tone: 'purple', icon: Clock },
} as const;
/** A catalog entry's availability (Coming Soon is catalog-only, never a platform status). */
export function CatalogStatusBadge({ status }: { status: CatalogStatus }) {
  const look = CATALOG_LOOK[status];
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {CATALOG_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Live or Test. `text`: plain words, as the dashboard table shows it; `badge`: the manage page's
 * green Live pill (Test in amber, so the two never look alike).
 */
export function EnvironmentBadge({
  environment,
  variant = 'badge',
}: {
  environment: IntegrationEnvironment;
  variant?: 'badge' | 'text';
}) {
  if (variant === 'text')
    return <span className="text-text">{ENVIRONMENT_LABELS[environment]}</span>;
  return (
    <Badge tone={environment === 'LIVE' ? 'success' : 'warning'} dot>
      {ENVIRONMENT_LABELS[environment]}
    </Badge>
  );
}

const SEVERITY_TONES = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'danger',
  CRITICAL: 'danger',
} as const;
/** A log record's severity. */
export function LogSeverityBadge({ severity }: { severity: LogSeverity }) {
  return (
    <Badge
      tone={SEVERITY_TONES[severity]}
      icon={severity === 'CRITICAL' ? WarningCircle : undefined}
    >
      {LOG_SEVERITY_LABELS[severity]}
    </Badge>
  );
}

/** Success or Failed (a log record's or a test's outcome). */
export function OutcomeBadge({ succeeded }: { succeeded: boolean }) {
  return (
    <Badge tone={succeeded ? 'success' : 'danger'} dot>
      {succeeded ? 'Success' : 'Failed'}
    </Badge>
  );
}

const RUN_TONES = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
} as const;
/** A sync or test run's result. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge tone={RUN_TONES[status]} dot>
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}

const DELIVERY_LOOK = {
  PENDING: { tone: 'neutral', label: 'Pending' },
  SUCCEEDED: { tone: 'success', label: 'Delivered' },
  FAILED: { tone: 'danger', label: 'Failed' },
} as const;
/** A webhook delivery's result. */
export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const look = DELIVERY_LOOK[status];
  return (
    <Badge tone={look.tone} dot>
      {look.label}
    </Badge>
  );
}

/** The small coloured dot before an activity line: green, amber or red by severity. */
export function ActivityDot({
  severity,
  succeeded,
}: {
  severity: LogSeverity;
  succeeded: boolean;
}) {
  const look =
    !succeeded || severity === 'ERROR' || severity === 'CRITICAL'
      ? { Glyph: XCircle, className: 'text-danger', label: 'Failed' }
      : severity === 'WARNING'
        ? { Glyph: WarningCircle, className: 'text-gold', label: 'Warning' }
        : { Glyph: CheckCircle, className: 'text-success', label: 'Success' };
  return (
    <>
      <look.Glyph aria-hidden weight="fill" className={`size-4 shrink-0 ${look.className}`} />
      <span className="sr-only">{look.label}: </span>
    </>
  );
}
