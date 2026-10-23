import type { Prisma, TxClient } from '@firmivra/db';
import type { AdminActivityItem, AdminActivityTone } from '@firmivra/types';

// Audit rows as the screens' activity rows (Settings > Overview's Recent Administrative Activity,
// Settings > Locations' Recent Location Activity): the screen's words and a tone, never a person's
// name or anything from the row's metadata but ids. A location's own name (not personal data) is
// added where the row is about one.

/** The rows an activity list leaves out: reads, and the sign-in machinery's bookkeeping. */
export const NOT_ACTIVITY: Prisma.AuditLogWhereInput = {
  NOT: [
    { action: { startsWith: 'auth.' } },
    { action: { endsWith: '_viewed' } },
    { action: { endsWith: '.viewed' } },
    { action: { endsWith: '.listed' } },
    { action: { endsWith: '_listed' } },
    { action: { endsWith: '.read' } },
    { action: { endsWith: '.searched' } },
    { action: { endsWith: '.previewed' } },
    { action: { endsWith: '_previewed' } },
    { action: { endsWith: '.downloaded' } },
  ],
};

const LABELS: Record<string, [string, AdminActivityTone]> = {
  'firm_office.created': ['Location added', 'success'],
  'firm_office.updated': ['Location details updated', 'info'],
  'firm_office.primary_set': ['Primary location set', 'info'],
  'firm_office.activated': ['Location activated', 'success'],
  'firm_office.deactivated': ['Location deactivated', 'warning'],
  'firm_office.manager_reassigned': ['Location manager changed', 'user'],
  'firm_office.staff_set': ['Assigned staff updated', 'user'],
  'firm_office.photo_set': ['Location photo updated', 'info'],
  'firm_office.photo_removed': ['Location photo removed', 'info'],
  'firm_office_action.updated': ['Scheduled change edited', 'info'],
  'firm_office_action.cancelled': ['Scheduled change cancelled', 'warning'],
  'firm_office_action.failed': ['Scheduled change failed', 'warning'],
  'settings.updated': ['Company settings updated', 'info'],
  'branding.updated': ['Branding settings updated', 'info'],
  'branding.asset_uploaded': ['Branding image updated', 'info'],
  'branding.asset_removed': ['Branding image removed', 'info'],
  'branding.reset': ['Branding reset to defaults', 'info'],
  'membership.invited': ['New staff user invited', 'user'],
  'membership.activated': ['Staff user joined', 'user'],
  'staff.created': ['New staff user added', 'user'],
  'staff.joined': ['Staff user joined', 'user'],
  'membership.deactivated': ['Staff user deactivated', 'warning'],
  'membership.role_changed': ['Staff role changed', 'warning'],
  'staff.reactivated': ['Staff user reactivated', 'user'],
  'staff.locked': ['Staff account locked', 'warning'],
  'staff.unlocked': ['Staff account unlocked', 'user'],
  'staff.mfa_reset': ['Staff MFA reset', 'warning'],
  'staff.permissions_saved': ['Staff permissions changed', 'warning'],
  'staff.security_saved': ['Staff security settings changed', 'warning'],
};

/** What a scheduled Locations change is, in the screen's words. */
const ACTION_KINDS: Record<string, string> = {
  DEACTIVATE_LOCATION: 'Location deactivation',
  REASSIGN_MANAGER: 'Manager change',
  DEACTIVATE_MANAGER: 'Manager deactivation',
};

const humanize = (action: string) =>
  action
    .replace(/[._]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

const toneOf = (action: string): AdminActivityTone => {
  if (/(created|added|invited|joined|activated|completed|done)$/.test(action)) return 'success';
  if (/(deactivated|removed|deleted|archived|locked|failed|revoked|cancelled|reset)$/.test(action))
    return 'warning';
  if (/(updated|saved|changed|set)$/.test(action)) return 'info';
  return 'system';
};

export interface ActivityRow {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
}

const metaString = (metadata: unknown, key: string): string | null => {
  const value = (metadata as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
};

/** The location a row is about: its entity, or (an action's row) the officeId it names. */
export const officeOfRow = (row: ActivityRow): string | null =>
  row.entityType === 'firm_office' ? row.entityId : metaString(row.metadata, 'officeId');

/** One audit row as an activity row; `officeNames` gives the location's name by id. */
export function activityItem(
  row: ActivityRow,
  officeNames: ReadonlyMap<string, string> = new Map(),
): AdminActivityItem {
  const known: [string, AdminActivityTone] = LABELS[row.action] ?? [
    humanize(row.action),
    toneOf(row.action),
  ];
  let label = known[0];
  let tone = known[1];
  const kind = ACTION_KINDS[metaString(row.metadata, 'kind') ?? ''];
  if (kind) {
    if (row.action === 'firm_office_action.scheduled') {
      label = `${kind} scheduled`;
      tone = 'info';
    }
    if (row.action === 'firm_office_action.done') {
      label = `${kind} completed`;
      tone = 'success';
    }
    if (row.action === 'firm_office_action.failed') label = `${kind} failed`;
    if (row.action === 'firm_office_action.cancelled') label = `${kind} cancelled`;
    if (row.action === 'firm_office_action.updated') label = `${kind} rescheduled`;
  }
  if (
    row.action === 'firm_office.manager_reassigned' &&
    (row.metadata as { acting?: unknown } | null)?.acting === true
  )
    label = 'Main location manager acting';
  const office = officeOfRow(row);
  const name = office ? officeNames.get(office) : undefined;
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    label: name ? `${label} - ${name}` : label,
    tone,
  };
}

/** The names of the locations these rows are about (archived ones included: history stays). */
export async function officeNamesOf(
  tx: TxClient,
  businessId: string,
  rows: readonly ActivityRow[],
): Promise<Map<string, string>> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [
    ...new Set(rows.map(officeOfRow).filter((id): id is string => !!id && UUID.test(id))),
  ];
  if (!ids.length) return new Map();
  const offices = await tx.firmOffice.findMany({
    where: { businessId, id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(offices.map((o) => [o.id, o.name]));
}
