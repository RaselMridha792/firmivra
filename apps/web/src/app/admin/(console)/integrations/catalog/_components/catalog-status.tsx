'use client';

import { ApiRequestError } from '@firmivra/types';
import { useState } from 'react';
import { useApiMutation } from '../../../../../../lib/query';
import {
  adminIntegrations,
  CATALOG_STATUS_LABELS,
  type CatalogItem,
  type CatalogStatus,
} from '../../../../../../mocks/admin-integrations';
import type { Notice } from '../../_components/platform-actions';
import { AccessLossDialog, catalogErrorMessage } from './catalog-parts';

/**
 * Changing an entry's status from the list (its switch or its menu). The change applies at once
 * (docx §7); when it would hide the entry from firms that are connected now, it asks first: up
 * front when the page knows firms are connected and the entry is being disabled, and whenever
 * the API answers ACCESS_LOSS.
 */

export const isAccessLoss = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'ACCESS_LOSS';

interface Change {
  item: CatalogItem;
  status: CatalogStatus;
  confirm: boolean;
}

export function useCatalogStatus(onNotice: (notice: Notice) => void) {
  const [asking, setAsking] = useState<Omit<Change, 'confirm'> | null>(null);
  const change = useApiMutation(
    ({ item, status, confirm }: Change) =>
      adminIntegrations.updateCatalog(item.id, {
        version: item.version,
        status,
        confirmAccessLoss: confirm || undefined,
      }),
    { invalidate: ['admin-integrations'] },
  );

  function send(next: Change) {
    change.mutate(next, {
      onSuccess: (saved) => {
        setAsking(null);
        onNotice({
          tone: 'success',
          text: `${saved.name} is now ${CATALOG_STATUS_LABELS[saved.status]}.`,
        });
      },
      onError: (error) => {
        if (isAccessLoss(error) && !next.confirm) {
          setAsking({ item: next.item, status: next.status });
          return;
        }
        setAsking(null);
        onNotice({ tone: 'error', text: catalogErrorMessage(error) });
      },
    });
  }

  /** Ask for a new status; firms losing access confirm first. */
  function request(item: CatalogItem, status: CatalogStatus) {
    if (item.status === status) return;
    if (status === 'DISABLED' && item.status !== 'DISABLED' && item.stats.firmsUsing > 0) {
      setAsking({ item, status });
      return;
    }
    send({ item, status, confirm: false });
  }

  const dialog = asking ? (
    <AccessLossDialog
      name={asking.item.name}
      firms={asking.status === 'DISABLED' ? asking.item.stats.firmsUsing : null}
      change={
        asking.status === 'DISABLED'
          ? 'becomes Disabled'
          : `becomes ${CATALOG_STATUS_LABELS[asking.status]}`
      }
      busy={change.isPending}
      onCancel={() => setAsking(null)}
      onConfirm={() => send({ ...asking, confirm: true })}
    />
  ) : null;

  return {
    request,
    dialog,
    /** The entry being saved, so its switch waits. */
    savingId: change.isPending ? change.variables?.item.id : undefined,
  };
}
