'use client';

import { ESIGN_BULK_MAX } from '@firmivra/types';
import { Button, Checkbox, Input, Select } from '@firmivra/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { shouldRetry } from '../../../../../../lib/query';

/**
 * The clients chosen so far, in the order picked: the name, the service to file under, and how
 * many open services the client has (0 until known; more than one means one must be picked).
 */
export type Chosen = Map<string, { name: string; engagementId: string; services: number }>;

/** Search the client list and tick clients; the chosen ones stay listed across searches. */
export function ClientChecklist({
  chosen,
  error,
  onChange,
}: {
  chosen: Chosen;
  error?: string;
  /**
   * Takes an update of the latest choice, as several rows can report at once. `known` marks a
   * row reporting its service count, which isn't the sender changing anything.
   */
  onChange: (update: (prev: Chosen) => Chosen, known?: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['clients', 'list', 'esign-bulk', search],
    queryFn: ({ pageParam }) =>
      api.clients.list({
        limit: 50,
        ...(search && { search }),
        ...(pageParam && { cursor: pageParam }),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
  const listed = list.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.size >= ESIGN_BULK_MAX;
  const toggle = (id: string, name: string, on: boolean) =>
    onChange((prev) => {
      const next = new Map(prev);
      if (on) next.set(id, { name, engagementId: '', services: 0 });
      else next.delete(id);
      return next;
    });
  const update = (id: string, patch: { engagementId?: string; services?: number }) =>
    onChange((prev) => {
      const c = prev.get(id);
      if (!c) return prev;
      return new Map(prev).set(id, { ...c, ...patch });
    }, patch.services !== undefined);

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 font-semibold text-heading">Clients</legend>
      <p className="text-sm text-muted">
        Each client gets a separate request with its own signers, record and signed copy. At most{' '}
        {ESIGN_BULK_MAX}.
      </p>
      <Input
        label="Find clients"
        type="search"
        maxLength={100}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {list.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(list.error)}
        </p>
      )}
      <div data-testid="client-results" className="flex flex-col">
        {listed.map((c) => (
          <Checkbox
            key={c.id}
            label={c.email ? `${c.displayName} (${c.email})` : c.displayName}
            checked={chosen.has(c.id)}
            disabled={!chosen.has(c.id) && full}
            onChange={(e) => toggle(c.id, c.displayName, e.target.checked)}
          />
        ))}
        {list.data && listed.length === 0 && (
          <p className="text-sm text-muted">No client matches that search.</p>
        )}
      </div>
      {list.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading…' : 'More clients'}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2" aria-live="polite">
        <p data-testid="chosen-count" className="text-sm font-medium text-text">
          {chosen.size} {chosen.size === 1 ? 'client' : 'clients'} chosen
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {chosen.size > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {[...chosen].map(([id, c]) => (
              <ChosenClient
                key={id}
                id={id}
                name={c.name}
                engagementId={c.engagementId}
                services={c.services}
                onService={(e) => update(id, { engagementId: e })}
                onServices={(n) => update(id, { services: n })}
                onRemove={() => toggle(id, c.name, false)}
              />
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

/**
 * One chosen client. With more than one open service the sender picks where the signed copy is
 * filed; with one, it is used; with none, the copy goes to the client's documents.
 */
function ChosenClient({
  id,
  name,
  engagementId,
  services,
  onService,
  onServices,
  onRemove,
}: {
  id: string;
  name: string;
  engagementId: string;
  services: number;
  onService: (engagementId: string) => void;
  onServices: (count: number) => void;
  onRemove: () => void;
}) {
  const list = useQuery({
    queryKey: ['engagements', id],
    queryFn: () => api.engagements.listForClient(id),
    retry: shouldRetry,
  });
  const open = (list.data ?? []).filter((e) => ['PENDING', 'ACTIVE'].includes(e.status));
  // The parent checks, before sending, that a client with several services has one picked.
  useEffect(() => {
    if (list.data && open.length !== services) onServices(open.length);
  }, [list.data, open.length, services, onServices]);
  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-sm font-medium text-text">{name}</span>
        {open.length > 1 && (
          <Select
            label={`${name}: service`}
            value={engagementId}
            onChange={(e) => onService(e.target.value)}
            options={[
              { value: '', label: 'Choose the service' },
              ...open.map((e) => ({ value: e.id, label: e.title })),
            ]}
          />
        )}
      </div>
      <Button variant="ghost" aria-label={`Remove ${name}`} onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}
