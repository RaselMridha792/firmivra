import type { IntegrationConnectionStatus, IntegrationSyncDirection } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  FileText,
  IdentificationBadge,
  Package,
  Receipt,
  Storefront,
  UsersThree,
  Wallet,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

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

export function relativeTime(value: string | null) {
  if (!value) return 'Not yet';
  const difference = new Date(value).getTime() - Date.now();
  const absoluteMinutes = Math.max(1, Math.round(Math.abs(difference) / 60_000));
  const amount = absoluteMinutes >= 60 ? Math.round(absoluteMinutes / 60) : absoluteMinutes;
  const unit =
    absoluteMinutes >= 60 ? (amount === 1 ? 'hour' : 'hours') : amount === 1 ? 'minute' : 'minutes';
  return difference < 0 ? `${amount} ${unit} ago` : `In ${amount} ${unit}`;
}
