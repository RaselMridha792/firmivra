'use client';

import type { AudienceCandidate, CommunicationDetail } from '@firmivra/types';
import { Button, Checkbox, Modal } from '@firmivra/ui';
import { MagnifyingGlass, UsersThree, X } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { COMM_ERRORS, COMM_KEY, quiet } from './communications-shared';

const VIEWS = [
  { id: 'CONTACTS', label: 'All Contacts' },
  { id: 'SEGMENTS', label: 'Saved Segments' },
  { id: 'SERVICES', label: 'Client Services' },
  { id: 'STATUSES', label: 'Client Status' },
  { id: 'LEADS', label: 'Leads' },
  { id: 'LISTS', label: 'Custom Lists' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const REASON: Record<string, string> = {
  UNSUBSCRIBED: 'Unsubscribed',
  INVALID: 'Invalid address',
  MISSING_CHANNEL: 'No phone number',
  NO_CONSENT: 'No consent',
};

interface Pick {
  segments: Map<string, { label: string; count: number | null }>;
  clients: Map<string, string>;
  leads: Map<string, string>;
  exClients: Set<string>;
  exLeads: Set<string>;
}

/** Choose Recipients & Segments: groups on the left, the people or segments in each, and what is chosen and left out. */
export function RecipientsModal({
  detail,
  onClose,
  onApplied,
}: {
  detail: CommunicationDetail;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [view, setView] = useState<ViewId>('SEGMENTS');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Pick>(() => {
    const p: Pick = {
      segments: new Map(),
      clients: new Map(),
      leads: new Map(),
      exClients: new Set(),
      exLeads: new Set(),
    };
    for (const c of detail.audience?.chips ?? []) {
      if (c.kind === 'SEGMENT') p.segments.set(c.id, { label: c.label, count: c.count });
      else if (c.kind === 'CLIENT') p.clients.set(c.id, c.label);
      else if (c.kind === 'LEAD') p.leads.set(c.id, c.label);
      else if (c.kind === 'EXCLUDE_CLIENT') p.exClients.add(c.id);
      else p.exLeads.add(c.id);
    }
    return p;
  });
  const term = useDeferredValue(search.trim());
  const list = useApiQuery([...COMM_KEY, 'candidates', detail.id, view, term], () =>
    api.communications.candidates({
      communicationId: detail.id,
      view,
      ...(term ? { search: term } : {}),
      page: 1,
      pageSize: 50,
    }),
  );
  const toggle = (c: AudienceCandidate, on: boolean) => {
    const next: Pick = {
      ...pick,
      segments: new Map(pick.segments),
      clients: new Map(pick.clients),
      leads: new Map(pick.leads),
    };
    const map =
      c.kind === 'SEGMENT' ? next.segments : c.kind === 'CLIENT' ? next.clients : next.leads;
    if (on)
      map.set(
        c.id,
        c.kind === 'SEGMENT' ? ({ label: c.label, count: c.count } as never) : (c.label as never),
      );
    else map.delete(c.id);
    setPick(next);
  };
  const isOn = (c: AudienceCandidate) =>
    c.kind === 'SEGMENT'
      ? pick.segments.has(c.id)
      : c.kind === 'CLIENT'
        ? pick.clients.has(c.id)
        : pick.leads.has(c.id);
  const estimate =
    [...pick.segments.values()].reduce((n, s) => n + (s.count ?? 0), 0) +
    pick.clients.size +
    pick.leads.size -
    pick.exClients.size -
    pick.exLeads.size;
  const none = pick.segments.size + pick.clients.size + pick.leads.size === 0;
  const items = list.data?.items ?? [];
  const chosen = [
    ...[...pick.segments].map(([id, s]) => ({ id, kind: 'SEGMENT' as const, label: s.label })),
    ...[...pick.clients].map(([id, label]) => ({ id, kind: 'CLIENT' as const, label })),
    ...[...pick.leads].map(([id, label]) => ({ id, kind: 'LEAD' as const, label })),
  ];
  const remove = (c: (typeof chosen)[number]) => {
    const next: Pick = {
      ...pick,
      segments: new Map(pick.segments),
      clients: new Map(pick.clients),
      leads: new Map(pick.leads),
    };
    (c.kind === 'SEGMENT' ? next.segments : c.kind === 'CLIENT' ? next.clients : next.leads).delete(
      c.id,
    );
    setPick(next);
  };
  const exclude = (c: AudienceCandidate, on: boolean) => {
    const set = new Set(c.kind === 'LEAD' ? pick.exLeads : pick.exClients);
    if (on) set.add(c.id);
    else set.delete(c.id);
    setPick(c.kind === 'LEAD' ? { ...pick, exLeads: set } : { ...pick, exClients: set });
  };

  return (
    <Modal
      open
      title="Choose Recipients"
      subtitle="Pick segments, lists or people. Unsubscribed and invalid contacts are left out automatically."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || none}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await api.communications.setAudience(detail.id, {
                  segmentIds: [...pick.segments.keys()],
                  clientIds: [...pick.clients.keys()],
                  leadIds: [...pick.leads.keys()],
                  excludeClientIds: [...pick.exClients],
                  excludeLeadIds: [...pick.exLeads],
                  etag: detail.etag,
                });
                onApplied();
              } catch (e) {
                setError(errorMessage(e, COMM_ERRORS));
                setBusy(false);
              }
            }}
          >
            Apply {none ? '' : `${estimate} `}Recipients
          </Button>
        </>
      }
    >
      <div
        className="grid min-w-0 gap-4 md:grid-cols-[11rem_minmax(0,1fr)_14rem]"
        data-testid="recipients-modal"
      >
        <nav aria-label="Recipient groups" className="flex gap-1 overflow-x-auto md:flex-col">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className={`min-h-10 shrink-0 rounded-control px-3 text-left text-sm whitespace-nowrap ${view === v.id ? 'bg-accent-soft font-semibold text-action' : 'text-heading hover:bg-canvas'}`}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-2">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
            <span className="sr-only">Search recipients</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
          <ul className="max-h-72 overflow-auto" data-testid="candidates">
            {list.isPending ? <li className={quiet}>Loading…</li> : null}
            {list.isError ? (
              <li className={quiet}>Recipients are not available right now.</li>
            ) : null}
            {!list.isPending && !list.isError && items.length === 0 ? (
              <li className={quiet}>Nothing matches.</li>
            ) : null}
            {items.map((c) => (
              <li
                key={`${c.kind}${c.id}`}
                className="flex items-center justify-between gap-2 border-t border-divider py-1.5 first:border-t-0"
              >
                <Checkbox
                  label={`${c.label}${c.secondary ? ` · ${c.secondary}` : ''}`}
                  checked={isOn(c)}
                  disabled={!c.eligible}
                  onChange={(e) => toggle(c, e.target.checked)}
                />
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {c.count !== null ? `${c.count}` : null}
                  {c.ineligibleReason ? REASON[c.ineligibleReason] : null}
                  {c.kind !== 'SEGMENT' && isOn(c) ? (
                    <button
                      type="button"
                      className="font-medium text-link"
                      onClick={() =>
                        exclude(c, !(c.kind === 'LEAD' ? pick.exLeads : pick.exClients).has(c.id))
                      }
                    >
                      {(c.kind === 'LEAD' ? pick.exLeads : pick.exClients).has(c.id)
                        ? 'Include'
                        : 'Exclude'}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <aside
          className="flex min-w-0 flex-col gap-3 rounded-lg bg-canvas p-3"
          aria-label="Selected audience"
          data-testid="selected-audience"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-heading">
            <UsersThree aria-hidden weight="fill" className="size-4 text-action" /> Selected
            Audience
          </h3>
          {chosen.length === 0 ? <p className="text-sm text-muted">Nobody chosen yet.</p> : null}
          <ul className="flex flex-wrap gap-1.5">
            {chosen.map((c) => (
              <li
                key={`${c.kind}${c.id}`}
                className="inline-flex max-w-full items-center gap-1 rounded-pill bg-info-soft py-1 pr-1 pl-3 text-xs font-medium text-info"
              >
                <span className="truncate">{c.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${c.label}`}
                  onClick={() => remove(c)}
                  className="flex size-5 items-center justify-center rounded-full hover:bg-surface"
                >
                  <X aria-hidden weight="bold" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          {pick.exClients.size + pick.exLeads.size > 0 ? (
            <p className="text-xs text-muted">
              {pick.exClients.size + pick.exLeads.size} left out by hand.
            </p>
          ) : null}
          <p
            className="border-t border-divider pt-2 text-sm text-heading"
            data-testid="recipient-total"
          >
            <span className="font-semibold">Recipient Total:</span>{' '}
            {none ? 0 : Math.max(0, estimate)}
          </p>
          <p className="text-xs text-muted">The exact count is checked when you apply.</p>
        </aside>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
