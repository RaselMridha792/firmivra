'use client';

import type { CommunicationDetail, CommunicationRecipient } from '@firmivra/types';
import { Button, KpiCard, Modal, Select, Table, Toast, type Column } from '@firmivra/ui';
import {
  ArrowLeft,
  Archive,
  ChartBar,
  CheckCircle,
  Copy,
  CursorClick,
  DownloadSimple,
  EnvelopeOpen,
  FileText,
  PaperPlaneTilt,
  Repeat,
  WarningCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { RescheduleDialog, SaveTemplateDialog, useAct } from './communication-actions';
import {
  COMM_ERRORS,
  COMM_KEY,
  ChannelTile,
  StatusPill,
  card,
  channelOf,
  dateTimeText,
  dayText,
  gold,
  percent,
  plain,
  quiet,
  subtle,
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

/** /communications/[id]: Communication Details & Results. */
export function ResultsScreen({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
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

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="results-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/communications" aria-label="Back to Communications" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/communications" className="text-link">
          Communications
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{d.name}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelTile channel={d.channel} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading">{d.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <StatusPill status={d.status} /> {channelOf(d.channel).label}
              {d.sentAt
                ? ` · Sent ${dateTimeText(d.sentAt)}`
                : d.scheduledFor
                  ? ` · Scheduled ${dateTimeText(d.scheduledFor)}`
                  : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Actions">
          <button
            type="button"
            className={subtle}
            onClick={() =>
              void draftFrom(() => api.communications.duplicate(id), 'Copied to a new draft.')
            }
          >
            <Copy aria-hidden weight="bold" className="size-4" /> Duplicate
          </button>
          <button type="button" className={subtle} onClick={() => setDialog('template')}>
            <FileText aria-hidden weight="bold" className="size-4" /> Save as Template
          </button>
          {d.status === 'SENT' ? (
            <button type="button" className={subtle} onClick={() => setDialog('follow')}>
              <Repeat aria-hidden weight="bold" className="size-4" /> Send Follow-Up
            </button>
          ) : null}
          {d.status === 'SCHEDULED' ? (
            <button type="button" className={subtle} onClick={() => setDialog('reschedule')}>
              Reschedule
            </button>
          ) : null}
          {r.canExport ? (
            <button
              type="button"
              className={subtle}
              onClick={async () => {
                try {
                  const x = await api.communications.exportResults(id);
                  notice(`Export ready: ${x.fileName} (${x.rowCount} rows).`, 'success');
                } catch (e) {
                  notice(errorMessage(e, COMM_ERRORS), 'error');
                }
              }}
            >
              <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export
            </button>
          ) : null}
          {!d.archived ? (
            <button
              type="button"
              className={subtle}
              onClick={async () => {
                await act(() => api.communications.archive(id), 'Archived.');
                await qc.invalidateQueries({ queryKey: [...COMM_KEY] });
              }}
            >
              <Archive aria-hidden weight="bold" className="size-4" /> Archive
            </button>
          ) : null}
          {r.canResendFailed ? (
            <button
              type="button"
              className={gold}
              onClick={() =>
                void draftFrom(
                  () => api.communications.resendFailed(id),
                  'Draft made for the failed recipients.',
                )
              }
            >
              Resend to {m.failed.count} Failed
            </button>
          ) : null}
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
              icon={PaperPlaneTilt}
              tone="blue"
              value={m.totalRecipients}
              label="Total Recipients"
            />
          </li>
          <li>
            <KpiCard
              icon={CheckCircle}
              tone="green"
              value={m.delivered.count}
              label="Delivered"
              note={percent(m.delivered.ratePercent)}
            />
          </li>
          {r.supports.opens ? (
            <li>
              <KpiCard
                icon={EnvelopeOpen}
                tone="purple"
                value={m.opened.count}
                label="Opened"
                note={percent(m.opened.ratePercent)}
              />
            </li>
          ) : null}
          {r.supports.clicks ? (
            <li>
              <KpiCard
                icon={CursorClick}
                tone="amber"
                value={m.clicked.count}
                label="Clicked"
                note={percent(m.clicked.ratePercent)}
              />
            </li>
          ) : null}
          <li>
            <KpiCard
              icon={WarningCircle}
              tone="red"
              value={m.failed.count}
              label="Failed"
              note={percent(m.failed.ratePercent)}
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

      {tab === 'Overview' ? (
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
          <section className={card} aria-label="Performance" data-testid="performance">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">Performance</h2>
            {m.totalRecipients === 0 ? (
              <p className={quiet}>No delivery data yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {r.funnel.map((f) => (
                  <li key={f.stage}>
                    <div className="mb-1 flex justify-between text-sm text-heading">
                      <span>{f.stage.charAt(0) + f.stage.slice(1).toLowerCase()}</span>
                      <span className="font-semibold">{f.count}</span>
                    </div>
                    <div
                      className="h-2 rounded-pill bg-canvas"
                      role="img"
                      aria-label={`${f.count} of ${m.totalRecipients}`}
                    >
                      <div
                        className="h-2 rounded-pill bg-action"
                        style={{ width: `${Math.min(100, (f.count / m.totalRecipients) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={card} aria-label="Delivery trend" data-testid="trend">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">
              <ChartBar aria-hidden weight="fill" className="mr-2 inline size-5 text-action" />
              Delivery Over Time
            </h2>
            {m.totalRecipients === 0 ? (
              <p className={quiet}>No delivery data yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {r.trend.map((t) => (
                  <li
                    key={t.date}
                    className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-sm"
                  >
                    <span className="text-muted">{dayText(t.date)}</span>
                    <div className="h-2 rounded-pill bg-canvas">
                      <div
                        className="h-2 rounded-pill bg-success"
                        style={{
                          width: `${Math.min(100, (t.delivered / Math.max(1, m.delivered.count)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-right font-medium text-heading">{t.delivered}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={card} aria-label="Delivery breakdown" data-testid="breakdown">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">Delivery Breakdown</h2>
            {m.totalRecipients === 0 ? (
              <p className={quiet}>Nothing to break down yet.</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                {[
                  ['Delivered', m.delivered.count],
                  ['Pending', m.pending.count],
                  ['Failed', m.failed.count],
                  ['Unsubscribed', m.unsubscribed.count],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right font-semibold text-heading">{v}</dd>
                  </div>
                ))}
              </dl>
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
          <section className={card} aria-label="Campaign information" data-testid="info">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">
              Campaign Information
            </h2>
            <Info d={d} />
          </section>
          <section className={`${card} lg:col-span-2`} aria-label="Recipient activity">
            <h2 className="mb-3 font-display text-lg font-bold text-heading">Recipient Activity</h2>
            <RecipientTable id={id} supports={r.supports} />
          </section>
        </div>
      ) : tab === 'Recipients' ? (
        <section className={card} aria-label="Recipients">
          <RecipientTable id={id} supports={r.supports} filters />
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

function Info({ d, full }: { d: CommunicationDetail; full?: boolean }) {
  const rows: [string, string][] = [
    ['Type', channelOf(d.channel).label],
    ['Created by', d.createdBy.name],
    ['Created', dayText(d.createdAt)],
    ...(d.sentAt ? ([['Sent', dateTimeText(d.sentAt)]] as [string, string][]) : []),
    ...(d.sender ? ([['From', d.sender.label]] as [string, string][]) : []),
    ...(d.subject ? ([['Subject', d.subject]] as [string, string][]) : []),
    ['Audience', d.audienceSummary ?? '—'],
    ...(full
      ? ([
          ['Time zone', d.timezone],
          ['Template', d.template?.name ?? 'None'],
        ] as [string, string][])
      : []),
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-heading">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecipientTable({
  id,
  supports,
  filters,
}: {
  id: string;
  supports: { opens: boolean; clicks: boolean };
  filters?: boolean;
}) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useApiQuery([...COMM_KEY, 'recipients', id, status, page], () =>
    api.communications.recipients(id, {
      ...(status ? { status: status as CommunicationRecipient['status'] } : {}),
      page,
      pageSize: 10,
    }),
  );
  const columns: Column<CommunicationRecipient>[] = [
    { id: 'who', label: 'Recipient', cell: (x) => x.client?.name ?? x.leadName ?? 'Contact' },
    { id: 'addr', label: 'Address', cell: (x) => x.addressMask },
    {
      id: 'st',
      label: 'Status',
      cell: (x) =>
        x.failureLabel
          ? `${RECIPIENT_LABEL[x.status]} · ${x.failureLabel}`
          : RECIPIENT_LABEL[x.status],
    },
    ...(supports.opens
      ? [{ id: 'op', label: 'Opens', cell: (x: CommunicationRecipient) => x.openCount }]
      : []),
    ...(supports.clicks
      ? [{ id: 'cl', label: 'Clicks', cell: (x: CommunicationRecipient) => x.clickCount }]
      : []),
    {
      id: 'at',
      label: 'Delivered',
      cell: (x) => (x.deliveredAt ? dateTimeText(x.deliveredAt) : '—'),
    },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="recipient-table">
      {filters ? (
        <div className="w-48">
          <Select
            label="Status"
            hideLabel
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              ...Object.entries(RECIPIENT_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      ) : null}
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
