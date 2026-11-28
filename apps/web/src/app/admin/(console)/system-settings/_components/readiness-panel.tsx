'use client';

import type { AdminPlatformIntegration, AdminServiceStatus } from '@firmivra/types';
import { Badge, Card, Skeleton } from '@firmivra/ui';
import { WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { mocked } from '../../../../../lib/mock';
import { useApiQuery } from '../../../../../lib/query';

/** One state of a channel or integration: yes, no, or not something this row has. */
type State = boolean | null;

interface ReadinessRow {
  key: string;
  name: string;
  enabled: State;
  configured: State;
  connected: State;
  /** The last successful test; `failed` when the newest test failed. */
  lastTest: { at: string; ok: boolean } | null;
  /** Where to set it up or fix it. */
  href: string;
}

const configuredOf = (s: AdminServiceStatus | undefined): State =>
  s === undefined ? null : s !== 'NOT_CONFIGURED';
/** Reached just now (ONLINE) or not (DOWN); a service that is only CONFIGURED was not called. */
const connectedOf = (s: AdminServiceStatus | undefined): State =>
  s === 'ONLINE' ? true : s === 'DOWN' || s === 'NOT_CONFIGURED' ? false : null;
const LIVE = new Set<AdminPlatformIntegration['status']>(['ACTIVE', 'NEEDS_ATTENTION', 'ERROR']);

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

function Cell({ value, yes, no }: { value: State; yes: string; no: string }) {
  if (value === null) return <span className="text-muted">Not checked</span>;
  return value ? <Badge tone="success">{yes}</Badge> : <Badge tone="neutral">{no}</Badge>;
}

/**
 * SA-SYS-A3 (and F3): readiness of each channel and platform integration in four separate states,
 * so "configured" never reads as "delivered": enabled, configured, connected, and the last
 * successful test with its time. "Enabled but not set up" is a warning with a link to fix it.
 * The same panel sits on System Configuration, Email & Notifications and Integrations.
 */
export function ReadinessPanel({ testId = 'readiness-panel' }: { testId?: string }) {
  // Readiness is the live API's own facts (health, the email test, integrations): no mock of it.
  if (mocked('adminSettings')) return null;
  return <Readiness testId={testId} />;
}

function Readiness({ testId }: { testId: string }) {
  const health = useApiQuery(['system-settings', 'health'], () => api.adminSettings.health());
  const email = useApiQuery(['system-settings', 'email'], () => api.adminSettings.email());
  const emailStatus = useApiQuery(['system-settings', 'email-status'], () =>
    api.adminSettings.emailStatus(),
  );
  const integrations = useApiQuery(['admin-integrations', 'readiness'], () =>
    api.adminIntegrations.listPlatform({ pageSize: 100 }),
  );

  const service = (key: 'email' | 'sms' | 'payments') =>
    health.data?.services?.find((s) => s.key === key)?.status;
  const channels = email.data?.value?.channels;
  const lastEmail = emailStatus.data?.lastTest ?? null;
  const rows: ReadinessRow[] = [
    {
      key: 'email',
      name: 'Email',
      enabled: channels ? channels.email : null,
      configured: configuredOf(service('email')),
      connected: lastEmail?.accepted ? true : connectedOf(service('email')),
      lastTest: lastEmail ? { at: lastEmail.at, ok: lastEmail.accepted } : null,
      href: '/system-settings/email-notifications',
    },
    {
      key: 'sms',
      name: 'SMS',
      enabled: channels ? channels.sms : null,
      configured: configuredOf(service('sms')),
      connected: connectedOf(service('sms')),
      lastTest: null,
      href: '/system-settings/configuration',
    },
    {
      key: 'payments',
      name: 'Payments',
      enabled: null,
      configured: configuredOf(service('payments')),
      connected: connectedOf(service('payments')),
      lastTest: null,
      href: '/system-settings/configuration',
    },
    ...(Array.isArray(integrations.data?.items) ? integrations.data.items : [])
      .filter((i) => i.status !== 'REMOVED' && i.status !== 'DRAFT')
      .map((i) => ({
        key: i.id,
        name: i.name,
        enabled: LIVE.has(i.status),
        configured: i.status !== 'DRAFT',
        connected: i.lastCheckOk,
        lastTest: i.lastCheckAt ? { at: i.lastCheckAt, ok: i.lastCheckOk === true } : null,
        href: `/integrations/platform/${i.id}`,
      })),
  ];
  const loading = health.isPending || email.isPending;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-heading">Readiness</h2>
        <p className="text-sm text-muted">
          Each channel and integration in four states. Configured is not the same as delivered: the
          last successful test says it worked.
        </p>
      </div>
      {loading ? (
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Channel or integration</th>
                <th className="py-2 pr-3 font-medium">Enabled</th>
                <th className="py-2 pr-3 font-medium">Configured</th>
                <th className="py-2 pr-3 font-medium">Connected</th>
                <th className="py-2 font-medium">Last successful test</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unset = row.enabled === true && row.configured === false;
                return (
                  <tr key={row.key} className="border-t border-divider align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-heading">{row.name}</span>
                      {unset ? (
                        <Link
                          href={row.href}
                          className="mt-1 flex items-center gap-1 text-xs text-warning hover:underline"
                        >
                          <WarningCircle aria-hidden weight="fill" className="size-4 shrink-0" />
                          Enabled but not set up. Set it up
                        </Link>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {row.enabled === null && row.key === 'payments' ? (
                        <span className="text-muted" title="Payments have no on/off switch here">
                          —
                        </span>
                      ) : (
                        <Cell value={row.enabled} yes="On" no="Off" />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Cell value={row.configured} yes="Configured" no="Not configured" />
                    </td>
                    <td className="py-2 pr-3">
                      <Cell value={row.connected} yes="Connected" no="Not connected" />
                    </td>
                    <td className="py-2">
                      {row.lastTest?.ok ? (
                        <span className="text-text">{dateTime(row.lastTest.at)}</span>
                      ) : row.lastTest ? (
                        <span className="text-danger">Last test failed</span>
                      ) : (
                        <span className="text-muted">No test yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
