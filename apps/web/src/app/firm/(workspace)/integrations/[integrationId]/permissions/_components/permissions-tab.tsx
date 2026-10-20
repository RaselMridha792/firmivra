'use client';

import type { IntegrationConnectionDetail } from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { ArrowsClockwise, CheckCircle, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { EmptyLine } from '../../_components/manage-integration-shared';
import {
  followConnect,
  integrationError,
  ManageShell,
  Notice,
} from '../../_components/manage-shell';

/**
 * Permissions (the spec: what the provider granted, in plain words, least privilege). Each
 * permission says whether it was granted, whether it is required, and which object needs it; when
 * one is missing for an enabled object, Reconnect asks the provider again.
 */

export function PermissionsTab({ integrationId }: { integrationId: string }) {
  return (
    <ManageShell integrationId={integrationId} current="/permissions" testId="permissions-tab">
      {(detail) => <Permissions integrationId={integrationId} detail={detail} />}
    </ManageShell>
  );
}

function Permissions({
  integrationId,
  detail,
}: {
  integrationId: string;
  detail: IntegrationConnectionDetail | null;
}) {
  const query = useApiQuery(['integrations', 'permissions', integrationId], () =>
    api.integrations.permissions(integrationId),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const reconnect = useApiMutation(() => api.integrations.reconnect(integrationId), {
    invalidate: ['integrations'],
  });
  const list = query.data;
  const entityLabel = (key: string | null) =>
    key ? (detail?.provider.entities.find((e) => e.key === key)?.label ?? key) : null;

  function ask() {
    setProblem(null);
    reconnect.mutate(undefined, { onSuccess: (result) => setProblem(followConnect(result)) });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card
        title="Granted Permissions"
        data-testid="permission-list"
        className="p-5! xl:col-span-2"
      >
        {reconnect.isError ? (
          <Notice tone="error">{integrationError(reconnect.error)}</Notice>
        ) : null}
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {list?.needsReconnect ? (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <span className="flex items-center gap-2">
              <WarningCircle aria-hidden weight="fill" className="size-5" />A permission is missing
              for an object you sync. Reconnect to grant it.
            </span>
            <Button disabled={!detail?.canManage || reconnect.isPending} onClick={ask}>
              <ArrowsClockwise aria-hidden weight="bold" className="size-4" />
              {reconnect.isPending ? 'Opening…' : 'Reconnect'}
            </Button>
          </div>
        ) : null}
        {!list ? (
          query.isError ? (
            <Notice tone="error" onRetry={() => void query.refetch()}>
              {integrationError(query.error)}
            </Notice>
          ) : (
            <EmptyLine>The permissions show when they load.</EmptyLine>
          )
        ) : list.items.length ? (
          <ul className="divide-y divide-divider">
            {list.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-start gap-3">
                  {item.granted ? (
                    <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-5 text-success" />
                  ) : (
                    <WarningCircle
                      aria-hidden
                      weight="fill"
                      className="mt-0.5 size-5 text-danger"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium text-heading">{item.label}</span>
                    <span className="block text-xs text-muted">
                      {entityLabel(item.entity)
                        ? `Needed to sync ${entityLabel(item.entity)}`
                        : 'Needed for the connection itself'}
                    </span>
                  </span>
                </span>
                <span className="flex gap-2">
                  <Badge tone={item.required ? 'info' : 'neutral'}>
                    {item.required ? 'Required' : 'Optional'}
                  </Badge>
                  <Badge tone={item.granted ? 'success' : 'danger'} dot>
                    {item.granted ? 'Granted' : 'Missing'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>This provider asks for no permissions.</EmptyLine>
        )}
      </Card>

      <Card title="How Access Works" data-testid="permission-notes" className="p-5!">
        <ul className="flex flex-col gap-3 text-sm text-text">
          <li className="flex gap-3">
            <ShieldCheck aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
            LVP Pro asks only for what the objects you sync need.
          </li>
          <li className="flex gap-3">
            <ShieldCheck aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
            Sign-in details and tokens stay encrypted; they are never shown here.
          </li>
          <li className="flex gap-3">
            <ShieldCheck aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
            Turning an object off in Sync Settings stops its sync; Disconnect revokes all access.
          </li>
        </ul>
      </Card>
    </div>
  );
}
