'use client';

import { Badge, Table } from '@firmivra/ui';
import {
  CheckCircle,
  ClockCountdown,
  Key,
  LockKey,
  PuzzlePiece,
  ShieldCheck,
  ShieldWarning,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CardLink,
  Facts,
  Loaded,
  NOT_LOADED,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The 30 days the alert list looks back over. */
const since = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

/**
 * Settings > Security & Access (guide §10): the firm's sign-in and session rules, who has set up
 * two-factor sign-in, and the failed sign-ins to review. The rules are the platform's minimum
 * (docs/AUTH-DESIGN.md): no firm-wide policy table exists yet (Settings contract), so the cards
 * show them and open the pages where each person's settings change.
 */
export function SecurityScreen() {
  const users = useApiQuery(['users', 'list', 'security'], () => api.users.list({ pageSize: 100 }));
  const overview = useApiQuery(['settings', 'overview'], () => api.settingsOverview.get());
  // Fixed for the visit, so the query keeps its key.
  const [from] = useState(since);
  const failed = useApiQuery(['audit-log', 'security', 'failed'], () =>
    api.auditLog.list({
      action: 'auth.sign_in_failed',
      from,
      to: new Date().toISOString(),
      limit: 10,
    }),
  );
  const count = (state: string) =>
    (users.data?.items ?? []).filter((u) => u.status !== 'DEACTIVATED' && u.mfa === state).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={ShieldCheck}
        title="Security & Access"
        subtitle="Two-factor sign-in, passwords, sessions and security alerts for your firm."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Two-Factor Sign-in (MFA)"
          subtitle="Required for every staff account; it cannot be turned off."
          icon={ShieldCheck}
          tone="green"
          testId="mfa-policy"
          action={
            <Badge tone="success" icon={CheckCircle}>
              Required
            </Badge>
          }
        >
          <Loaded query={users}>
            {() => (
              <Facts
                rows={[
                  ['Method', 'Authenticator app'],
                  ['Staff with 2FA set up', count('ENABLED')],
                  ['Waiting to set it up', count('PENDING')],
                  ['Not set up', count('DISABLED')],
                ]}
              />
            )}
          </Loaded>
          <CardLink href="/settings/users">Review Users</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Password Policy"
          subtitle="The platform's rules for every staff password."
          icon={Key}
          testId="password-policy"
        >
          <Facts
            rows={[
              ['Minimum length', '12 characters'],
              ['Must include', 'Upper and lower case letters and a number'],
              ['Compromised-password check', 'On'],
              ['Lockout after repeated failures', 'On'],
              ['Who sets a password', 'The person, from a secure link'],
            ]}
          />
          <p className="text-xs text-muted">
            Nobody at your firm, and nobody at Firmivra, can see or set a staff password.
          </p>
        </SettingsCard>

        <SettingsCard
          title="Sessions & Devices"
          subtitle="How long staff stay signed in, and how sessions end."
          icon={ClockCountdown}
          testId="session-rules"
        >
          <Facts
            rows={[
              ['Longest sign-in', '7 days, then sign in again'],
              ['Automatic logout and trusted devices', 'Set per person'],
              ['Deactivation or password reset', 'Signs out every session at once'],
            ]}
          />
          <CardLink href="/team">Open Staff Management</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Integration Access"
          subtitle="Connections to other services and their keys."
          icon={PuzzlePiece}
          testId="integration-access"
        >
          <p className="text-sm text-text">
            Connections are managed in Integrations. Keys and secrets are stored encrypted and are
            never shown again after they are saved.
          </p>
          <CardLink href={'/integrations'}>Open Integrations</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Security Alerts"
          subtitle="Failed sign-ins in the last 30 days, newest first."
          icon={ShieldWarning}
          tone="red"
          testId="security-alerts"
          className="lg:col-span-2"
          action={
            overview.data ? (
              <Badge tone={overview.data.securityAlerts ? 'warning' : 'success'}>
                {overview.data.securityAlerts
                  ? `${overview.data.securityAlerts} to review`
                  : 'Nothing to review'}
              </Badge>
            ) : null
          }
        >
          <Table
            rows={failed.data?.items ?? []}
            loading={failed.isPending}
            rowKey={(e) => e.id}
            caption="Failed sign-ins"
            dense
            showPagination={false}
            columns={[
              { id: 'at', label: 'When', cell: (e) => when(e.at) },
              { id: 'who', label: 'Who', cell: (e) => e.actor?.name ?? 'Unknown account' },
              { id: 'ip', label: 'IP Address', cell: (e) => e.ip ?? '—' },
            ]}
            emptyTitle={failed.isError ? 'Alerts are not available' : 'No failed sign-ins'}
            emptyText={
              failed.isError ? NOT_LOADED : 'Nobody failed to sign in in the last 30 days.'
            }
          />
          <CardLink href="/audit-log">Open Audit Log</CardLink>
        </SettingsCard>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <LockKey aria-hidden weight="fill" className="size-4" />
        Changes to security settings and every security action are recorded in the audit log.
      </div>
    </div>
  );
}
