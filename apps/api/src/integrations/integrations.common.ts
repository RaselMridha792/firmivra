import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  IntegrationCardStatus,
  IntegrationConnectionSummary,
  IntegrationErrorCode,
  IntegrationIssueCode,
  IntegrationProvider,
  IntegrationSyncRun,
} from '@firmivra/types';
import { roleCan } from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';
import { isGridFirmRole } from '@firmivra/types';

const refusal = (code: IntegrationErrorCode, message: string) =>
  new ConflictException({ code, message });

export const integrationErrors = {
  alreadyConnected: (name: string) => refusal('ALREADY_CONNECTED', `${name} is already connected`),
  notSupported: (message: string) => refusal('NOT_SUPPORTED', message),
  notConnected: () =>
    refusal('NOT_CONNECTED', 'This integration is not connected. Reconnect it first.'),
  syncInProgress: () => refusal('SYNC_IN_PROGRESS', 'A sync is already running'),
  alreadyPaused: (paused: boolean) =>
    refusal('ALREADY_PAUSED', paused ? 'Auto sync is already paused' : 'Auto sync is not paused'),
  invalidConfiguration: (message: string) => refusal('INVALID_CONFIGURATION', message),
  comingSoon: (name: string) =>
    refusal('COMING_SOON', `${name} is not available for connection yet`),
  credentialsRejected: () =>
    new BadRequestException({
      code: 'CREDENTIALS_REJECTED',
      message: 'The provider did not accept those credentials. Nothing was saved.',
    }),
  authorizationFailed: () =>
    new BadRequestException({
      code: 'AUTHORIZATION_FAILED',
      message: 'The authorization could not be completed. Try again.',
    }),
  providerUnavailable: () =>
    new ServiceUnavailableException({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'The provider cannot be reached right now. Try again in a moment.',
      retryAfter: 30,
    }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

/**
 * Who may connect, configure, sync and disconnect: Owner and Admin always; a grid role only with
 * the Edit capability on Integrations (Manager and the others have none by default). The legacy
 * Staff role, which passes `@Roles(...FIRM_STAFF)` on every route, never does.
 */
export function canManageIntegrations(tenant: TenantContext | undefined): boolean {
  if (tenant?.kind !== 'staff') return false;
  if (tenant.role === 'OWNER' || tenant.role === 'ADMIN') return true;
  return isGridFirmRole(tenant.role) && roleCan(tenant.role, 'INTEGRATIONS', 'EDIT');
}

/** 403 unless the caller may manage integrations. */
export function requireManage(tenant: TenantContext | undefined): void {
  if (!canManageIntegrations(tenant)) throw integrationErrors.forbidden();
}

const REASONS: Record<
  string,
  {
    issue: IntegrationIssueCode;
    message: string;
    action: IntegrationConnectionSummary['statusAction'];
  }
> = {
  authorization_expired: {
    issue: 'AUTHORIZATION_EXPIRED',
    message: 'Authorization expired',
    action: 'RECONNECT',
  },
  authorization_revoked: {
    issue: 'AUTHORIZATION_REVOKED',
    message: 'Access was revoked at the provider',
    action: 'RECONNECT',
  },
  permission_missing: {
    issue: 'PERMISSION_MISSING',
    message: 'A required permission is missing',
    action: 'FIX_PERMISSIONS',
  },
  sync_failed: { issue: 'SYNC_FAILED', message: 'Syncs keep failing', action: 'VIEW_HISTORY' },
  provider_outage: {
    issue: 'PROVIDER_OUTAGE',
    message: 'The provider is unavailable',
    action: 'RETRY',
  },
  rate_limited: {
    issue: 'RATE_LIMITED',
    message: 'The provider is limiting requests',
    action: 'RETRY',
  },
  configuration_incomplete: {
    issue: 'CONFIGURATION_INCOMPLETE',
    message: 'Setup is not finished',
    action: 'RECONNECT',
  },
};

export const reasonInfo = (reason: string | null) =>
  reason
    ? (REASONS[reason] ?? {
        issue: 'SYNC_FAILED' as const,
        message: 'Needs attention',
        action: 'VIEW_HISTORY' as const,
      })
    : null;

export interface ConnectionRow {
  id: string;
  provider: string;
  environment: 'LIVE' | 'TEST';
  status: 'CONNECTED' | 'SYNCING' | 'NEEDS_ATTENTION' | 'PAUSED' | 'DISCONNECTED';
  statusReason: string | null;
  accountLabel: string | null;
  direction: 'IMPORT' | 'EXPORT' | 'TWO_WAY';
  syncMode: 'AUTO' | 'MANUAL';
  syncEveryMinutes: number | null;
  connectedAt: Date;
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
}

export function toSummary(c: ConnectionRow): IntegrationConnectionSummary {
  const info = c.status === 'NEEDS_ATTENTION' ? reasonInfo(c.statusReason) : null;
  return {
    id: c.id,
    provider: c.provider,
    environment: c.environment,
    status: c.status,
    issue: info?.issue ?? null,
    statusMessage: info?.message ?? null,
    statusAction: info?.action ?? null,
    accountLabel: c.accountLabel,
    direction: c.direction,
    syncMode: c.syncMode,
    syncEveryMinutes: c.syncEveryMinutes,
    connectedAt: c.connectedAt.toISOString(),
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    nextSyncAt: c.nextSyncAt?.toISOString() ?? null,
  };
}

const ORDER: IntegrationCardStatus[] = [
  'NEEDS_ATTENTION',
  'SYNCING',
  'CONNECTED',
  'PAUSED',
  'DISCONNECTED',
  'AVAILABLE',
];
/** The card's status: the most urgent of its connections' (none: AVAILABLE). */
export function cardStatus(
  connections: { status: IntegrationCardStatus }[],
): IntegrationCardStatus {
  for (const s of ORDER) if (connections.some((c) => c.status === s)) return s;
  return 'AVAILABLE';
}

/** Frameworks and custom connections are "Configure" before they are connected. */
export const configureFirst = (p: Pick<IntegrationProvider, 'category'>) =>
  p.category === 'CUSTOM' || p.category === 'TAX_SOFTWARE' || p.category === 'PAYROLL_HR';

export function cardAction(
  status: IntegrationCardStatus,
  provider: Pick<IntegrationProvider, 'category'>,
): 'CONNECT' | 'CONFIGURE' | 'MANAGE' | 'RECONNECT' | 'RESUME' {
  if (status === 'CONNECTED' || status === 'SYNCING') return 'MANAGE';
  if (status === 'NEEDS_ATTENTION') return 'RECONNECT';
  if (status === 'PAUSED') return 'RESUME';
  return configureFirst(provider) ? 'CONFIGURE' : 'CONNECT';
}

/** The connection type shown on the Manage page. */
export const connectionTypeOf = (p: Pick<IntegrationProvider, 'authMethod'>) =>
  p.authMethod === 'OAUTH2'
    ? 'OAuth 2.0 (Secure)'
    : p.authMethod === 'API_KEY'
      ? 'API key (stored encrypted)'
      : p.authMethod === 'PROVIDER_LINK'
        ? 'Provider link (Secure)'
        : 'Built in';

export const maskLast4 = (last4: string | null) => (last4 ? `•••• ${last4}` : null);

const ENTITY_LABELS = new Map<string, string>([
  ['test', 'Connection test'],
  ['webhook', 'Webhook'],
]);
export function entityLabelOf(provider: IntegrationProvider | undefined, entity: string): string {
  return (
    ENTITY_LABELS.get(entity) ??
    provider?.entities.find((e) => e.key === entity)?.label ??
    entity.charAt(0).toUpperCase() + entity.slice(1)
  );
}

export interface RunRow {
  id: string;
  entity: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL';
  manual: boolean;
  requestedByUserId: string | null;
  recordCount: number;
  failedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export function toRun(
  r: RunRow,
  provider: IntegrationProvider | undefined,
  names: Map<string, string>,
): IntegrationSyncRun {
  const name = r.requestedByUserId ? names.get(r.requestedByUserId) : undefined;
  return {
    id: r.id,
    entity: r.entity,
    entityLabel: entityLabelOf(provider, r.entity),
    status: r.status,
    manual: r.manual,
    requestedBy:
      r.requestedByUserId && name !== undefined ? { userId: r.requestedByUserId, name } : null,
    recordCount: r.recordCount,
    failedCount: r.failedCount,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Plain steps for a failed run (the "useful error details"). */
export function guidanceFor(errorCode: string | null): string[] {
  switch (errorCode) {
    case 'authorization_expired':
    case 'authorization_revoked':
      return ['Reconnect the integration to renew the authorization.'];
    case 'permission_missing':
      return ['Reconnect and approve every permission the integration asks for.'];
    case 'provider_outage':
    case 'rate_limited':
      return ['The provider is busy or down. The next sync will try again, or run Sync Now later.'];
    case 'credentials_rejected':
      return ['Update the connection with valid credentials.'];
    case null:
      return [];
    default:
      return ['Run the connection test, then Sync Now. If it keeps failing, contact support.'];
  }
}
