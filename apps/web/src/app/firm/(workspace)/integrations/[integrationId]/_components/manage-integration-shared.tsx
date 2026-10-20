import type { IntegrationConnectionStatus, IntegrationSyncDirection } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
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

export function ConnectionBadge({ status }: { status: IntegrationConnectionStatus }) {
  const tone =
    status === 'CONNECTED' || status === 'SYNCING'
      ? 'success'
      : status === 'NEEDS_ATTENTION'
        ? 'danger'
        : status === 'PAUSED'
          ? 'warning'
          : 'neutral';
  return (
    <Badge tone={tone} dot>
      {statusLabel(status)}
    </Badge>
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
  return <ArrowsLeftRight aria-hidden weight="fill" className="size-4 text-action" />;
}
