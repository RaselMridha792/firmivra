'use client';
import type { IntegrationCard } from '@firmivra/types';
import { ActionMenu, Badge, Button, Card } from '@firmivra/ui';
import { ArrowsLeftRight, Clock, DotsThreeVertical, GearSix, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { dateLabel, linkClass } from './integration-shared';

const labels = {
  AVAILABLE: 'Available',
  CONNECTED: 'Connected',
  NEEDS_ATTENTION: 'Needs Attention',
  SYNCING: 'Syncing',
  PAUSED: 'Paused',
  DISCONNECTED: 'Disconnected',
} as const;
const tones = {
  AVAILABLE: 'info',
  CONNECTED: 'success',
  NEEDS_ATTENTION: 'danger',
  SYNCING: 'info',
  PAUSED: 'warning',
  DISCONNECTED: 'neutral',
} as const;
/** Unknown catalog logo keys use a neutral tile; provider cards always come from the contract. */
function ProviderLogo({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-2xl font-bold text-action"
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function ProviderCard({ item, canManage }: { item: IntegrationCard; canManage: boolean }) {
  const router = useRouter();
  const connection = item.connections[0];
  const [notice, setNotice] = useState('');
  const mutation = useApiMutation(
    async (kind: 'sync' | 'test' | 'resume') => {
      if (!connection) return;
      if (kind === 'sync') {
        await api.integrations.sync(connection.id);
        setNotice('Sync requested.');
      }
      if (kind === 'test') {
        const result = await api.integrations.test(connection.id);
        setNotice(result.summary);
      }
      if (kind === 'resume') {
        await api.integrations.resume(connection.id);
        setNotice('Sync resumed.');
      }
    },
    { invalidate: ['integrations'] },
  );
  const manageHref = `/integrations/${connection?.id ?? item.provider.provider}`;
  const actionHref =
    connection && item.action !== 'RECONNECT'
      ? manageHref
      : `/integrations/${item.provider.provider}/connect`;
  const secondaryAction =
    canManage && connection && item.status === 'CONNECTED'
      ? connection.syncMode === 'AUTO'
        ? 'sync'
        : 'test'
      : null;
  const actionLabel = {
    CONNECT: 'Connect',
    CONFIGURE: 'Configure',
    MANAGE: 'Manage',
    RECONNECT: 'Reconnect',
    RESUME: 'Resume',
  }[item.action];
  return (
    <Card
      data-testid="integration-card"
      className="flex min-w-0 flex-col gap-2 !rounded-lg !bg-subtle !p-3"
    >
      <div className="relative flex items-start gap-3 pr-5">
        <ProviderLogo name={item.provider.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-heading">{item.provider.name}</h2>
          <Badge tone={tones[item.status]} dot>
            {labels[item.status]}
          </Badge>
        </div>
        <ActionMenu
          className="absolute right-0 top-0 [&>button]:min-h-6 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button>svg:last-child]:hidden"
          label={`Actions for ${item.provider.name}`}
          trigger={<DotsThreeVertical weight="fill" className="size-5" />}
          sections={[
            {
              items: [
                {
                  label: 'View details',
                  onSelect: () => {
                    router.push(actionHref);
                  },
                },
                ...(connection
                  ? [
                      {
                        label: 'Sync history',
                        onSelect: () => {
                          router.push(`${manageHref}/sync-history`);
                        },
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
      </div>
      <p className="text-xs text-muted">{item.provider.summary}</p>
      {connection ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Clock weight="fill" className="size-4" />
            Last sync: {connection.lastSyncAt ? dateLabel(connection.lastSyncAt) : 'Not synced yet'}
          </p>
          {connection.statusMessage ? (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <Warning weight="fill" className="size-4" />
              {connection.statusMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <ArrowsLeftRight weight="fill" className="size-4" />
              {connection.direction === 'TWO_WAY' ? 'Two-way sync' : 'One-way sync'}
            </span>
            <span className="flex items-center gap-1">
              <GearSix weight="fill" className="size-4" />
              {connection.syncMode === 'AUTO' ? 'Auto sync' : 'Manual sync'}
            </span>
          </div>
        </>
      ) : null}
      <div
        className={
          secondaryAction
            ? 'mt-auto grid grid-cols-2 gap-2 pt-1'
            : 'mt-auto grid grid-cols-1 gap-2 pt-1'
        }
      >
        {item.action === 'RESUME' ? (
          canManage ? (
            <Button
              className="min-h-9 flex-1 !py-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('resume')}
            >
              Resume
            </Button>
          ) : null
        ) : canManage || connection ? (
          <Link
            className={`${linkClass} flex-1 ${connection ? '!bg-navigation !text-on-action' : ''}`}
            href={actionHref}
          >
            {actionLabel}
          </Link>
        ) : null}
        {secondaryAction ? (
          <Button
            variant="outline"
            className="min-h-9 flex-1 !px-2 !py-1"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(secondaryAction)}
          >
            {secondaryAction === 'sync' ? 'Sync Now' : 'Test'}
          </Button>
        ) : null}
        {item.status === 'SYNCING' ? (
          <span role="status" className="text-xs text-info">
            Sync in progress
          </span>
        ) : null}
      </div>
      {mutation.isError ? (
        <p role="alert" className="text-xs text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
