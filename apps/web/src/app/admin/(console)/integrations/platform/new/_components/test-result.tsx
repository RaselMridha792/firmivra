'use client';

import { Button, Callout } from '@firmivra/ui';
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  FileText,
  Info,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type {
  ConnectionTestResult,
  PlatformIntegration,
} from '../../../../../../../mocks/admin-integrations';
import { formatDateTime, formatDuration } from '../../../_components/integration-format';
import { QuietLine } from '../../../_components/integration-states';
import { logsHref } from '../../../_components/integrations-shell';

/**
 * A connection test's result in the wizard (docx §4 Test Connection, §14 failure): success or a
 * useful, never secret, message; the error code and request id; a retry; and links to the log,
 * the provider's status page (an outage) and its documentation. Without a test in this visit it
 * shows the draft's last test.
 */

const FAILURE_TITLES: Record<ConnectionTestResult['kind'], string> = {
  OK: 'Connection successful',
  INVALID_CREDENTIALS: 'Credentials rejected',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  MISSING_CONFIGURATION: 'Connection details missing',
};

interface Shown {
  ok: boolean;
  title: string;
  message: string;
  at: string;
  latencyMs: number | null;
  errorCode: string | null;
  requestId: string | null;
  outage: boolean;
}

function shownOf(
  integration: PlatformIntegration,
  result: ConnectionTestResult | null,
): Shown | 'none' | 'stale' {
  if (result)
    return {
      ok: result.ok,
      title: FAILURE_TITLES[result.kind],
      message: result.message,
      at: result.at,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      requestId: result.requestId,
      outage: result.kind === 'PROVIDER_UNAVAILABLE',
    };
  if (!integration.lastCheckAt) return 'none';
  if (integration.lastCheckOk === null) return 'stale';
  const error = integration.lastCheckOk ? null : integration.latestError;
  return {
    ok: integration.lastCheckOk,
    title: integration.lastCheckOk ? 'Last test passed' : 'Last test failed',
    message: integration.lastCheckMessage ?? '',
    at: integration.lastCheckAt,
    latencyMs: null,
    errorCode: error?.code ?? null,
    requestId: error?.requestId ?? null,
    outage: error?.code === 'PROVIDER_UNAVAILABLE',
  };
}

const external = 'inline-flex items-center gap-1.5 font-semibold text-link hover:underline';

export function TestResult({
  integration,
  result,
  onRetry,
  retrying = false,
}: {
  integration: PlatformIntegration;
  /** The test run in this visit, if any. */
  result: ConnectionTestResult | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (!integration.supportsTest)
    return (
      <div data-testid="test-result">
        <Callout
          size="compact"
          surface="plain"
          icon={Info}
          tone="blue"
          title="This provider has no test endpoint"
        >
          <span>
            Firmivra can&apos;t check {integration.name}&apos;s connection by itself. Check it in
            the provider&apos;s console; activating it asks you to confirm that you did.
          </span>
        </Callout>
      </div>
    );

  const shown = shownOf(integration, result);
  if (shown === 'none')
    return (
      <div data-testid="test-result">
        <QuietLine>
          Not tested yet. Test the connection to check the credentials before activating.
        </QuietLine>
      </div>
    );
  if (shown === 'stale')
    return (
      <div data-testid="test-result">
        <Callout
          size="compact"
          surface="warning"
          icon={WarningCircle}
          tone="amber"
          title="Test needed"
        >
          <span>
            {integration.lastCheckMessage ?? 'The credentials changed since the last test.'}
          </span>
        </Callout>
      </div>
    );

  const meta = [
    shown.latencyMs !== null ? `Response ${formatDuration(shown.latencyMs)}` : null,
    shown.errorCode ? `Error code ${shown.errorCode}` : null,
    shown.requestId ? `Request ID ${shown.requestId}` : null,
  ].filter((item): item is string => item !== null);

  return (
    <div data-testid="test-result" aria-live="polite">
      <Callout
        surface={shown.ok ? 'success' : 'warning'}
        tone={shown.ok ? 'green' : 'red'}
        icon={shown.ok ? CheckCircle : XCircle}
        title={shown.title}
        action={
          shown.ok ? undefined : (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {onRetry ? (
                <Button variant="secondary" onClick={onRetry} disabled={retrying}>
                  <ArrowClockwise aria-hidden weight="bold" className="size-4" />
                  {retrying ? 'Testing…' : 'Retry Test'}
                </Button>
              ) : null}
              <Link href={logsHref(integration.id)} className={external}>
                <FileText aria-hidden weight="fill" className="size-4" />
                View Log
              </Link>
              {shown.outage && integration.statusUrl ? (
                <a
                  href={integration.statusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={external}
                >
                  Provider Status
                  <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                </a>
              ) : null}
              {integration.docsUrl ? (
                <a
                  href={integration.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={external}
                >
                  Documentation
                  <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                </a>
              ) : null}
            </span>
          )
        }
      >
        <p>{shown.message}</p>
        <p className="mt-1 text-xs text-muted">
          <time dateTime={shown.at}>{formatDateTime(shown.at)}</time>
          {meta.length ? ` · ${meta.join(' · ')}` : ''}
        </p>
      </Callout>
    </div>
  );
}
