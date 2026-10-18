'use client';

import type { IntegrationCard } from '@firmivra/types';
import { ActionMenu, Badge, Card } from '@firmivra/ui';
import { DotsThreeVertical } from '@phosphor-icons/react';
import Link from 'next/link';
import { actionLink, categoryLabel } from './marketplace-shared';

export function integrationDestination(item: IntegrationCard): string {
  const connection = item.connections[0];
  return connection
    ? `/integrations/${connection.id}`
    : `/integrations/${item.provider.provider}/connect`;
}
export function integrationAction(item: IntegrationCard): string {
  if (item.connections.length)
    return item.status === 'NEEDS_ATTENTION' ? 'Fix connection' : 'Manage';
  return item.action === 'CONFIGURE' ? 'Configure' : 'Connect';
}
const statusLabels = {
  CONNECTED: 'Connected',
  AVAILABLE: 'Available',
  NEEDS_ATTENTION: 'Needs Attention',
  SYNCING: 'Syncing',
  PAUSED: 'Paused',
  DISCONNECTED: 'Disconnected',
} as const;
const statusTones = {
  CONNECTED: 'success',
  AVAILABLE: 'info',
  NEEDS_ATTENTION: 'danger',
  SYNCING: 'info',
  PAUSED: 'warning',
  DISCONNECTED: 'neutral',
} as const;

export function MarketplaceCard({
  item,
  featured = false,
  canManage,
  list,
  onDetails,
}: {
  item: IntegrationCard;
  featured?: boolean;
  canManage: boolean;
  list?: boolean;
  onDetails: (item: IntegrationCard) => void;
}) {
  const connected = item.connections.length > 0;
  return (
    <Card
      data-testid={featured ? 'featured-integration' : 'marketplace-integration'}
      className={`relative flex min-w-0 flex-col gap-2 !rounded-lg !bg-subtle !p-3 ${list ? 'sm:flex-row sm:items-center' : ''}`}
    >
      <div className={`flex min-w-0 gap-2 pr-4 ${list ? 'sm:w-64 sm:shrink-0' : ''}`}>
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-xl font-bold text-action"
        >
          {item.provider.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-heading">{item.provider.name}</h3>
          <p className="mt-1 text-xs text-muted">{categoryLabel(item.provider.category)}</p>
        </div>
      </div>
      <ActionMenu
        className="!absolute right-2 top-2 [&>button]:min-h-6 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button>svg:last-child]:hidden"
        label={`Options for ${item.provider.name}`}
        trigger={<DotsThreeVertical weight="fill" className="size-4" />}
        sections={[{ items: [{ label: 'View details', onSelect: () => onDetails(item) }] }]}
      />
      <p className={`text-xs text-muted ${list ? 'flex-1' : ''}`}>{item.provider.summary}</p>
      <div className="flex flex-wrap gap-1">
        {item.status !== 'AVAILABLE' ? (
          <Badge tone={statusTones[item.status]} dot>
            {statusLabels[item.status]}
          </Badge>
        ) : null}
        {item.provider.badge ? (
          <Badge tone={item.provider.badge === 'MOST_POPULAR' ? 'success' : 'info'}>
            {item.provider.badge === 'MOST_POPULAR' ? 'Most Popular' : 'Recommended'}
          </Badge>
        ) : null}
      </div>
      {canManage || connected ? (
        item.provider.comingSoon && !connected ? (
          <p className="mt-auto text-xs text-muted">Not available to connect yet.</p>
        ) : (
          <Link
            href={integrationDestination(item)}
            className={`${actionLink} ${featured ? '!bg-action !text-on-action hover:!bg-action-hover' : ''} ${list ? 'sm:shrink-0' : 'mt-auto w-full'}`}
          >
            {integrationAction(item)}
          </Link>
        )
      ) : (
        <p className="mt-auto text-xs text-muted">Ask your administrator to connect.</p>
      )}
    </Card>
  );
}
