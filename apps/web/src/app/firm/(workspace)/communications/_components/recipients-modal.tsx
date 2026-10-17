'use client';

import type { AudienceCandidate, AudienceSummary, CommunicationDetail } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import {
  Calendar,
  CalendarCheck,
  Info,
  MagnifyingGlass,
  Plus,
  Prohibit,
  Target,
  UsersThree,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { SegmentDialog } from './segments-panel';
import { COMM_ERRORS, COMM_KEY, quiet } from './communications-shared';

const VIEWS = [
  { id: 'CONTACTS', label: 'All Contacts', icon: UsersThree },
  { id: 'SEGMENTS', label: 'Saved Segments', icon: UsersThree },
  { id: 'SERVICES', label: 'Client Services', icon: Target },
  { id: 'STATUSES', label: 'Client Status', icon: CalendarCheck },
  { id: 'LEADS', label: 'Leads', icon: Target },
  { id: 'LISTS', label: 'Custom Lists', icon: Calendar },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const REASON: Record<string, string> = {
  UNSUBSCRIBED: 'Unsubscribed',
  INVALID: 'Invalid address',
  MISSING_CHANNEL: 'No phone number',
  NO_CONSENT: 'No consent',
};

interface Pick {
  segments: Map<string, string>;
  clients: Map<string, string>;
  leads: Map<string, string>;
  exClients: Set<string>;
  exLeads: Set<string>;
}
const emptyPick = (): Pick => ({
  segments: new Map(),
  clients: new Map(),
  leads: new Map(),
  exClients: new Set(),
  exLeads: new Set(),
});
const payload = (p: Pick) => ({
  segmentIds: [...p.segments.keys()],
  clientIds: [...p.clients.keys()],
  leadIds: [...p.leads.keys()],
  excludeClientIds: [...p.exClients],
  excludeLeadIds: [...p.exLeads],
});

/**
 * Choose Recipients & Segments: groups on the left, the segments or people in each, and what is
 * chosen and left out. The draft's audience is saved as the choice changes so the counts are the
 * server's; Cancel puts the audience back the way it was.
 */
export function RecipientsModal({
  detail,
  onClose,
  onApplied,
}: {
  detail: CommunicationDetail;
  onClose: () => void;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<ViewId>('SEGMENTS');
  const [individuals, setIndividuals] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<AudienceSummary | null>(detail.audience);
  const [pick, setPick] = useState<Pick>(() => {
    const p = emptyPick();
    for (const c of detail.audience?.chips ?? []) {
      if (c.kind === 'SEGMENT') p.segments.set(c.id, c.label);
      else if (c.kind === 'CLIENT') p.clients.set(c.id, c.label);
      else if (c.kind === 'LEAD') p.leads.set(c.id, c.label);
      else if (c.kind === 'EXCLUDE_CLIENT') p.exClients.add(c.id);
      else p.exLeads.add(c.id);
    }
    return p;
  });
  const initial = useRef(payload(pick));
  const etag = useRef(detail.etag);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const touched = useRef(false);
  const term = useDeferredValue(search.trim());
  const listView: ViewId = individuals && view !== 'LEADS' ? 'CONTACTS' : view;
  const list = useApiQuery([...COMM_KEY, 'candidates', detail.id, listView, term], () =>
    api.communications.candidates({
      communicationId: detail.id,
      view: listView,
      ...(term ? { search: term } : {}),
      page: 1,
      pageSize: 50,
    }),
  );

  /** Saves the choice to the draft, one at a time, and shows the server's counts. */
  const sync = (next: Pick) => {
    touched.current = true;
    chain.current = chain.current.then(async () => {
      try {
        const s = await api.communications.setAudience(detail.id, {
          ...payload(next),
          etag: etag.current,
        });
        etag.current = (await api.communications.get(detail.id)).etag;
        setSummary(s);
        setError(undefined);
      } catch (e) {
        setError(errorMessage(e, COMM_ERRORS));
      }
    });
  };
  const change = (next: Pick) => {
    setPick(next);
    sync(next);
  };

  const cancel = async () => {
    setBusy(true);
    await chain.current;
    if (touched.current) {
      try {
        await api.communications.setAudience(detail.id, { ...initial.current, etag: etag.current });
      } catch {
        // the draft keeps the last saved choice; the composer reloads it
      }
      await qc.invalidateQueries({ queryKey: [...COMM_KEY, 'detail', detail.id] });
    }
    onClose();
  };

  const copy = (): Pick => ({
    segments: new Map(pick.segments),
    clients: new Map(pick.clients),
    leads: new Map(pick.leads),
    exClients: new Set(pick.exClients),
    exLeads: new Set(pick.exLeads),
  });
  const mapOf = (p: Pick, c: AudienceCandidate['kind']) =>
    c === 'SEGMENT' ? p.segments : c === 'CLIENT' ? p.clients : p.leads;
  const toggle = (c: AudienceCandidate, on: boolean) => {
    const next = copy();
    if (on) mapOf(next, c.kind).set(c.id, c.label);
    else mapOf(next, c.kind).delete(c.id);
    change(next);
  };
  const isOn = (c: AudienceCandidate) => mapOf(pick, c.kind).has(c.id);
  const isOut = (c: AudienceCandidate) =>
    (c.kind === 'LEAD' ? pick.exLeads : pick.exClients).has(c.id);
  const exclude = (c: AudienceCandidate) => {
    const next = copy();
    const set = c.kind === 'LEAD' ? next.exLeads : next.exClients;
    if (set.has(c.id)) set.delete(c.id);
    else set.add(c.id);
    change(next);
  };
  const none = pick.segments.size + pick.clients.size + pick.leads.size === 0;
  const items = list.data?.items ?? [];
  const chosen = [
    ...[...pick.segments].map(([id, label]) => ({ id, kind: 'SEGMENT' as const, label })),
    ...[...pick.clients].map(([id, label]) => ({ id, kind: 'CLIENT' as const, label })),
    ...[...pick.leads].map(([id, label]) => ({ id, kind: 'LEAD' as const, label })),
  ];
  const remove = (c: (typeof chosen)[number]) => {
    const next = copy();
    mapOf(next, c.kind).delete(c.id);
    change(next);
  };
  const clear = () => change(emptyPick());
  const auto = summary?.autoExcluded;
  const autoTotal = auto
    ? auto.unsubscribed + auto.invalid + auto.missingChannel + auto.duplicate + auto.ineligible
    : 0;
  const final = none ? 0 : (summary?.finalCount ?? 0);

  return (
    <Modal
      open
      title="Choose Recipients"
      subtitle="Select audiences, lists, or individual contacts for this communication."
      onClose={() => void cancel()}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <button type="button" className="text-sm font-medium text-link underline" onClick={clear}>
            Clear Selection
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </Button>
            <Button
              disabled={busy || none}
              onClick={async () => {
                setBusy(true);
                await chain.current;
                onApplied();
              }}
            >
              Apply {none ? '' : `${final} `}Recipients
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-w-full" data-testid="recipients-modal">
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
          <nav aria-label="Recipient groups" className="flex gap-1 overflow-x-auto md:col-span-2">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => {
                  setView(v.id);
                  setIndividuals(false);
                }}
                className={`flex min-h-11 shrink-0 items-center gap-3 rounded-control px-3 text-left text-sm whitespace-nowrap ${view === v.id ? 'bg-accent-soft font-semibold text-action' : 'text-heading hover:bg-canvas'}`}
              >
                <v.icon aria-hidden weight="fill" className="size-5 shrink-0 text-action" />{' '}
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
                placeholder="Search segments or contacts..."
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
            </label>
            {view !== 'CONTACTS' && view !== 'LEADS' ? (
              <div
                className="grid grid-cols-2 overflow-hidden rounded-control border border-border"
                role="group"
                aria-label="Show"
              >
                {[
                  ['Segments', false],
                  ['Individuals', true],
                ].map(([label, on]) => (
                  <button
                    key={label as string}
                    type="button"
                    aria-pressed={individuals === on}
                    onClick={() => setIndividuals(on as boolean)}
                    className={`min-h-9 text-sm ${individuals === on ? 'bg-action font-semibold text-on-action' : 'text-heading hover:bg-canvas'}`}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="max-h-80 overflow-auto" data-testid="candidates">
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
                  className={`flex items-center gap-3 border-t border-divider px-2 py-2 first:border-t-0 ${isOn(c) ? 'bg-info-soft' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={c.label}
                    className="size-4 shrink-0"
                    checked={isOn(c)}
                    disabled={!c.eligible}
                    onChange={(e) => toggle(c, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-heading">
                      {c.label}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {c.secondary}
                      {c.ineligibleReason ? ` · ${REASON[c.ineligibleReason]}` : ''}
                    </span>
                  </span>
                  {c.count !== null ? (
                    <span className="shrink-0 text-sm text-text">{c.count}</span>
                  ) : null}
                  {c.kind !== 'SEGMENT' && c.eligible ? (
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-link"
                      onClick={() => exclude(c)}
                    >
                      {isOut(c) ? 'Include' : 'Exclude'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="inline-flex w-fit items-center gap-2 rounded-control bg-info-soft px-4 py-2 text-sm font-medium text-action"
              onClick={() => setCreating(true)}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Create New Segment
            </button>
          </div>
          <aside className="flex min-w-0 flex-col gap-3" aria-label="Selected audience">
            <section
              className="rounded-lg border border-divider p-3"
              data-testid="selected-audience"
            >
              <h3 className="mb-2 font-display text-lg font-bold text-heading">
                Selected Audience
              </h3>
              {chosen.length === 0 ? (
                <p className="text-sm text-muted">Nobody chosen yet.</p>
              ) : null}
              <ul className="flex flex-col gap-1.5">
                {chosen.map((c) => (
                  <li
                    key={`${c.kind}${c.id}`}
                    className="flex items-center gap-2 rounded-lg bg-info-soft p-2 text-sm"
                  >
                    <UsersThree aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                    <span className="min-w-0 flex-1 truncate font-medium text-heading">
                      {c.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${c.label}`}
                      onClick={() => remove(c)}
                      className="flex size-6 items-center justify-center rounded-full bg-surface hover:bg-canvas"
                    >
                      <X aria-hidden weight="bold" className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
              <p
                className="mt-2 flex justify-between text-sm text-heading"
                data-testid="recipient-total"
              >
                <span>Estimated recipients</span>
                <span className="font-display text-xl font-bold text-action">
                  {summary && !none ? summary.selectedCount : 0}
                </span>
              </p>
            </section>
            <section
              className="rounded-lg border border-divider p-3"
              aria-label="Exclude contacts"
              data-testid="exclusions"
            >
              <h3 className="mb-2 font-display text-lg font-bold text-heading">Exclude Contacts</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {[
                  {
                    label: 'Unsubscribed contacts',
                    note: 'Automatically excluded',
                    n: auto?.unsubscribed ?? 0,
                    icon: Prohibit,
                  },
                  {
                    label: 'Invalid addresses',
                    note: 'Automatically excluded',
                    n: (auto?.invalid ?? 0) + (auto?.missingChannel ?? 0),
                    icon: Warning,
                  },
                  {
                    label: 'Manually excluded',
                    note: 'Left out by you',
                    n: summary?.manualExcludedCount ?? 0,
                    icon: UsersThree,
                  },
                ].map((x) => (
                  <li
                    key={x.label}
                    className="flex items-center gap-2 rounded-lg border border-divider p-2"
                  >
                    <x.icon aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-heading">{x.label}</span>
                      <span className="block text-xs text-muted">{x.note}</span>
                    </span>
                    <span className="font-medium text-heading">{none ? 0 : x.n}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-control border border-action px-3 py-2 text-sm font-medium text-action hover:bg-accent-soft"
                onClick={() => {
                  setView('CONTACTS');
                  setIndividuals(false);
                }}
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Exclusions
              </button>
            </section>
            <section className="rounded-lg border border-divider p-3" aria-label="Recipient total">
              <h3 className="mb-2 font-display text-lg font-bold text-heading">Recipient Total</h3>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Selected contacts</dt>
                  <dd className="text-heading">{none ? 0 : (summary?.selectedCount ?? 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Automatic exclusions</dt>
                  <dd className="text-heading">{none ? 0 : autoTotal}</dd>
                </div>
                <div className="mt-1 flex justify-between border-t border-divider pt-2">
                  <dt className="font-semibold text-heading">Final recipients</dt>
                  <dd
                    className="font-display text-xl font-bold text-success"
                    data-testid="final-total"
                  >
                    {final}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-info-soft p-2 text-xs text-info">
                <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                Only contacts with the required communication consent will receive this message.
              </p>
            </section>
          </aside>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {creating ? (
        <SegmentDialog
          canManage
          onClose={() => setCreating(false)}
          onNotice={(text, tone) => {
            if (tone === 'error') setError(text);
            else void qc.invalidateQueries({ queryKey: [...COMM_KEY, 'candidates'] });
          }}
        />
      ) : null}
    </Modal>
  );
}
