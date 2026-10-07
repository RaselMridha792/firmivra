'use client';

import { useEffect, useState } from 'react';
import {
  ListTaxStatusesResponse,
  FirmTaxStatus,
  CreateTaxStatusRequest,
  RenameTaxStatusRequest,
  OrderTaxStatusesRequest,
} from '@firmivra/types';
import { Alert, Button, Card, EmptyState, Input, Modal, Skeleton } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { workspaceError, workspaceRequest } from '../lib/workspace-api';

export function TaxStatuses() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? '';
  const [items, setItems] = useState<FirmTaxStatus[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [target, setTarget] = useState<{
    item: FirmTaxStatus;
    action: 'rename' | 'archive';
  } | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    workspaceRequest(businessId, '/business/tax-statuses', ListTaxStatusesResponse, {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) {
          setItems(result.items);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setItems([]);
          setError(workspaceError(cause));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [businessId, revision]);
  function reload() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  async function change(action: 'create' | 'rename' | 'archive' | 'order', ids?: string[]) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'create') {
        await workspaceRequest(businessId, '/business/tax-statuses', FirmTaxStatus, {
          method: 'POST',
          body: CreateTaxStatusRequest.parse({ name: name.trim() }),
        });
        setName('');
      } else if (action === 'order') {
        await workspaceRequest(
          businessId,
          '/business/tax-statuses/order',
          ListTaxStatusesResponse,
          { method: 'PUT', body: OrderTaxStatusesRequest.parse({ ids }) },
        );
      } else if (target) {
        await workspaceRequest(
          businessId,
          `/business/tax-statuses/${target.item.id}${action === 'archive' ? '/archive' : ''}`,
          FirmTaxStatus,
          {
            method: action === 'archive' ? 'POST' : 'PATCH',
            ...(action === 'rename'
              ? { body: RenameTaxStatusRequest.parse({ name: newName.trim() }) }
              : {}),
          },
        );
        setTarget(null);
      }
      setNotice(action === 'archive' ? 'Tax status archived.' : 'Tax statuses saved.');
      reload();
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, direction: number) {
    const ids = items.map((item) => item.id);
    const other = index + direction;
    const current = ids[index];
    const replacement = ids[other];
    if (!current || !replacement) return;
    ids[index] = replacement;
    ids[other] = current;
    void change('order', ids);
  }
  return (
    <Card title="Tax statuses">
      <div className="space-y-4">
        {error ? (
          <Alert tone="danger" title="Tax statuses could not be saved or loaded">
            {error}
            <Button variant="link" disabled={busy} onClick={reload}>
              Retry
            </Button>
          </Alert>
        ) : null}
        {notice ? <Alert tone="success" title={notice} /> : null}
        {loading ? (
          <Skeleton className="h-24" />
        ) : !items.length ? (
          <EmptyState
            title="No tax statuses"
            description="Add the statuses your firm uses for tax work."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item, index) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>{item.name}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy || index === 0}
                    aria-label={`Move ${item.name} up`}
                    onClick={() => move(index, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || index === items.length - 1}
                    aria-label={`Move ${item.name} down`}
                    onClick={() => move(index, 1)}
                  >
                    Down
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setNewName(item.name);
                      setTarget({ item, action: 'rename' });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => setTarget({ item, action: 'archive' })}
                  >
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="New tax status"
            value={name}
            maxLength={120}
            disabled={busy || loading || !!error}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            disabled={busy || loading || !!error || !name.trim()}
            onClick={() => void change('create')}
          >
            Add status
          </Button>
        </div>
      </div>
      <Modal
        open={!!target}
        title={target?.action === 'archive' ? 'Archive tax status' : 'Rename tax status'}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
      >
        <div className="space-y-4">
          {error ? (
            <Alert tone="danger" title="The change was not saved">
              {error}
            </Alert>
          ) : null}
          {target?.action === 'archive' ? (
            <p>Archive {target.item.name}? Existing client assignments remain intact.</p>
          ) : (
            <Input
              label="Status name"
              value={newName}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setNewName(event.target.value)}
            />
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || (target?.action === 'rename' && !newName.trim())}
              onClick={() => target && void change(target.action)}
            >
              {target?.action === 'archive' ? 'Confirm archive' : 'Save status'}
            </Button>
          </>
        </div>
      </Modal>
    </Card>
  );
}
