'use client';

import type { IntegrationCard } from '@firmivra/types';
import { ActionMenu, Badge, Button, Card } from '@firmivra/ui';
import { DotsThreeVertical } from '@phosphor-icons/react';
import Link from 'next/link';
import { useId } from 'react';
import { useFromHere } from '../../_components/integrations-origin';
import { nextStepLine } from '../../_components/readiness';
import { actionLink, categoryLabel } from './marketplace-shared';

/**
 * Leads Review Two, row 24: website lead capture is an intake form's share link or website button,
 * so Website & Lead Forms opens Intake Forms instead of a connect step.
 */
const viaIntakeForms = (item: IntegrationCard) =>
  item.provider.provider === 'website_forms' &&
  item.connections.length === 0 &&
  !item.provider.comingSoon;

export function integrationDestination(item: IntegrationCard): string {
  if (viaIntakeForms(item)) return '/intake-forms';
  const connection = item.connections[0];
  return connection
    ? `/integrations/${connection.id}`
    : `/integrations/${item.provider.provider}/connect`;
}
export function integrationAction(item: IntegrationCard): string {
  if (viaIntakeForms(item)) return 'Open Intake Forms';
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
  return (
    <Card
      data-testid={featured ? 'featured-integration' : 'marketplace-integration'}
      className={`relative flex min-w-0 flex-col gap-1.5 !rounded-lg !bg-subtle !p-3 ${list ? 'sm:flex-row sm:items-center' : ''}`}
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
          {item.connections.some((c) => c.environment === 'TEST') ? (
            <span data-testid="test-badge" className="ml-1">
              <Badge tone="warning">Test</Badge>
            </span>
          ) : null}
          <p className="mt-0.5 text-xs text-muted">{categoryLabel(item.provider.category)}</p>
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
      <MarketplaceAction item={item} canManage={canManage} featured={featured} list={list} />
    </Card>
  );
}

/** Unavailable providers retain their action frame without starting an unsupported connection. */
export function MarketplaceAction({
  item,
  canManage,
  featured = false,
  list = false,
}: {
  item: IntegrationCard;
  canManage: boolean;
  featured?: boolean;
  list?: boolean;
}) {
  const reasonId = useId();
  const fromHere = useFromHere();
  const connected = item.connections.length > 0;
  const reason = viaIntakeForms(item)
    ? null
    : item.provider.comingSoon && !connected
      ? nextStepLine(item.provider)
      : !canManage && !connected
        ? 'Ask your administrator to connect.'
        : null;
  const placement = list ? 'sm:shrink-0' : 'mt-auto w-full';
  if (reason) {
    return (
      <div className={'flex flex-col gap-1 ' + placement}>
        <p id={reasonId} className="text-xs text-muted">
          {reason}
        </p>
        <Button
          variant={featured ? 'primary' : 'outline'}
          disabled
          aria-describedby={reasonId}
          className="min-h-9 w-full !py-1.5"
        >
          {integrationAction(item)}
        </Button>
      </div>
    );
  }
  return (
    <Link
      href={fromHere(integrationDestination(item))}
      className={
        actionLink +
        (featured ? ' !bg-action !text-on-action hover:!bg-action-hover ' : ' ') +
        placement
      }
    >
      {integrationAction(item)}
    </Link>
  );
}
