'use client';

import type { IntegrationConnectionDetail, IntegrationConnectionHealth } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  FirstAid,
  Play,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { CardTitle, EmptyLine, formatDate } from '../../_components/manage-integration-shared';
import {
  followConnect,
  integrationError,
  ManageShell,
  Notice,
} from '../../_components/manage-shell';

/**
 * Troubleshooting (the spec: authentication, API health, data sync, recent errors and permissions,
 * with Run Connection Test; errors understandable to business users). Shows the latest checks and
 * what to do, runs a test on demand, and offers the fixes the connection's state calls for:
 * Reconnect, Resume, or the failed runs in Sync History.
 */

export function TroubleshootingTab({ integrationId }: { integrationId: string }) {
  return (
    <ManageShell
      integrationId={integrationId}
      current="/troubleshooting"
      testId="troubleshooting-tab"
    >
      {(detail) => <Troubleshooting integrationId={integrationId} detail={detail} />}
    </ManageShell>
  );
}

function Troubleshooting({
  integrationId,
  detail,
}: {
  integrationId: string;
  detail: IntegrationConnectionDetail | null;
}) {
  const health = useApiQuery(['integrations', 'health', integrationId], () =>
    api.integrations.health(integrationId),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const test = useApiMutation(() => api.integrations.test(integrationId), {
    invalidate: ['integrations'],
  });
  const reconnect = useApiMutation(() => api.integrations.reconnect(integrationId), {
    invalidate: ['integrations'],
  });
  const resume = useApiMutation(() => api.integrations.resume(integrationId), {
    invalidate: ['integrations'],
  });
  const busy = test.isPending || reconnect.isPending || resume.isPending;
  // The test's answer is the newest view of the checks.
  const shown: IntegrationConnectionHealth | undefined = test.data ?? health.data;
  const failing = shown?.checks.filter((check) => !check.ok) ?? [];
  const needsReconnect =
    detail?.statusAction === 'RECONNECT' ||
    detail?.statusAction === 'FIX_PERMISSIONS' ||
    failing.some((check) => check.key === 'AUTHENTICATION' || check.key === 'PERMISSIONS');
  const error = test.error ?? reconnect.error ?? resume.error;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="error">{integrationError(error)}</Notice> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {test.isSuccess ? (
        <Notice tone={test.data.ok ? 'success' : 'error'}>{test.data.summary}</Notice>
      ) : null}
      {resume.isSuccess ? <Notice tone="success">Automatic sync resumed.</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card data-testid="health-checks" className="flex flex-col gap-3 p-5! xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-heading">Connection Health</h2>
              <p className="text-sm text-muted">
                {shown?.checkedAt
                  ? `Last checked ${formatDate(shown.checkedAt)}`
                  : 'No check has run yet.'}
              </p>
            </div>
            <Button disabled={!detail || busy} onClick={() => test.mutate(undefined)}>
              <FirstAid aria-hidden weight="fill" className="size-5" />
              {test.isPending ? 'Testing…' : 'Run Connection Test'}
            </Button>
          </div>
          {health.isError && !test.data ? (
            <Notice tone="error" onRetry={() => void health.refetch()}>
              {integrationError(health.error)}
            </Notice>
          ) : !shown ? (
            <EmptyLine>The health checks show when they load.</EmptyLine>
          ) : (
            <>
              <p
                className={`rounded-control px-3 py-2 text-sm ${shown.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
              >
                {shown.summary}
              </p>
              {shown.checks.length ? (
                <ul className="divide-y divide-divider">
                  {shown.checks.map((check) => (
                    <li key={check.key} className="flex items-start gap-3 py-2.5 text-sm">
                      {check.ok ? (
                        <CheckCircle aria-hidden weight="fill" className="size-5 text-success" />
                      ) : (
                        <WarningCircle aria-hidden weight="fill" className="size-5 text-danger" />
                      )}
                      <span>
                        <span className="block font-medium text-heading">{check.label}</span>
                        {check.message ? (
                          <span className="block text-muted">{check.message}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyLine>Run a connection test to see each check.</EmptyLine>
              )}
            </>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card data-testid="health-suggestions" className="p-5!">
            <CardTitle>What To Do</CardTitle>
            {shown?.suggestions.length ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-text">
                {shown.suggestions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <EmptyLine>
                {shown ? 'Nothing needs your attention.' : 'Suggestions show with the checks.'}
              </EmptyLine>
            )}
          </Card>

          <Card data-testid="quick-fixes" className="flex flex-col gap-3 p-5!">
            <CardTitle>Quick Fixes</CardTitle>
            {detail?.statusMessage ? (
              <p className="text-sm text-danger">{detail.statusMessage}</p>
            ) : null}
            <Button
              variant={needsReconnect ? 'primary' : 'secondary'}
              disabled={!detail?.canManage || busy}
              onClick={() => {
                setProblem(null);
                reconnect.mutate(undefined, {
                  onSuccess: (result) => setProblem(followConnect(result)),
                });
              }}
            >
              <ArrowsClockwise aria-hidden weight="bold" className="size-4" />
              {reconnect.isPending ? 'Opening…' : 'Reconnect'}
            </Button>
            {detail?.paused ? (
              <Button
                variant="secondary"
                disabled={!detail.canManage || busy}
                onClick={() => resume.mutate(undefined)}
              >
                <Play aria-hidden weight="fill" className="size-4" />
                Resume Auto Sync
              </Button>
            ) : null}
            <Link
              href={`/integrations/${integrationId}/sync-history?status=FAILED`}
              className="inline-flex items-center gap-2 text-sm font-medium text-link"
            >
              View failed runs <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
