import type {
  IntegrationCategory,
  IntegrationConnectionStatus,
  IntegrationSyncDirection,
} from '@firmivra/types';
import { Badge, discTones } from '@firmivra/ui';
import {
  ArrowsLeftRight,
  CheckCircle,
  Clock,
  FileText,
  IdentificationBadge,
  Package,
  Receipt,
  Storefront,
  UsersThree,
  Wallet,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export const manageTabs = [
  { label: 'Overview', suffix: '' },
  { label: 'Sync Settings', suffix: '/sync-settings' },
  { label: 'Data Mapping', suffix: '/data-mapping' },
  { label: 'Permissions', suffix: '/permissions' },
  { label: 'Sync History', suffix: '/sync-history' },
  { label: 'Troubleshooting', suffix: '/troubleshooting' },
] as const;

export const entityIcons: Record<string, Icon> = {
  invoices: FileText,
  expenses: Receipt,
  customers: UsersThree,
  vendors: Storefront,
  chart_of_accounts: Wallet,
  products_services: Package,
  payments: Wallet,
  employees: IdentificationBadge,
};

export function statusLabel(status: IntegrationConnectionStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ');
}

/**
 * The provider's mark in the header: the kit has no provider logo set, so a solid disc in the
 * category's colour with the provider's initial (the design's QuickBooks disc is green).
 */
const CATEGORY_DISC: Record<IntegrationCategory, keyof typeof discTones> = {
  ACCOUNTING_FINANCE: 'green',
  PAYMENTS: 'purple',
  COMMUNICATION: 'blue',
  PRODUCTIVITY: 'blue',
  SCHEDULING: 'blue',
  DOCUMENT_MANAGEMENT: 'navy',
  CRM_LEADS: 'amber',
  E_SIGNATURE: 'navy',
  TAX_SOFTWARE: 'navy',
  PAYROLL_HR: 'amber',
  MARKETING: 'red',
  ECOMMERCE: 'green',
  CUSTOM: 'navy',
};
export const providerDisc = (category: IntegrationCategory) => discTones[CATEGORY_DISC[category]];

export function ConnectionBadge({
  status,
  large = false,
}: {
  status: IntegrationConnectionStatus;
  /** The header's bigger chip. */
  large?: boolean;
}) {
  const tone =
    status === 'CONNECTED' || status === 'SYNCING'
      ? 'success'
      : status === 'NEEDS_ATTENTION'
        ? 'danger'
        : status === 'PAUSED'
          ? 'warning'
          : 'neutral';
  const badge = (
    <Badge tone={tone} dot>
      {statusLabel(status)}
    </Badge>
  );
  return large ? (
    <span className="inline-flex [&>span]:gap-2 [&>span]:px-4 [&>span]:py-1.5 [&>span]:text-sm">
      {badge}
    </span>
  ) : (
    badge
  );
}

export function formatDirection(direction: IntegrationSyncDirection) {
  if (direction === 'TWO_WAY') return 'Two-way sync';
  if (direction === 'IMPORT') return 'Import to LVP Pro';
  return 'Export to provider';
}

export function formatFrequency(minutes: number | null) {
  if (!minutes) return 'Manual';
  if (minutes < 60) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(value: string | null) {
  return value ? fullDate.format(new Date(value)) : 'Not available';
}

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
/** "Today, 9:34 AM", "Yesterday, 6:03 AM" or "Oct 14, 7:45 AM" (Recent Sync Activity). */
export function shortTime(value: string) {
  const date = new Date(value);
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : monthDay.format(date);
  return `${day}, ${clock.format(date)}`;
}

/** A relative time inside a sentence: "in 52 minutes", "8 minutes ago". */
export const inSentence = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function relativeTime(value: string | null) {
  if (!value) return 'Not yet';
  const difference = new Date(value).getTime() - Date.now();
  const absoluteMinutes = Math.max(1, Math.round(Math.abs(difference) / 60_000));
  const amount = absoluteMinutes >= 60 ? Math.round(absoluteMinutes / 60) : absoluteMinutes;
  const unit =
    absoluteMinutes >= 60 ? (amount === 1 ? 'hour' : 'hours') : amount === 1 ? 'minute' : 'minutes';
  return difference < 0 ? `${amount} ${unit} ago` : `In ${amount} ${unit}`;
}

export function EmptyLine({ children }: { children: string }) {
  return <p className="py-3 text-sm text-muted">{children}</p>;
}

export function HealthIcon({ ok }: { ok: boolean }) {
  const Glyph = ok ? CheckCircle : Clock;
  return (
    <Glyph
      aria-hidden
      weight="fill"
      className={ok ? 'size-5 text-success' : 'size-5 text-warning'}
    />
  );
}

export function DirectionIcon() {
  return <ArrowsLeftRight aria-hidden weight="bold" className="size-4 text-action" />;
}

/** The design's card heading on every Manage tab: bold, larger than the kit Card's title. */
export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xl font-bold text-heading">{children}</h2>
      {action}
    </div>
  );
}
