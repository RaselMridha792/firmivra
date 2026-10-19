'use client';

import {
  CheckCircle,
  Clock,
  MinusCircle,
  PencilSimple,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import {
  CATEGORY_LABELS,
  SETUP_STEPS,
  type IntegrationCategory,
  type PlatformIntegration,
} from '../../_components/integrations-contract';
import { IntegrationStatusBadge } from '../../_components/integration-badges';
import { formatDate, formatTime, uptimeText } from '../../_components/integration-format';

/**
 * The cells of the platform integrations list (docx §3): the category tag, the status with its
 * health line (the latest test, or why it needs attention), the last sync with the uptime, and
 * who changed it last. Never a credential (docx §2: no secrets in the list).
 */

/** The dashboard's soft category pill, allowed to wrap so the list fits at 1440 px. */
export function CategoryTag({ category }: { category: IntegrationCategory }) {
  return (
    <span className="inline-flex max-w-32 rounded-md bg-folder-surface px-2.5 py-1 text-xs text-heading">
      {CATEGORY_LABELS[category]}
    </span>
  );
}

interface HealthLine {
  text: string;
  tone: string;
  icon: Icon;
  at?: string | null;
}

/** The line under the status: the latest test result, the setup step, or the reason it needs action. */
function healthOf(integration: PlatformIntegration): HealthLine {
  const { status, statusReason, latestError } = integration;
  if (status === 'DRAFT')
    return {
      text: `Setup step ${SETUP_STEPS.indexOf(integration.setupStep) + 1} of ${SETUP_STEPS.length}`,
      tone: 'text-muted',
      icon: PencilSimple,
    };
  if (status === 'REMOVED')
    return { text: 'Removed', tone: 'text-muted', icon: MinusCircle, at: integration.removedAt };
  if (status === 'ERROR')
    return {
      text: latestError?.title ?? statusReason?.message ?? 'Connection failed',
      tone: 'text-danger',
      icon: XCircle,
    };
  if (status === 'NEEDS_ATTENTION' && statusReason)
    return { text: statusReason.message, tone: 'text-warning', icon: WarningCircle };
  if (!integration.supportsTest)
    return { text: 'No test endpoint', tone: 'text-muted', icon: MinusCircle };
  if (!integration.lastCheckAt) return { text: 'Not tested yet', tone: 'text-muted', icon: Clock };
  if (integration.lastCheckOk === true)
    return {
      text: 'Test passed',
      tone: 'text-success',
      icon: CheckCircle,
      at: integration.lastCheckAt,
    };
  if (integration.lastCheckOk === false)
    return { text: 'Test failed', tone: 'text-danger', icon: XCircle, at: integration.lastCheckAt };
  return { text: 'Test needed', tone: 'text-warning', icon: WarningCircle };
}

/** Status / Health: the status pill over its health line. */
export function StatusCell({ integration }: { integration: PlatformIntegration }) {
  const line = healthOf(integration);
  return (
    <span className="flex max-w-44 flex-col items-start gap-1.5">
      <span className="whitespace-nowrap">
        <IntegrationStatusBadge status={integration.status} />
      </span>
      <span className={`flex items-start gap-1 text-xs ${line.tone}`}>
        <line.icon aria-hidden weight="fill" className="mt-px size-3.5 shrink-0" />
        <span className="line-clamp-2">
          {line.text}
          {line.at ? (
            <>
              {' '}
              <time dateTime={line.at} className="whitespace-nowrap">
                {formatDate(line.at)}
              </time>
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}

/** Last Sync / Uptime: the latest sync over the 30-day uptime ("Uptime N/A" when none). */
export function LastSyncCell({ integration }: { integration: PlatformIntegration }) {
  const { lastSyncAt, lastSyncOk, status } = integration;
  return (
    <span className="flex flex-col">
      {lastSyncAt ? (
        <time dateTime={lastSyncAt} className="text-heading">
          <span className="whitespace-nowrap">{formatDate(lastSyncAt)}</span>{' '}
          <span className="whitespace-nowrap">{formatTime(lastSyncAt)}</span>
        </time>
      ) : (
        <span className="text-muted">
          {status === 'DRAFT' ? 'Not connected yet' : 'Never synced'}
        </span>
      )}
      <span className={`text-xs ${lastSyncOk === false ? 'text-danger' : 'text-muted'}`}>
        {lastSyncOk === false ? 'Last sync failed' : uptimeText(integration.uptime30d)}
      </span>
    </span>
  );
}

/** Updated: the date of the last change, and who made it. */
export function UpdatedCell({ integration }: { integration: PlatformIntegration }) {
  return (
    <span className="flex flex-col">
      <time dateTime={integration.updatedAt} className="whitespace-nowrap text-heading">
        {formatDate(integration.updatedAt)}
      </time>
      <span className="text-xs text-muted">by {integration.updatedBy ?? 'Firmivra'}</span>
    </span>
  );
}
