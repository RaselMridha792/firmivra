'use client';

import type {
  CommunicationDetail,
  CommunicationRecipient,
  CommunicationResults,
} from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  Archive,
  CaretRight,
  CheckCircle,
  Copy,
  CursorClick,
  DotsThreeVertical,
  DownloadSimple,
  EnvelopeOpen,
  FileText,
  Info as InfoIcon,
  MagnifyingGlass,
  PaperPlaneTilt,
  Repeat,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { RescheduleDialog, SaveTemplateDialog, useAct } from './communication-actions';
import {
  COMM_ERRORS,
  COMM_KEY,
  StatusPill,
  card,
  channelOf,
  dateTimeText,
  dayText,
  linkBtn,
  percent,
  plain,
  quiet,
  subtle,
  timeText,
} from './communications-shared';

const TABS = ['Overview', 'Recipients', 'Activity', 'Message', 'Settings'] as const;
type TabId = (typeof TABS)[number];

const RECIPIENT_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  OPENED: 'Opened',
  CLICKED: 'Clicked',
  BOUNCED: 'Bounced',
  FAILED: 'Failed',
  UNSUBSCRIBED: 'Unsubscribed',
  NOT_SENT: 'Not sent',
};
const RECIPIENT_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning' | 'neutral'> = {
  DELIVERED: 'success',
  OPENED: 'info',
  CLICKED: 'info',
  BOUNCED: 'danger',
  FAILED: 'danger',
  UNSUBSCRIBED: 'neutral',
  NOT_SENT: 'neutral',
  QUEUED: 'warning',
  SENT: 'info',
};

