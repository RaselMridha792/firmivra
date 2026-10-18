'use client';

import type { BookkeepingPeriod, BookkeepingReconciliation } from '@firmivra/types';
import { Button, Input, Modal, Select, Table, Toast, type Column } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { useAct, type Notice } from './bookkeeping-actions';
import {
  BK_ERRORS,
  BK_KEY,
  PeriodPill,
  card,
  dayText,
  money,
  moneyWhole,
  outlined,
  primary,
  quiet,
  subtle,
} from './bookkeeping-shared';
import { ReportMenu } from './report-actions';
import { reportColumns } from './workspace-tabs';

const RECON_LABEL = {
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  APPROVED: 'Approved',
  REOPENED: 'Reopened',
} as const;
const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '')) * 100);
const dollars = (c: number) => (c / 100).toFixed(2);

function ReasonDialog({
  title,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim());
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function ReconDialog({
  p,
  existing,
  onClose,
  onNotice,
}: {
  p: BookkeepingPeriod;
  existing?: BookkeepingReconciliation;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const accounts = [
    ...(existing ? [{ id: existing.account.id, name: existing.account.name }] : []),
    ...p.accountsWithoutReconciliation,
  ];
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [start, setStart] = useState(existing?.statementStart ?? p.periodStart);
  const [end, setEnd] = useState(existing?.statementEnd ?? p.periodEnd);
  const [begin, setBegin] = useState(existing ? dollars(existing.beginningBalanceCents) : '');
  const [ending, setEnding] = useState(existing ? dollars(existing.endingBalanceCents) : '');
  const [cleared, setCleared] = useState(existing ? dollars(existing.clearedBalanceCents) : '');
  const [error, setError] = useState<string>();
  const diff = ending && cleared ? cents(ending) - cents(cleared) : null;
  return (
    <Modal
      open
      title={existing ? 'Reconciliation' : 'Reconcile an Account'}
      subtitle={p.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!account || !begin || !ending}
            onClick={async () => {
              try {
                const body = {
                  statementStart: start,
                  statementEnd: end,
                  beginningBalanceCents: cents(begin),
                  endingBalanceCents: cents(ending),
                  ...(cleared ? { clearedBalanceCents: cents(cleared) } : {}),
                };
                if (existing) await api.bookkeeping.saveReconciliation(existing.id, body);
                else
                  await api.bookkeeping.createReconciliation(p.id, { accountId: account, ...body });
                await act(async () => undefined, 'Reconciliation saved.');
                onClose();
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
              }
            }}
          >
            Save Progress
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="recon-dialog">
        <Select
          label="Account"
          value={account}
          disabled={!!existing}
          onChange={(e) => setAccount(e.target.value)}
          options={
            accounts.length
              ? accounts.map((a) => ({ value: a.id, label: a.name }))
              : [{ value: '', label: 'Every account is reconciled' }]
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Statement starts"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input
            label="Statement ends"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <Input
            label="Beginning balance ($)"
            value={begin}
            onChange={(e) => setBegin(e.target.value)}
          />
          <Input
            label="Ending balance ($)"
            value={ending}
            onChange={(e) => setEnding(e.target.value)}
          />
          <Input
            label="Cleared balance ($)"
            value={cleared}
            onChange={(e) => setCleared(e.target.value)}
          />
        </div>
        <p className="rounded-lg bg-canvas p-3 text-sm text-heading" data-testid="recon-diff">
          Difference:{' '}
          <span className={diff === 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>
            {diff === null ? '—' : money(diff)}
          </span>
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function FiguresDialog({
  p,
  onClose,
  onNotice,
}: {
  p: BookkeepingPeriod;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [income, setIncome] = useState(p.incomeCents === null ? '' : dollars(p.incomeCents));
  const [expenses, setExpenses] = useState(
    p.expensesCents === null ? '' : dollars(p.expensesCents),
  );
  const [unc, setUnc] = useState(p.uncategorizedCount === null ? '' : String(p.uncategorizedCount));
  return (
    <Modal
      open
      title="Enter Period Figures"
      subtitle={p.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!income !== !!expenses}
            onClick={async () => {
              await act(
                () =>
                  api.bookkeeping.updatePeriod(p.id, {
                    incomeCents: income ? cents(income) : null,
                    expensesCents: expenses ? cents(expenses) : null,
                    uncategorizedCount: unc ? Number(unc) : null,
                  }),
                'Figures saved.',
              );
              onClose();
            }}
          >
            Save Figures
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="figures-dialog">
        <p className="text-sm text-muted">
          Firmivra keeps no ledger: these are the figures you take from the accounting software.
          Income and expenses go together.
        </p>
        <Input
          label="Total income ($)"
          value={income}
          onChange={(e) => setIncome(e.target.value)}
        />
        <Input
          label="Total expenses ($)"
          value={expenses}
          onChange={(e) => setExpenses(e.target.value)}
        />
        <Input
          label="Uncategorized transactions"
          type="number"
          value={unc}
          onChange={(e) => setUnc(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/** /bookkeeping/periods/[id]: one period's close: checklist, figures, reconciliations and reports. */
export function PeriodScreen({ id }: { id: string }) {
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<
    | 'figures'
    | 'recon'
    | 'reopen'
    | { recon: BookkeepingReconciliation }
    | { reopenRecon: BookkeepingReconciliation }
  >();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const act = useAct(notice);
  const q = useApiQuery([...BK_KEY, 'period', id], () => api.bookkeeping.getPeriod(id));
  const p = q.data;
  const cw = useApiQuery([...BK_KEY, 'client', p?.bookkeepingClientId ?? 'none'], () =>
    p ? api.bookkeeping.getClient(p.bookkeepingClientId) : Promise.resolve(null),
  );
  if (q.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="period-error">
        <Link href="/bookkeeping" className="text-sm font-medium text-link">
          ← Back to Bookkeeping
        </Link>
        <p role="alert" className={quiet}>
          This period is not available. It may have been removed, or we could not load it.
        </p>
      </div>
    );
  if (!p) return <p className={quiet}>Loading…</p>;
  const closed = p.status === 'CLOSED';
  const reconColumns: Column<BookkeepingReconciliation>[] = [
    {
      id: 'acct',
      label: 'Account',
      cell: (r) => (
        <span className="font-medium text-heading">
          {r.account.name}
          {r.account.mask ? ` ••${r.account.mask}` : ''}
        </span>
      ),
    },
    { id: 'end', label: 'Ending', cell: (r) => money(r.endingBalanceCents) },
    { id: 'clr', label: 'Cleared', cell: (r) => money(r.clearedBalanceCents) },
    {
      id: 'diff',
      label: 'Difference',
      cell: (r) => (
        <span className={r.withinTolerance ? 'text-success' : 'font-medium text-danger'}>
          {money(r.differenceCents)}
        </span>
      ),
    },
    { id: 'st', label: 'Status', cell: (r) => RECON_LABEL[r.status] },
  ];
  const reconMenu = (r: BookkeepingReconciliation) => {
    const btn = 'text-sm font-medium text-link disabled:opacity-50';
    return (
      <span className="flex flex-wrap justify-end gap-3">
        {(r.status === 'IN_PROGRESS' || r.status === 'REOPENED') && !closed ? (
          <button type="button" className={btn} onClick={() => setDialog({ recon: r })}>
            Edit
          </button>
        ) : null}
        {(r.status === 'IN_PROGRESS' || r.status === 'REOPENED') && !closed ? (
          <button
            type="button"
            className={btn}
            onClick={() =>
              void act(() => api.bookkeeping.markReconciliationReady(r.id), 'Ready for review.')
            }
          >
            Ready
          </button>
        ) : null}
        {r.status === 'READY_FOR_REVIEW' ? (
          <button
            type="button"
            className={btn}
            onClick={() => void act(() => api.bookkeeping.approveReconciliation(r.id), 'Approved.')}
          >
            Approve
          </button>
        ) : null}
        {r.status === 'APPROVED' && !closed ? (
          <button
            type="button"
            className="text-sm font-medium text-danger"
            onClick={() => setDialog({ reopenRecon: r })}
          >
            Reopen
          </button>
        ) : null}
      </span>
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="period-page">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href={`/bookkeeping/clients/${p.bookkeepingClientId}?tab=reconciliation`}>
          {p.client.displayName}
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{p.label}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-heading">{p.label} Close</h1>
            <PeriodPill status={p.status} />
          </div>
          <p className="text-sm text-muted">
            {p.client.displayName} · Close by {p.closeByOn ? dayText(p.closeByOn) : '—'} · Checklist{' '}
            {p.progress.done} of {p.progress.total}
            {p.reopenReason ? ` · Reopened: ${p.reopenReason}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Period actions">
          {p.status === 'NOT_STARTED' ? (
            <button
              type="button"
              className={primary}
              onClick={() => void act(() => api.bookkeeping.startPeriod(p.id), 'Period started.')}
            >
              Start Period
            </button>
          ) : null}
          {p.status === 'IN_PROGRESS' ? (
            <button
              type="button"
              className={primary}
              onClick={() =>
                void act(() => api.bookkeeping.markPeriodReady(p.id), 'Ready for review.')
              }
            >
              Mark Ready for Review
            </button>
          ) : null}
          {p.status === 'READY_FOR_REVIEW' ? (
            <>
              <button
                type="button"
                className={subtle}
                onClick={() => void act(() => api.bookkeeping.sendPeriodBack(p.id), 'Sent back.')}
              >
                Send Back
              </button>
              <button
                type="button"
                className={primary}
                onClick={() =>
                  void act(() => api.bookkeeping.approvePeriod(p.id), 'Period approved.')
                }
              >
                Approve
              </button>
            </>
          ) : null}
          {p.status === 'APPROVED' ? (
            <>
              <button type="button" className={subtle} onClick={() => setDialog('reopen')}>
                Reopen
              </button>
              <button
                type="button"
                className={primary}
                onClick={() => void act(() => api.bookkeeping.closePeriod(p.id), 'Period closed.')}
              >
                Close Period
              </button>
            </>
          ) : null}
          {closed ? (
            <button type="button" className={subtle} onClick={() => setDialog('reopen')}>
              Reopen Period
            </button>
          ) : null}
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={card} aria-label="Close checklist" data-testid="checklist">
          <h2 className="mb-1 font-display text-lg font-bold text-heading">Close Checklist</h2>
          <p className="mb-2 text-xs text-muted">
            Required steps: {p.progress.requiredDone} of {p.progress.requiredTotal} done.
          </p>
          <ul>
            {p.closeItems.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
              >
                <input
                  type="checkbox"
                  aria-label={i.label}
                  className="size-4 shrink-0"
                  checked={i.completed}
                  disabled={closed || i.itemKey === 'reviewer_approval'}
                  onChange={(e) =>
                    void act(
                      () =>
                        api.bookkeeping.updateCloseItem(p.id, i.id, {
                          completed: e.target.checked,
                        }),
                      e.target.checked ? 'Step done.' : 'Step reopened.',
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-heading">
                    {i.label}
                    {i.required ? <span className="text-danger"> *</span> : null}
                  </span>
                  {i.completedAt ? (
                    <span className="block text-xs text-muted">
                      Done {dayText(i.completedAt.slice(0, 10))}
                      {i.completedBy ? ` by ${i.completedBy.name}` : ''}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <aside className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-label="Period figures" data-testid="figures">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-heading">Figures</h2>
              {!closed ? (
                <button
                  type="button"
                  className="text-sm font-medium text-link"
                  onClick={() => setDialog('figures')}
                >
                  Enter figures
                </button>
              ) : null}
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt>Income</dt>
                <dd className="font-semibold text-heading">{moneyWhole(p.incomeCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Expenses</dt>
                <dd className="font-semibold text-heading">{moneyWhole(p.expensesCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Net Profit</dt>
                <dd className="font-semibold text-heading">{moneyWhole(p.netProfitCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Uncategorized</dt>
                <dd className="font-semibold text-heading">{p.uncategorizedCount ?? '—'}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">
              {p.figuresSource
                ? `${p.figuresSource === 'MANUAL' ? 'Entered by hand' : 'Imported'}`
                : 'No figures yet.'}
            </p>
          </section>
        </aside>
      </div>

      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Reconciliations"
        data-testid="reconciliations"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-heading">Reconciliations</h2>
          {!closed && p.accountsWithoutReconciliation.length > 0 ? (
            <button type="button" className={outlined} onClick={() => setDialog('recon')}>
              <Plus aria-hidden weight="bold" className="size-4" /> Reconcile an Account
            </button>
          ) : null}
        </div>
        <div className="relative">
          <Table
            rows={p.reconciliations}
            columns={reconColumns}
            rowKey={(r) => r.id}
            caption="Reconciliations"
            dense
            noun="reconciliations"
            pageSize={20}
            showPagination={false}
            rowActions={reconMenu}
            emptyTitle="No reconciliations yet"
            emptyText={
              p.accountsWithoutReconciliation.length
                ? `${p.accountsWithoutReconciliation.map((a) => a.name).join(', ')} still to reconcile.`
                : 'This client has no accounts to reconcile.'
            }
          />
        </div>
      </section>

      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Period reports"
        data-testid="period-reports"
      >
        <h2 className="font-display text-lg font-bold text-heading">Reports</h2>
        <div className="relative">
          <Table
            rows={p.reports}
            columns={reportColumns(false)}
            rowKey={(r) => r.id}
            caption="Period reports"
            dense
            noun="reports"
            pageSize={20}
            showPagination={false}
            rowActions={(r) => (
              <ReportMenu row={r} engagementId={cw.data?.engagementId ?? null} onNotice={notice} />
            )}
            emptyTitle="No reports yet"
            emptyText="Reports for this period appear here."
          />
        </div>
      </section>

      {dialog === 'figures' ? (
        <FiguresDialog p={p} onClose={() => setDialog(undefined)} onNotice={notice} />
      ) : null}
      {dialog === 'recon' ? (
        <ReconDialog p={p} onClose={() => setDialog(undefined)} onNotice={notice} />
      ) : null}
      {typeof dialog === 'object' && 'recon' in dialog ? (
        <ReconDialog
          p={p}
          existing={dialog.recon}
          onClose={() => setDialog(undefined)}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'reopen' ? (
        <ReasonDialog
          title="Reopen this period"
          confirm="Reopen"
          onClose={() => setDialog(undefined)}
          onConfirm={async (reason) =>
            void (await act(
              () => api.bookkeeping.reopenPeriod(p.id, { reason }),
              'Period reopened.',
            ))
          }
        />
      ) : null}
      {typeof dialog === 'object' && 'reopenRecon' in dialog ? (
        <ReasonDialog
          title="Reopen this reconciliation"
          confirm="Reopen"
          onClose={() => setDialog(undefined)}
          onConfirm={async (reason) =>
            void (await act(
              () => api.bookkeeping.reopenReconciliation(dialog.reopenRecon.id, { reason }),
              'Reconciliation reopened.',
            ))
          }
        />
      ) : null}
    </div>
  );
}
