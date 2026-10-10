import type { ClientAccountStatus, ClientAccountType } from '@firmivra/types';
import { Badge } from '@firmivra/ui';

/** Every clients query starts with this key, so a change refetches the list and the record. */
export const CLIENTS = ['clients'] as const;
export const clientKey = (id: string) => [...CLIENTS, 'record', id] as const;

export const ACCOUNT_TYPES: Record<ClientAccountType, string> = {
  INDIVIDUAL: 'Individual',
  BUSINESS: 'Business',
};

/** The clients API's own codes, in the words the firm's staff see. */
export const CLIENT_ERRORS: Record<string, string> = {
  DUPLICATE_EMAIL: 'Another client of your firm already uses this email.',
  CLIENT_ARCHIVED: 'This client is archived. Restore the client to make changes.',
};

/** A US number as (770) 555-0123; any other number as it is. */
export function formatPhone(value: string | null | undefined) {
  const us = value?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : value;
}

export const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });

const PORTAL: Record<
  ClientAccountStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  ACTIVE: { label: 'Portal active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'info' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  DISABLED: { label: 'Portal off', tone: 'neutral' },
};

/** The client's portal login at a glance; "No portal login" when the firm added them itself. */
export function PortalBadge({ status }: { status: ClientAccountStatus | null }) {
  if (!status) return <Badge>No portal login</Badge>;
  const { label, tone } = PORTAL[status];
  return <Badge tone={tone}>{label}</Badge>;
}
