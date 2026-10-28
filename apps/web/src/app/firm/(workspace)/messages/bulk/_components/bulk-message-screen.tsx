'use client';

import type {
  AudienceCandidate,
  AudienceSummary,
  CommunicationChannel,
  CommunicationDetail,
} from '@firmivra/types';
import { Button, Checkbox, Stepper } from '@firmivra/ui';
import {
  CaretRight,
  ChatCircleDots,
  ChatText,
  CheckCircle,
  EnvelopeSimple,
  FileText,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { OriginLink } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../../lib/origin';
import { useApiQuery } from '../../../../../../lib/query';
import { Composer } from '../../../communications/_components/composer';
import {
  COMM_ERRORS,
  COMM_KEY,
  dateTimeText,
} from '../../../communications/_components/communications-shared';

type Step = 'audience' | 'message' | 'sent';
type Who = 'clients' | 'leads' | 'both';
type Channel = Extract<CommunicationChannel, 'EMAIL' | 'SMS'>;

const STEPS = [
  { id: 'audience', label: 'Audience' },
  { id: 'message', label: 'Message' },
  { id: 'review', label: 'Review' },
  { id: 'send', label: 'Send' },
];
const CHANNELS: { channel: Channel; label: string; hint: string; icon: typeof EnvelopeSimple }[] = [
  { channel: 'EMAIL', label: 'Email', hint: 'Send via email', icon: EnvelopeSimple },
  { channel: 'SMS', label: 'SMS / Text', hint: 'Send via text', icon: ChatText },
];
const REASONS: Record<keyof AudienceSummary['autoExcluded'], string> = {
  unsubscribed: 'Unsubscribed',
  invalid: 'Address or number not valid',
  missingChannel: 'No email or mobile for this channel',
  duplicate: 'Listed twice',
  ineligible: 'Not allowed for this channel',
};
const INELIGIBLE: Record<NonNullable<AudienceCandidate['ineligibleReason']>, string> = {
  UNSUBSCRIBED: 'Unsubscribed',
  INVALID: 'Not valid',
  MISSING_CHANNEL: 'No address for this channel',
  NO_CONSENT: 'No consent',
};
const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const blue =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-semibold text-action hover:bg-accent-soft';

/** The address of a place in the builder, keeping the way back to Messages. */
const addressOf = (id: string | undefined, step: Step) => {
  const params = new URLSearchParams(window.location.search);
  const from = safeOrigin(params.get(ORIGIN_PARAM));
  const next = new URLSearchParams();
  if (id) next.set('id', id);
  if (id && step !== 'audience') next.set('step', step);
  if (from) next.set(ORIGIN_PARAM, from);
  const query = next.toString();
  return `/messages/bulk${query ? `?${query}` : ''}`;
};

/**
 * /messages/bulk (MSG-F06): Send Bulk Message, kept in Messages. Audience, then Message, then
 * Review and Send, on the one Communications engine: the draft, the counts with their reasons,
 * consent and unsubscribes, the review checks, and the idempotent send or schedule are all
 * Communications'. Opening it saves nothing; nothing is sent without the explicit confirmation.
 */
export function BulkMessageScreen({
  initialId,
  initialStep,
}: {
  initialId?: string;
  initialStep: Step;
}) {
  const [id, setId] = useState(initialId);
  const [step, setStep] = useState<Step>(initialStep);
  useEffect(() => {
    const next = addressOf(id, step);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [id, step]);
  const detail = useApiQuery([...COMM_KEY, 'detail', id], async () =>
    id ? api.communications.get(id) : null,
  );
  const d = detail.data ?? undefined;
  // A draft that already went out (or is scheduled) shows where it stands.
  const shown: Step = d && !d.editable && d.status !== 'DRAFT' ? 'sent' : step;
  const current = shown === 'sent' ? 'send' : shown;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bulk-message">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChatCircleDots weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              Messages
            </h1>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
              <Link href="/messages" className="text-link hover:underline">
                Messages
              </Link>
              <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
              <span aria-current="page" className="font-semibold text-heading">
                Send Bulk Message
              </span>
            </nav>
            <p className="text-base text-muted">
              Reach multiple clients or leads with a personalized message.
            </p>
          </div>
        </div>
        <OriginLink href="/templates/library/email" className={blue}>
          <FileText aria-hidden weight="fill" className="size-5" /> Message Templates
        </OriginLink>
      </header>
      <div className={card}>
        <Stepper steps={STEPS} current={current} label="Bulk message steps" />
      </div>

      {detail.isError ? (
        <p role="alert" className={quiet}>
          This bulk message is not available. It may have been removed, or we could not load it.
        </p>
      ) : null}
      {!id ? (
        <Start onStarted={(newId) => setId(newId)} />
      ) : !d ? (
        detail.isPending ? (
          <p className={quiet}>Loading…</p>
        ) : null
      ) : shown === 'audience' ? (
        <Audience detail={d} onNext={() => setStep('message')} />
      ) : shown === 'message' ? (
        <section aria-label="Message" className="flex flex-col gap-3" data-testid="bulk-compose">
          <p className="text-sm text-muted">
            Write the message for the {d.audience?.finalCount ?? 0} recipients who can receive it.
            Review &amp; Send checks everything again and asks you to confirm before anything is
            sent.
          </p>
          <Composer
            id={d.id}
            embedded={{ onClose: () => setStep('audience'), onDone: () => setStep('sent') }}
          />
        </section>
      ) : (
        <Sent detail={d} />
      )}
    </div>
  );
}

/** Choose the channel. Nothing exists until Start: then a Communications draft. */
function Start({ onStarted }: { onStarted: (id: string) => void }) {
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <section aria-label="Start" className={`${card} flex flex-col gap-4`} data-testid="bulk-start">
      <div>
        <h2 className="text-xl font-bold text-heading">Communication Channel</h2>
        <p className="text-sm text-muted">
          Who can receive it depends on the channel: an email address, or a mobile number and
          consent to texts. Nothing is saved or sent until you start; a started message stays a
          draft until you send it.
        </p>
      </div>
      <div role="radiogroup" aria-label="Channel" className="grid gap-3 sm:grid-cols-2">
        {CHANNELS.map((c) => (
          <button
            key={c.channel}
            type="button"
            role="radio"
            aria-checked={channel === c.channel}
            onClick={() => setChannel(c.channel)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left ${channel === c.channel ? 'border-action bg-accent-soft' : 'border-divider hover:bg-canvas'}`}
          >
            <c.icon aria-hidden weight="fill" className="size-7 shrink-0 text-action" />
            <span>
              <span className="block font-semibold text-heading">{c.label}</span>
              <span className="block text-xs text-muted">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              onStarted((await api.communications.create({ channel })).id);
            } catch (e) {
              setError(errorMessage(e, COMM_ERRORS));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Starting…' : 'Start: Build the Audience'}
        </Button>
      </div>
    </section>
  );
}

type Pick = { clients: Map<string, string>; leads: Map<string, string> };

/**
 * Audience: Clients, Leads or Both, chosen one by one or all at once, saved to the draft as it
 * changes so the counts are the server's: Total, Can Receive and Cannot Receive with the reasons.
 */
function Audience({ detail, onNext }: { detail: CommunicationDetail; onNext: () => void }) {
  const qc = useQueryClient();
  const [who, setWho] = useState<Who>('clients');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [summary, setSummary] = useState<AudienceSummary | null>(detail.audience);
  const [error, setError] = useState<string>();
  const [pick, setPick] = useState<Pick>(() => ({
    clients: new Map(
      (detail.audience?.chips ?? []).filter((c) => c.kind === 'CLIENT').map((c) => [c.id, c.label]),
    ),
    leads: new Map(
      (detail.audience?.chips ?? []).filter((c) => c.kind === 'LEAD').map((c) => [c.id, c.label]),
    ),
  }));
  // Segments and exclusions chosen in Communications stay as they are.
  const keptRef = useRef({
    segmentIds: (detail.audience?.chips ?? []).filter((c) => c.kind === 'SEGMENT').map((c) => c.id),
    excludeClientIds: (detail.audience?.chips ?? [])
      .filter((c) => c.kind === 'EXCLUDE_CLIENT')
      .map((c) => c.id),
    excludeLeadIds: (detail.audience?.chips ?? [])
      .filter((c) => c.kind === 'EXCLUDE_LEAD')
      .map((c) => c.id),
  });
  const etagRef = useRef(detail.etag);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const query = (view: 'CONTACTS' | 'LEADS') =>
    api.communications.candidates({
      communicationId: detail.id,
      view,
      ...(term ? { search: term } : {}),
      page: 1,
      pageSize: 50,
    });
  const clients = useApiQuery([...COMM_KEY, 'bulk-candidates', detail.id, 'CONTACTS', term], () =>
    query('CONTACTS'),
  );
  const leads = useApiQuery([...COMM_KEY, 'bulk-candidates', detail.id, 'LEADS', term], () =>
    query('LEADS'),
  );
  const rows = [
    ...(who === 'leads' ? [] : (clients.data?.items ?? []).filter((c) => c.kind === 'CLIENT')),
    ...(who === 'clients' ? [] : (leads.data?.items ?? []).filter((c) => c.kind === 'LEAD')),
  ];
  const loading = (who !== 'leads' && clients.isPending) || (who !== 'clients' && leads.isPending);

  const sync = (next: Pick) => {
    setPick(next);
    chainRef.current = chainRef.current.then(async () => {
      try {
        const s = await api.communications.setAudience(detail.id, {
          ...keptRef.current,
          clientIds: [...next.clients.keys()],
          leadIds: [...next.leads.keys()],
          etag: etagRef.current,
        });
        const fresh = await api.communications.get(detail.id);
        etagRef.current = fresh.etag;
        qc.setQueryData([...COMM_KEY, 'detail', detail.id], fresh);
        setSummary(s);
        setError(undefined);
      } catch (e) {
        setError(errorMessage(e, COMM_ERRORS));
      }
    });
  };
  const chosen = (c: AudienceCandidate) =>
    (c.kind === 'LEAD' ? pick.leads : pick.clients).has(c.id);
  const toggle = (c: AudienceCandidate, on: boolean) => {
    const next = { clients: new Map(pick.clients), leads: new Map(pick.leads) };
    const map = c.kind === 'LEAD' ? next.leads : next.clients;
    if (on) map.set(c.id, c.label);
    else map.delete(c.id);
    sync(next);
  };
  const selectable = rows.filter((c) => c.eligible);
  const allOn = selectable.length > 0 && selectable.every(chosen);
  const cannot = summary
    ? Object.values(summary.autoExcluded).reduce((n, x) => n + x, 0) + summary.manualExcludedCount
    : 0;

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Build Your Audience" className={`${card} flex flex-col gap-3`}>
        <div>
          <h2 className="text-xl font-bold text-heading">1. Build Your Audience</h2>
          <p className="text-sm text-muted">Select who you want to message.</p>
        </div>
        <div role="tablist" aria-label="Who" className="flex border-b border-divider">
          {(
            [
              ['clients', 'Clients'],
              ['leads', 'Leads'],
              ['both', 'Both'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={who === id}
              onClick={() => setWho(id)}
              className={`-mb-px min-h-11 flex-1 border-b-2 px-4 text-sm ${who === id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
          <span className="sr-only">Search recipients</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        <div className="flex items-center justify-between gap-2 text-sm">
          <Checkbox
            label={`Select all shown (${selectable.length})`}
            checked={allOn}
            disabled={selectable.length === 0}
            onChange={(e) => {
              const next = { clients: new Map(pick.clients), leads: new Map(pick.leads) };
              for (const c of selectable) {
                const map = c.kind === 'LEAD' ? next.leads : next.clients;
                if (e.target.checked) map.set(c.id, c.label);
                else map.delete(c.id);
              }
              sync(next);
            }}
          />
          <button
            type="button"
            className="font-medium text-link"
            disabled={pick.clients.size + pick.leads.size === 0}
            onClick={() => sync({ clients: new Map(), leads: new Map() })}
          >
            Clear All
          </button>
        </div>
        {loading ? <p className={quiet}>Loading…</p> : null}
        {clients.isError || leads.isError ? (
          <p role="alert" className={quiet}>
            Recipients are not available right now.
          </p>
        ) : null}
        {!loading && rows.length === 0 ? <p className={quiet}>No one matches.</p> : null}
        <ul className="flex max-h-120 flex-col overflow-auto" data-testid="bulk-candidates">
          {rows.map((c) => (
            <li
              key={`${c.kind}${c.id}`}
              className="flex items-center justify-between gap-3 border-t border-divider py-1 first:border-t-0"
            >
              <Checkbox
                label={c.label}
                checked={chosen(c)}
                disabled={!c.eligible && !chosen(c)}
                onChange={(e) => toggle(c, e.target.checked)}
              />
              <span className="flex shrink-0 flex-col items-end text-xs">
                <span className="rounded-md bg-info-soft px-2 py-0.5 font-medium text-info">
                  {c.kind === 'LEAD' ? 'Lead' : 'Client'}
                </span>
                {c.eligible ? (
                  <span className="text-muted">{c.secondary}</span>
                ) : (
                  <span className="text-danger">
                    {c.ineligibleReason ? INELIGIBLE[c.ineligibleReason] : 'Cannot receive'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <aside aria-label="Recipients" className={`${card} flex flex-col gap-3`}>
        <h2 className="text-xl font-bold text-heading">2. Recipients</h2>
        <dl className="grid grid-cols-3 gap-2 text-center" data-testid="bulk-counts">
          <div className="rounded-lg bg-info-soft p-2">
            <dt className="text-xs text-info">Total Recipients</dt>
            <dd className="text-2xl font-bold text-heading">{summary?.selectedCount ?? 0}</dd>
          </div>
          <div className="rounded-lg bg-success-soft p-2">
            <dt className="text-xs text-success">Can Receive</dt>
            <dd className="text-2xl font-bold text-heading">{summary?.finalCount ?? 0}</dd>
          </div>
          <div className="rounded-lg bg-warning-soft p-2">
            <dt className="text-xs text-warning">Cannot Receive</dt>
            <dd className="text-2xl font-bold text-heading">{cannot}</dd>
          </div>
        </dl>
        {summary && cannot > 0 ? (
          <ul
            className="flex flex-col gap-1 text-sm text-text"
            aria-label="Why some cannot receive"
          >
            {(Object.keys(REASONS) as (keyof typeof REASONS)[])
              .filter((k) => summary.autoExcluded[k] > 0)
              .map((k) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{REASONS[k]}</span>
                  <span className="font-semibold">{summary.autoExcluded[k]}</span>
                </li>
              ))}
            {summary.manualExcludedCount > 0 ? (
              <li className="flex justify-between gap-2">
                <span>Left out by hand</span>
                <span className="font-semibold">{summary.manualExcludedCount}</span>
              </li>
            ) : null}
          </ul>
        ) : null}
        <p className="text-xs text-muted">
          Consent and unsubscribes are checked now and again right before sending; someone counted
          twice receives it once.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button disabled={(summary?.finalCount ?? 0) === 0} onClick={onNext}>
          Continue to Message
        </Button>
      </aside>
    </div>
  );
}

/** Send: what happened, with the results and the way back. */
function Sent({ detail }: { detail: CommunicationDetail }) {
  const scheduled = detail.status === 'SCHEDULED';
  return (
    <section
      aria-label="Sent"
      className={`${card} flex flex-col items-start gap-3`}
      data-testid="bulk-sent"
    >
      <h2 className="flex items-center gap-2 text-xl font-bold text-heading">
        <CheckCircle aria-hidden weight="fill" className="size-6 text-success" />
        {scheduled ? 'Scheduled' : 'Sending'}
      </h2>
      <p className="text-sm text-text">
        {scheduled && detail.scheduledFor
          ? `It goes out ${dateTimeText(detail.scheduledFor)} (${detail.timezone}). You can change or cancel it until then in Communications.`
          : 'It is on its way. Results show each recipient as delivered, failed or skipped with the reason; only failed ones can be sent again.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <OriginLink href={`/communications/${detail.id}`} className={blue}>
          View Results
        </OriginLink>
        <Link href="/messages" className={blue}>
          Back to Messages
        </Link>
      </div>
    </section>
  );
}
