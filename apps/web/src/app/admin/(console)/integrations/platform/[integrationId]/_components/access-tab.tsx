'use client';

import { Badge, Table, type Column } from '@firmivra/ui';
import { CheckCircle, Lock, Minus } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  PLATFORM_ROLE_LABELS,
  type AccessRule,
  type IntegrationAccess,
  type IntegrationAuditEntry,
  type PlatformIntegrationDetail,
  type PlatformRole,
} from '../../../../../../../mocks/admin-integrations';
import { formatDateTime } from '../../../_components/integration-format';
import { Loaded, loadError, QuietLine } from '../../../_components/integration-states';
import { Panel } from './detail-parts';

/**
 * Access Control (docx §5 and §12): who may view, test, edit, rotate credentials and disable or
 * remove the integration (sensitive actions are Super Admin only, by policy), what the signed-in
 * admin may do, and the integration's audit trail (actor, time, action, old and new non-secret
 * values, result).
 */

const ROLES: PlatformRole[] = ['SUPER_ADMIN', 'TEAM_MEMBER'];
const PAGE_SIZE = 10;

function Allowed({ yes, role }: { yes: boolean; role: string }) {
  return yes ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CheckCircle aria-hidden weight="fill" className="size-5" />
      <span className="sr-only">{role} may</span>
      <span aria-hidden>Allowed</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <Minus aria-hidden weight="bold" className="size-5" />
      <span className="sr-only">{role} may not</span>
      <span aria-hidden>Not allowed</span>
    </span>
  );
}

const ruleColumns: Column<AccessRule>[] = [
  {
    id: 'permission',
    label: 'Permission',
    className: 'min-w-56',
    cell: (rule) => (
      <span className="flex flex-col">
        <span className="font-semibold text-heading">{rule.label}</span>
        <span className="text-xs text-muted">{rule.description}</span>
      </span>
    ),
  },
  ...ROLES.map((role): Column<AccessRule> => ({
    id: role,
    label: PLATFORM_ROLE_LABELS[role],
    className: 'whitespace-nowrap',
    cell: (rule) => <Allowed yes={rule.roles.includes(role)} role={PLATFORM_ROLE_LABELS[role]} />,
  })),
  {
    id: 'policy',
    label: 'Policy',
    className: 'whitespace-nowrap',
    cell: (rule) =>
      rule.locked ? (
        <Badge tone="purple" icon={Lock}>
          Super Admin only
        </Badge>
      ) : (
        <Badge>Default</Badge>
      ),
  },
];

function yourAccess(access: IntegrationAccess): string {
  const can = [
    access.canManageConfiguration ? 'edit the configuration' : null,
    access.canManageSecrets ? 'change credentials' : null,
    access.canLifecycle ? 'disable, enable or remove it' : null,
  ].filter((item): item is string => item !== null);
  const role = PLATFORM_ROLE_LABELS[access.role];
  return can.length
    ? `You are signed in as ${role}: you can view and test this integration, ${can.join(', ')}.`
    : `You are signed in as ${role}: you can view this integration.`;
}

const auditColumns: Column<IntegrationAuditEntry>[] = [
  {
    id: 'at',
    label: 'Date & Time',
    className: 'whitespace-nowrap',
    cell: (entry) => <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>,
  },
  {
    id: 'actor',
    label: 'Who',
    cell: (entry) => (
      <span className="flex flex-col">
        <span className="text-heading">{entry.actor.name}</span>
        <span className="text-xs text-muted">{entry.actor.role}</span>
      </span>
    ),
  },
  {
    id: 'action',
    label: 'Action',
    cell: (entry) => (
      <span className="flex flex-col items-start gap-1">
        <span className="text-heading">{entry.label}</span>
        {entry.category === 'SECURITY' ? <Badge tone="purple">Security</Badge> : null}
      </span>
    ),
  },
  {
    id: 'changes',
    label: 'Changes',
    className: 'min-w-56',
    cell: (entry) =>
      entry.changes.length ? (
        <ul className="flex flex-col gap-0.5">
          {entry.changes.map((change) => (
            <li key={change.field} className="wrap-anywhere">
              <span className="text-muted">{change.field}:</span> {change.before ?? '—'} →{' '}
              {change.after ?? '—'}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-muted">No field changes</span>
      ),
  },
  {
    id: 'result',
    label: 'Result',
    cell: (entry) => (
      <Badge tone={entry.result === 'SUCCESS' ? 'success' : 'danger'} dot>
        {entry.result === 'SUCCESS' ? 'Success' : 'Failed'}
      </Badge>
    ),
  },
  { id: 'ip', label: 'IP Address', className: 'whitespace-nowrap', cell: (entry) => entry.ip },
];

function AuditTrail({ integrationId }: { integrationId: string }) {
  const [page, setPage] = useState(1);
  const audit = useApiQuery(['admin-integrations', 'audit', integrationId, page], () =>
    adminIntegrations.auditTrail({ targetId: integrationId, page, pageSize: PAGE_SIZE }),
  );
  const pages = audit.data ? Math.max(1, Math.ceil(audit.data.total / PAGE_SIZE)) : 1;
  return (
    <Panel
      testId="audit-trail"
      title="Audit Trail"
      subtitle="Every sensitive change to this integration, newest first. Secrets never appear here."
    >
      {audit.isError ? (
        <QuietLine>{loadError(audit.error)}</QuietLine>
      ) : (
        <Table
          caption="Audit trail for this integration"
          rows={audit.data?.items ?? []}
          loading={audit.isPending}
          columns={auditColumns}
          rowKey={(entry) => entry.id}
          noun="entries"
          pageSize={PAGE_SIZE}
          emptyTitle="No audit entries yet"
          emptyText="Credential, lifecycle and configuration changes are recorded here."
          server={{
            page,
            total: audit.data?.total ?? 0,
            hasNext: page < pages,
            hasPrevious: page > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(page - 1),
            onPage: setPage,
            onSort: () => undefined,
          }}
        />
      )}
    </Panel>
  );
}

export function AccessTab({
  integrationId,
  detail,
  access,
}: {
  integrationId: string;
  detail: UseQueryResult<PlatformIntegrationDetail>;
  access: UseQueryResult<IntegrationAccess>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel
        testId="access-control"
        title="Access Control"
        subtitle="Who may view, test, change and remove this integration. Sensitive actions are Super Admin only."
      >
        <div className="flex flex-col gap-4">
          <Loaded query={access} rows={1}>
            {(data) => (
              <p
                data-testid="your-access"
                className="rounded-lg bg-info-soft p-3 text-sm text-text"
              >
                {yourAccess(data)}
              </p>
            )}
          </Loaded>
          <Loaded query={detail} rows={5}>
            {(integration) => (
              <Table
                caption="Who may do what with this integration"
                rows={integration.accessControl}
                columns={ruleColumns}
                rowKey={(rule) => rule.permission}
                showPagination={false}
              />
            )}
          </Loaded>
        </div>
      </Panel>
      <AuditTrail integrationId={integrationId} />
    </div>
  );
}