/** /communications/[id]: Communication Details & Results. */
export function ResultsScreen({ id }: { id: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('Overview');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<'template' | 'follow' | 'reschedule'>();
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const act = useAct(notice);
  const results = useApiQuery([...COMM_KEY, 'results', id], () => api.communications.results(id));
  const r = results.data;
  const d = r?.communication;

  if (results.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="results-error">
        <Link href="/communications" className="text-sm font-medium text-link">
          ← Back to Communications
        </Link>
        <p role="alert" className={quiet}>
          These results are not available. The communication may have been removed, or we could not
          load it.
        </p>
      </div>
    );
  if (!r || !d) return <p className={quiet}>Loading…</p>;
  const m = r.metrics;
  const draftFrom = async (work: () => Promise<CommunicationDetail>, done: string) => {
    const c = await act(work, done);
    if (c) router.push(`/communications/${c.id}/edit`);
  };
  const exportResults = async () => {
    try {
      const x = await api.communications.exportResults(id);
      notice(`Export ready: ${x.fileName} (${x.rowCount} rows).`, 'success');
    } catch (e) {
      notice(errorMessage(e, COMM_ERRORS), 'error');
    }
  };
  const when = d.sentAt ?? d.scheduledFor;
  const duplicate = () =>
    void draftFrom(() => api.communications.duplicate(id), 'Copied to a new draft.');
  const archive = () => void act(() => api.communications.archive(id), 'Archived.');

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="results-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/communications" className="text-link">
          ← Sent History
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold wrap-break-word text-heading">
              {d.subject ?? d.name}
            </h1>
            <Badge tone="neutral">{channelOf(d.channel).label} Campaign</Badge>
            <StatusPill status={d.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {when
              ? `${d.sentAt ? 'Sent' : 'Scheduled for'} ${dayText(when)} at ${timeText(when)}`
              : 'Not sent yet'}{' '}
            · Created by {d.createdBy.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions">
          <button type="button" className={subtle} onClick={duplicate}>
            <Copy aria-hidden weight="bold" className="size-4" /> Duplicate
          </button>
          {r.canExport ? (
            <button type="button" className={subtle} onClick={() => void exportResults()}>
              <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export Results
            </button>
          ) : null}
          {d.status === 'SCHEDULED' ? (
            <button type="button" className={subtle} onClick={() => setDialog('reschedule')}>
              Reschedule
            </button>
          ) : null}
          <ActionMenu
            label="More actions"
            trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
            align="right"
            sections={[
              {
                items: d.archived
                  ? [
                      {
                        label: 'Restore',
                        icon: Archive,
                        onSelect: () => void act(() => api.communications.restore(id), 'Restored.'),
                      },
                    ]
                  : [{ label: 'Archive', icon: Archive, danger: true, onSelect: archive }],
              },
            ]}
          />
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      {m.totalRecipients === 0 ? (
        <p className={quiet} data-testid="no-results">
          {d.status === 'SENT' || d.status === 'SENDING'
            ? 'Results will appear here as messages are delivered.'
            : 'This communication has not been sent, so there are no results yet.'}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="result-kpis">
          <li>
            <KpiCard
              icon={UsersThree}
              tone="blue"
              value={m.totalRecipients}
              label="Total Recipients"
            />
          </li>
          <li>
            <KpiCard
              icon={PaperPlaneTilt}
              tone="blue"
              value={m.delivered.count}
              label="Delivered"
              note={`${percent(m.delivered.ratePercent)} of ${m.totalRecipients}`}
            />
          </li>
          {r.supports.opens ? (
            <li>
              <KpiCard
                icon={EnvelopeOpen}
                tone="blue"
                value={m.opened.count}
                label="Opened"
                note={`${percent(m.opened.ratePercent)} of ${m.delivered.count}`}
              />
            </li>
          ) : null}
          {r.supports.clicks ? (
            <li>
              <KpiCard
                icon={CursorClick}
                tone="blue"
                value={m.clicked.count}
                label="Clicked"
                note={`${percent(m.clicked.ratePercent)} of ${m.delivered.count}`}
              />
            </li>
          ) : null}
          <li>
            <KpiCard
              icon={WarningCircle}
              tone="red"
              value={m.failed.count}
              label="Failed"
              note={`${percent(m.failed.ratePercent)} of ${m.totalRecipients}`}
            />
          </li>
        </ul>
      )}

      <div
        role="tablist"
        aria-label="Result views"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {tab === 'Overview' ? (
            <>
              <section className={card} aria-label="Campaign performance" data-testid="performance">
                <h2 className="mb-3 font-display text-xl font-bold text-heading">
                  Campaign Performance
                </h2>
                {m.totalRecipients === 0 ? (
                  <p className={quiet}>No delivery data yet.</p>
                ) : (
                  <div className="grid min-w-0 gap-5 md:grid-cols-2">
                    <ul className="flex flex-col gap-3">
                      {r.funnel.map((f) => (
                        <li
                          key={f.stage}
                          className="grid grid-cols-[5rem_1fr_6rem] items-center gap-2 text-sm"
                        >
                          <span className="text-heading">
                            {f.stage.charAt(0) + f.stage.slice(1).toLowerCase()}
                          </span>
                          <span
                            className="h-5 rounded-sm bg-canvas"
                            role="img"
                            aria-label={`${f.count} of ${m.totalRecipients}`}
                          >
                            <span
                              className="block h-5 rounded-sm bg-action"
                              style={{
                                width: `${Math.min(100, (f.count / m.totalRecipients) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="text-right font-semibold text-heading">
                            {f.count}
                            {f.stage !== 'SENT' ? (
                              <span className="font-normal text-muted">
                                {' '}
                                ({percent(Math.round((f.count / m.totalRecipients) * 1000) / 10)})
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Trend r={r} />
                  </div>
                )}
              </section>
              <section className={card} aria-label="Delivery breakdown" data-testid="breakdown">
                <h2 className="mb-3 font-display text-xl font-bold text-heading">
                  Delivery Breakdown
                </h2>
                {m.totalRecipients === 0 ? (
                  <p className={quiet}>Nothing to break down yet.</p>
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <ul className="grid min-w-64 flex-1 grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm">
                      {[
                        {
                          label: 'Delivered',
                          v: m.delivered,
                          dot: 'bg-success',
                          text: 'text-success',
                        },
                        { label: 'Bounced', v: m.failed, dot: 'bg-danger', text: 'text-danger' },
                        {
                          label: 'Unsubscribed',
                          v: m.unsubscribed,
                          dot: 'bg-muted',
                          text: 'text-muted',
                        },
                        { label: 'Not Sent', v: m.pending, dot: 'bg-muted', text: 'text-muted' },
                      ].map((x) => (
                        <li key={x.label} className="contents">
                          <span aria-hidden className={`size-2.5 rounded-full ${x.dot}`} />
                          <span className="text-heading">{x.label}</span>
                          <span className="text-right font-medium text-heading">{x.v.count}</span>
                          <span className={`text-right ${x.text}`}>{percent(x.v.ratePercent)}</span>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className={linkBtn} onClick={() => setTab('Recipients')}>
                      View Recipient Details{' '}
                      <ArrowRight aria-hidden weight="bold" className="size-3" />
                    </button>
                  </div>
                )}
                {r.failureReasons.length > 0 ? (
                  <ul className="mt-3 border-t border-divider pt-2 text-sm text-danger">
                    {r.failureReasons.map((f) => (
                      <li key={f.code}>
                        {f.label}: {f.count}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
              <section className={card} aria-label="Recipient activity">
                <RecipientTable
                  id={id}
                  supports={r.supports}
                  onExport={r.canExport ? exportResults : undefined}
                />
                {r.canResendFailed ? (
                  <button
                    type="button"
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:opacity-90"
                    onClick={() =>
                      void draftFrom(
                        () => api.communications.resendFailed(id),
                        'Draft made for the failed recipients.',
                      )
                    }
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Resend to{' '}
                    {m.failed.count} Failed Recipients
                  </button>
                ) : null}
              </section>
            </>
          ) : tab === 'Recipients' ? (
            <section className={card} aria-label="Recipients">
              <RecipientTable
                id={id}
                supports={r.supports}
                onExport={r.canExport ? exportResults : undefined}
              />
            </section>
          ) : tab === 'Activity' ? (
            <ActivityPanel id={id} />
          ) : tab === 'Message' ? (
            <section className={card} aria-label="Message" data-testid="message-tab">
              {d.subject ? (
                <p className="mb-2 text-sm font-semibold text-heading">Subject: {d.subject}</p>
              ) : null}
              <div className="rounded-lg border border-divider bg-canvas p-3 text-sm whitespace-pre-wrap text-heading">
                {plain(d.body) || 'No content.'}
              </div>
              {d.attachments.length > 0 ? (
                <ul className="mt-3 text-sm text-muted">
                  {d.attachments.map((a) => (
                    <li key={a.id}>{a.fileName}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <section className={card} aria-label="Settings" data-testid="settings-tab">
              <Info d={d} full />
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Campaign details">
          <section className={card} aria-label="Campaign information" data-testid="info">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">
              Campaign Information
            </h2>
            <Info d={d} />
          </section>
          <section className={card} aria-label="Message preview" data-testid="side-preview">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Message Preview</h2>
            <div className="rounded-lg border border-divider bg-canvas p-3 text-sm">
              {d.subject ? <p className="mb-1 font-semibold text-heading">{d.subject}</p> : null}
              <p className="max-h-36 overflow-hidden whitespace-pre-wrap text-text">
                {plain(d.body) || 'No content.'}
              </p>
            </div>
            <button type="button" className={`${linkBtn} mt-2`} onClick={() => setTab('Message')}>
              View Full Message <ArrowRight aria-hidden weight="bold" className="size-3" />
            </button>
          </section>
          <section className={card} aria-label="Actions" data-testid="side-actions">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Actions</h2>
            <ul className="flex flex-col gap-1.5">
              {[
                { label: 'Duplicate Campaign', icon: Copy, onClick: duplicate, show: true },
                {
                  label: 'Save as Template',
                  icon: FileText,
                  onClick: () => setDialog('template'),
                  show: true,
                },
                {
                  label: 'Send Follow-Up',
                  icon: Repeat,
                  onClick: () => setDialog('follow'),
                  show: d.status === 'SENT',
                },
                { label: 'Archive Campaign', icon: Archive, onClick: archive, show: !d.archived },
              ]
                .filter((a) => a.show)
                .map((a) => (
                  <li key={a.label}>
                    <button
                      type="button"
                      onClick={a.onClick}
                      className="flex w-full items-center gap-3 rounded-lg border border-divider p-2 text-left text-sm font-medium text-heading hover:bg-canvas"
                    >
                      <a.icon aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                      {a.label}
                      <CaretRight aria-hidden weight="bold" className="ml-auto size-3 text-muted" />
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          <p className="flex items-start gap-3 rounded-xl bg-info-soft p-4 text-sm text-info">
            <InfoIcon aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
            Delivery and engagement data is retained according to company communication and
            record-retention settings.
          </p>
        </aside>
      </div>

      {dialog === 'template' ? (
        <SaveTemplateDialog
          id={id}
          name={d.name}
          onClose={() => setDialog(undefined)}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'reschedule' ? (
        <RescheduleDialog row={d} onClose={() => setDialog(undefined)} onNotice={notice} />
      ) : null}
      {dialog === 'follow' ? (
        <FollowUpDialog
          onClose={() => setDialog(undefined)}
          onPick={(group) => {
            setDialog(undefined);
            void draftFrom(
              () => api.communications.followUp(id, { group }),
              'Follow-up draft created.',
            );
          }}
          supports={r.supports}
        />
      ) : null}
    </div>
  );
}

/** Engagement over time: a small line chart of opens per day (deliveries when opens are not tracked). */
function Trend({ r }: { r: CommunicationResults }) {
  const key = r.supports.opens ? 'opened' : 'delivered';
  const values = r.trend.map((t) => t[key]);
  const max = Math.max(1, ...values);
  const w = 320;
  const h = 120;
  const pts = values.map(
    (v, i) =>
      [
        (i / Math.max(1, values.length - 1)) * (w - 56) + 28,
        h - 10 - (v / max) * (h - 20),
      ] as const,
  );
  return (
    <figure className="min-w-0" data-testid="trend">
      <figcaption className="mb-1 text-sm font-semibold text-heading">
        Engagement Over Time
      </figcaption>
      <svg
        viewBox={`0 0 ${w} ${h + 20}`}
        role="img"
        aria-label={`${key === 'opened' ? 'Opens' : 'Deliveries'} per day`}
        className="h-auto w-full"
      >
        <polyline
          fill="none"
          className="stroke-action"
          strokeWidth="2"
          points={pts.map((p) => p.join(',')).join(' ')}
        />
        {pts.map((p, i) => (
          <circle key={r.trend[i]!.date} cx={p[0]} cy={p[1]} r="3" className="fill-action" />
        ))}
        {r.trend.map((t, i) => (
          <text
            key={t.date}
            x={pts[i]![0]}
            y={h + 14}
            textAnchor="middle"
            className="fill-muted"
            fontSize="9"
          >
            {dayText(t.date).replace(/, \d{4}$/, '')}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function Info({ d, full }: { d: CommunicationDetail; full?: boolean }) {
  const rows: [string, string][] = [
    ['Campaign Name', d.name],
    ['Audience', d.audienceSummary ?? '—'],
    ['Final Recipients', d.finalCount === null ? '—' : String(d.finalCount)],
    ...(d.sender ? ([['From', d.sender.label]] as [string, string][]) : []),
    ...(d.replyTo ? ([['Reply-To', d.replyTo]] as [string, string][]) : []),
    ...(d.subject ? ([['Subject', d.subject]] as [string, string][]) : []),
    ...(full
      ? ([
          ['Type', channelOf(d.channel).label],
          ['Created', dayText(d.createdAt)],
          ['Time zone', d.timezone],
          ['Template', d.template?.name ?? 'None'],
        ] as [string, string][])
      : []),
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr] xl:grid-cols-[7rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 wrap-break-word text-heading">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecipientTable({
  id,
  supports,
  onExport,
}: {
  id: string;
  supports: { opens: boolean; clicks: boolean };
  onExport: (() => Promise<void>) | undefined;
}) {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDeferredValue(search.trim());
  const list = useApiQuery([...COMM_KEY, 'recipients', id, status, term, page], () =>
    api.communications.recipients(id, {
      ...(status ? { status: status as CommunicationRecipient['status'] } : {}),
      ...(term ? { search: term } : {}),
      page,
      pageSize: 10,
    }),
  );
  const yesNo = (n: number) => (n > 0 ? 'Yes' : 'No');
  const columns: Column<CommunicationRecipient>[] = [
    { id: 'who', label: 'Recipient', cell: (x) => x.client?.name ?? x.leadName ?? 'Contact' },
    { id: 'addr', label: 'Email', cell: (x) => x.addressMask },
    {
      id: 'st',
      label: 'Status',
      cell: (x) => (
        <span title={x.failureLabel ?? undefined}>
          <Badge tone={RECIPIENT_TONE[x.status] ?? 'neutral'}>{RECIPIENT_LABEL[x.status]}</Badge>
        </span>
      ),
    },
    ...(supports.opens
      ? [{ id: 'op', label: 'Opened', cell: (x: CommunicationRecipient) => yesNo(x.openCount) }]
      : []),
    ...(supports.clicks
      ? [{ id: 'cl', label: 'Clicked', cell: (x: CommunicationRecipient) => yesNo(x.clickCount) }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="recipient-table">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-display text-xl font-bold text-heading">Recipient Activity</h2>
        <label className="flex h-10 w-44 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
          <span className="sr-only">Search recipients</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search recipients..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        <div className="w-36">
          <Select
            label="Status"
            hideLabel
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Statuses' },
              ...Object.entries(RECIPIENT_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        {onExport ? (
          <button type="button" className={subtle} onClick={() => void onExport()}>
            <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export Recipients
          </button>
        ) : null}
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(x) => x.id}
          caption="Recipients"
          dense
          noun="recipients"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Recipients are not available' : 'No recipients yet'}
          emptyText={
            list.isError
              ? 'We could not load the recipients. Try again in a moment.'
              : 'Recipients appear once this has been sent.'
          }
          rowActions={(x) =>
            x.client ? (
              <ActionMenu
                label={`Actions for ${x.client.name}`}
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                align="right"
                sections={[
                  {
                    items: [
                      {
                        label: 'View Client',
                        icon: CheckCircle,
                        onSelect: () => router.push(`/clients/${x.client!.id}`),
                      },
                    ],
                  },
                ]}
              />
            ) : null
          }
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
    </div>
  );
}

function ActivityPanel({ id }: { id: string }) {
  const list = useApiQuery([...COMM_KEY, 'activity', id], () =>
    api.communications.activity(id, { page: 1, pageSize: 50 }),
  );
  return (
    <section className={card} aria-label="Activity" data-testid="activity-tab">
      {list.data?.items.length === 0 ? <p className={quiet}>No activity yet.</p> : null}
      {list.isError ? <p className={quiet}>Activity is not available right now.</p> : null}
      <ul>
        {(list.data?.items ?? []).map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
          >
            <span className="text-heading">{a.message}</span>
            <span className="text-muted">{dateTimeText(a.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FollowUpDialog({
  onClose,
  onPick,
  supports,
}: {
  onClose: () => void;
  onPick: (g: 'OPENED' | 'NOT_OPENED' | 'CLICKED' | 'NOT_CLICKED' | 'FAILED') => void;
  supports: { opens: boolean; clicks: boolean };
}) {
  const groups = [
    ...(supports.opens
      ? ([
          ['OPENED', 'Opened the message'],
          ['NOT_OPENED', 'Did not open the message'],
        ] as const)
      : []),
    ...(supports.clicks
      ? ([
          ['CLICKED', 'Clicked a link'],
          ['NOT_CLICKED', 'Did not click a link'],
        ] as const)
      : []),
    ['FAILED', 'Did not receive it'] as const,
  ];
  return (
    <Modal
      open
      title="Send Follow-Up"
      subtitle="A new draft is made for the group you choose. The original is not changed."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ul data-testid="follow-groups">
        {groups.map(([g, label]) => (
          <li key={g} className="border-t border-divider first:border-t-0">
            <button
              type="button"
              className="min-h-11 w-full text-left text-sm font-medium text-link"
              onClick={() => onPick(g)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
