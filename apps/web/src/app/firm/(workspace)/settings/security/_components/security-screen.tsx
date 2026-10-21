'use client';

import type { UsersSummary } from '@firmivra/types';
import { Badge, Button, Callout, Skeleton, Table } from '@firmivra/ui';
import {
  CheckCircle,
  ClockCountdown,
  Info,
  Key,
  LockKey,
  PuzzlePiece,
  ShieldCheck,
  ShieldWarning,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CardLink,
  Facts,
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
 * Settings > Security & Access (guide §10; Octavia's review of Oct 20,
 * docs/specs/settings-review-2026-10-20/security--*.md): the sign-in, password and session rules,
 * the firm's staff accounts under the two-factor rule, and the failed sign-ins to review. The
 * rules are the platform's (no firm-wide policy table exists). Where the sign-in service does not
 * apply a rule yet, the card says what applies today instead of claiming it.
 */
export function SecurityScreen() {
  // Users & Roles' counters (the same cache entry): every account of the firm, not a first page.
  const summary = useApiQuery(['users', 'summary'], () => api.users.summary());
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
          subtitle="Required by default for every staff account, at every sign-in."
          icon={ShieldCheck}
          tone="green"
          testId="mfa-policy"
          action={
            <Badge tone="success" icon={CheckCircle}>
              Required
            </Badge>
          }
        >
          <MfaAccounts summary={summary} />
          <p className="text-xs text-muted">
            Only the owner or a security admin may change this requirement, after signing in again,
            and each change is recorded in the audit log. There is no setting to change it yet, so
            it stays on for every staff account.
          </p>
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
              ['Minimum length', '15 characters'],
              ['Spaces and symbols', 'Allowed, but no space at the start or end'],
              ['Character mix', 'Not required'],
              ['Compromised-password check', 'On'],
              ['Lockout', '5 failures in 15 minutes locks sign-in for 15 minutes'],
              ['Who sets a password', 'The person, from a secure link'],
            ]}
          />
          <NotInForce testId="password-not-in-force">
            New passwords still need at least 12 characters, with an upper-case letter, a lower-case
            letter and a number. Failed sign-ins are already limited, but not yet by this lockout
            rule.
          </NotInForce>
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
              ['Longest sign-in', '8 hours, then sign in again'],
              ['Sign-out when idle', 'After 15 minutes, with a warning 2 minutes before'],
              ['Deactivation or password reset', 'Ends every session'],
            ]}
          />
          <NotInForce testId="sessions-not-in-force">
            A sign-in still lasts up to 7 days, and there is no idle sign-out or warning yet.
            Deactivation ends access to your firm at once. A password reset signs out every device
            within 15 minutes of the new password being set.
          </NotInForce>
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

/**
 * The firm's staff accounts under the two-factor rule, from Users & Roles' counters. Who has
 * finished setting up an authenticator is not recorded yet (only the sign-in service knows), so
 * that row says so instead of showing 0. A failed call says so, with Retry, never as zero.
 */
function MfaAccounts({ summary }: { summary: UseQueryResult<UsersSummary> }) {
  if (summary.isPending) return <Skeleton className="h-24" />;
  const count = (n: number | undefined) => n ?? 'Could not load';
  return (
    <>
      <Facts
        rows={[
          ['Method', 'Authenticator app'],
          ['Active staff accounts', count(summary.data?.active)],
          ['Invited, not signed in yet', count(summary.data?.pendingInvitations)],
          ['Staff with 2FA set up', 'Not recorded yet'],
        ]}
      />
      {summary.isError ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          data-testid="mfa-error"
        >
          The staff counts could not load. {errorMessage(summary.error)}
          <Button
            variant="outline"
            disabled={summary.isFetching}
            onClick={() => void summary.refetch()}
          >
            Retry
          </Button>
        </p>
      ) : null}
    </>
  );
}

/** What applies today where the sign-in service does not apply the card's rules yet. */
function NotInForce({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId}>
      <Callout icon={Info} tone="amber" surface="warning" size="compact" title="Not in force yet">
        <span>{children}</span>
      </Callout>
    </div>
  );
}
