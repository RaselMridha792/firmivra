'use client';

import {
  type BookkeepingReconciliation,
  type BookkeepingReconciliationItem,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import { Button, FileDropzone, Input, Modal, Table, Toast, type Column } from '@firmivra/ui';
import { FileArrowUp, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';
import { useAct, type Notice } from './bookkeeping-actions';
import {
  BK_ERRORS,
  BK_KEY,
  ReconPill,
  card,
  dayText,
  money,
  outlined,
  primary,
  quiet,
  subtle,
} from './bookkeeping-shared';
import { ReasonDialog, cents, dollars } from './recon-parts';

const KIND: Record<BookkeepingReconciliationItem['kind'], string> = {
  STANDARD: 'Standard',
  TRANSFER: 'Transfer',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CHARGEBACK: 'Chargeback',
  FEE: 'Fee',
  PAYOUT: 'Payout',
  ADJUSTMENT: 'Adjustment',
};
const EXCEPTION: Record<NonNullable<BookkeepingReconciliationItem['exception']>, string> = {
  DUPLICATE: 'Probable duplicate',
};
const signed = (c: number) => (c > 0 ? `+${money(c)}` : c < 0 ? `−${money(-c)}` : money(0));

/**
 * One account's reconciliation for a period (Octavia's BK-R01; the close mockup,
 * `bookkeeping-close-reconciliation-and-report-review.jpg`): the statement, the ledger lines
 * marked cleared, the difference, the exceptions, and review, approval and reopening. With
 * ledger lines the cleared balance comes from the lines cleared; it is typed only for an account
 * without them. Approval needs a zero difference and no open exceptions (the API checks).
 */
export function ReconciliationScreen({ id }: { id: string }) {
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<'reopen' | 'statement'>();
  // A line ticked shows ticked at once; it settles when the save comes back (or rolls back).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const act = useAct(notice);
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const rq = useApiQuery([...BK_KEY, 'recon', id], () => api.bookkeeping.getReconciliation(id));
  const iq = useApiQuery([...BK_KEY, 'recon', id, 'items'], () =>
    api.bookkeeping.reconciliationItems(id),
  );
  const r = rq.data;
  const pq = useApiQuery([...BK_KEY, 'period', r?.periodId ?? 'none'], () =>
    r ? api.bookkeeping.getPeriod(r.periodId) : Promise.resolve(null),
  );
  const p = pq.data;

  if (rq.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="recon-error">
        <Link href="/bookkeeping" className="text-sm font-medium text-link">
          ← Back to Bookkeeping
        </Link>
        <p role="alert" className={quiet}>
          This reconciliation is not available. It may have been removed, or we could not load it.
        </p>
      </div>
    );
  if (!r) return <p className={quiet}>Loading…</p>;

  const items = iq.data;
  const locked = p?.status === 'CLOSED';
  const editable = (r.status === 'IN_PROGRESS' || r.status === 'REOPENED') && !locked;
  // The lines' figures are worked out fresh; the saved ones stand in until they load.
  const f = items ?? r;
  const exceptions = (items?.items ?? []).filter((i) => i.exception);
  const clear = async (ids: string[], cleared: boolean) => {
    setPending((m) => ({ ...m, ...Object.fromEntries(ids.map((x) => [x, cleared])) }));
    await act(
      () => api.bookkeeping.clearReconciliationItems(r.id, { transactionIds: ids, cleared }),
      cleared ? 'Marked cleared.' : 'Marked not cleared.',
    );
    setPending((m) => Object.fromEntries(Object.entries(m).filter(([x]) => !ids.includes(x))));
  };

  const columns: Column<BookkeepingReconciliationItem>[] = [
    {
      id: 'cleared',
      label: 'Cleared',
      cell: (t) => (
        <input
          type="checkbox"
          className="size-5 shrink-0 cursor-pointer rounded-sm disabled:cursor-not-allowed"
          checked={pending[t.id] ?? t.cleared}
          disabled={!editable || t.id in pending}
          aria-label={`Cleared: ${t.payee ?? t.description}, ${dayText(t.transactionDate)}`}
          onChange={(e) => void clear([t.id], e.target.checked)}
        />
      ),
    },
    {
      id: 'date',
      label: 'Date',
      className: 'whitespace-nowrap',
      cell: (t) => dayText(t.transactionDate),
    },
    {
      id: 'payee',
      label: 'Payee',
      cell: (t) => (
        <span className="flex flex-col">
          <span className="font-medium text-heading">{t.payee ?? t.description}</span>
          {t.payee ? <span className="text-xs text-muted">{t.description}</span> : null}
        </span>
      ),
    },
    // On a phone the type and the exception step aside (exceptions are listed below too).
    { id: 'kind', label: 'Type', className: 'hidden md:table-cell', cell: (t) => KIND[t.kind] },
    {
      id: 'amount',
      label: 'Amount',
      className: 'whitespace-nowrap text-right',
      cell: (t) => (
        <span className={t.effectCents >= 0 ? 'text-success' : 'text-heading'}>
          {signed(t.effectCents)}
        </span>
      ),
    },
    {
      id: 'exception',
      label: 'Exception',
      className: 'hidden md:table-cell',
      cell: (t) =>
        t.exception ? (
          <span className="font-medium text-danger">{EXCEPTION[t.exception]}</span>
        ) : (
          '—'
        ),
    },
  ];
  const lines = items?.items ?? [];
  const open = lines.filter((t) => !t.cleared).map((t) => t.id);
  const done = lines.filter((t) => t.cleared).map((t) => t.id);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="recon-page">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        {p ? (
          <>
            <span aria-hidden className="text-muted">
              ›
            </span>
            <Link href={`/bookkeeping/clients/${p.bookkeepingClientId}?tab=reconciliation`}>
              {p.client.displayName}
            </Link>
            <span aria-hidden className="text-muted">
              ›
            </span>
            <Link href={`/bookkeeping/periods/${p.id}`}>{p.label}</Link>
          </>
        ) : null}
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Reconciliation</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-heading">
              {r.account.name}
              {r.account.mask ? ` ••${r.account.mask}` : ''}
            </h1>
            <ReconPill status={r.status} />
          </div>
          <p className="text-sm text-muted">
            Statement {dayText(r.statementStart)} to {dayText(r.statementEnd)}
            {p ? ` · ${p.label}` : ''}
            {r.status === 'REOPENED' && r.reopenReason ? ` · Reopened: ${r.reopenReason}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reconciliation actions">
          {p ? (
            <Link href={`/bookkeeping/periods/${p.id}`} className={subtle}>
              Close Checklist
            </Link>
          ) : null}
          {editable ? (
            <button
              type="button"
              className={primary}
              onClick={() =>
                void act(() => api.bookkeeping.markReconciliationReady(r.id), 'Ready for review.')
              }
            >
              Ready for Review
            </button>
          ) : null}
          {manager && !locked && (r.status === 'READY_FOR_REVIEW' || r.status === 'APPROVED') ? (
            <button type="button" className={subtle} onClick={() => setDialog('reopen')}>
              Reopen
            </button>
          ) : null}
          {manager && r.status === 'READY_FOR_REVIEW' ? (
            <button
              type="button"
              className={primary}
              disabled={f.differenceCents !== 0 || f.exceptionsCount > 0}
              onClick={() =>
                void act(() => api.bookkeeping.approveReconciliation(r.id), 'Approved.')
              }
            >
              Approve
            </button>
          ) : null}
        </div>
      </header>

      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {locked ? (
        <p role="status" className="rounded-lg bg-canvas p-3 text-sm text-heading">
          The period is closed and locked. Reopen the period to change this reconciliation.
        </p>
      ) : null}

      <section
        className={`${card} grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5`}
        aria-label="Reconciliation figures"
        data-testid="recon-figures"
      >
        <Figure label="Beginning balance" value={money(r.beginningBalanceCents)} />
        <Figure
          label={`Cleared (${f.clearedCount} ${f.clearedCount === 1 ? 'line' : 'lines'})`}
          value={money(f.clearedBalanceCents)}
          testId="recon-cleared"
        />
        <Figure label="Ending balance" value={money(r.endingBalanceCents)} />
        <Figure
          label="Difference"
          value={money(f.differenceCents)}
          tone={f.differenceCents === 0 ? 'text-success' : 'text-danger'}
          testId="recon-difference"
        />
        <Figure
          label="Open exceptions"
          value={String(f.exceptionsCount)}
          tone={f.exceptionsCount === 0 ? 'text-heading' : 'text-danger'}
        />
        {r.status === 'READY_FOR_REVIEW' && (f.differenceCents !== 0 || f.exceptionsCount > 0) ? (
          <p className="col-span-full text-sm text-danger" data-testid="recon-blocked">
            {f.differenceCents !== 0
              ? 'The difference must be zero to approve.'
              : 'Resolve the open exceptions first.'}
          </p>
        ) : null}
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={card} aria-label="Cleared lines" data-testid="recon-items">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-heading">Cleared Lines</h2>
              <p className="text-xs text-muted">
                Mark each line that appears on the statement. Lines dated up to the statement end
                and not yet cleared are listed, oldest first.
              </p>
            </div>
            {editable && lines.length ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={subtle}
                  disabled={!open.length}
                  onClick={() => void clear(open, true)}
                >
                  Clear All
                </button>
                <button
                  type="button"
                  className={subtle}
                  disabled={!done.length}
                  onClick={() => void clear(done, false)}
                >
                  Unclear All
                </button>
              </div>
            ) : null}
          </div>
          {items && !items.fromLedger ? (
            <p className={quiet}>
              This account has no ledger lines yet. Enter the cleared balance from the statement
              under Statement.
            </p>
          ) : (
            <>
              <Table
                rows={lines}
                columns={columns}
                rowKey={(t) => t.id}
                caption="Lines to clear"
                dense
                noun="lines"
                pageSize={25}
                loading={iq.isPending}
                keepHeaderWhenEmpty
                emptyTitle={iq.isError ? 'The lines are not available' : 'No lines to clear'}
                emptyText={
                  iq.isError
                    ? 'We could not load the lines. Try again in a moment.'
                    : 'No uncleared lines are dated up to the statement end.'
                }
              />
              {items?.truncated ? (
                <p className="mt-2 text-xs text-muted">
                  Showing the oldest 500 lines. Clear these to see the rest.
                </p>
              ) : null}
            </>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <StatementCard
            key={r.updatedAt}
            r={r}
            fromLedger={items?.fromLedger ?? true}
            editable={editable}
            onNotice={notice}
            onAttach={() => setDialog('statement')}
          />
          <section className={card} aria-label="Exceptions" data-testid="recon-exceptions">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Exceptions</h2>
            {exceptions.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {exceptions.map((t) => (
                  <li key={t.id} className="flex items-start gap-2">
                    <Warning aria-hidden weight="fill" className="mt-0.5 size-4 text-danger" />
                    <span>
                      <span className="font-medium text-heading">
                        {EXCEPTION[t.exception!]}: {t.payee ?? t.description}
                      </span>
                      <span className="block text-xs text-muted">
                        {dayText(t.transactionDate)} · {signed(t.effectCents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No open exceptions.</p>
            )}
            {p ? (
              <Link
                href={`/bookkeeping/clients/${p.bookkeepingClientId}?tab=transactions`}
                className="mt-3 inline-block text-sm font-medium text-link hover:underline"
              >
                Open Transactions
              </Link>
            ) : null}
          </section>
        </div>
      </div>

      {dialog === 'reopen' ? (
        <ReasonDialog
          title="Reopen this reconciliation"
          confirm="Reopen"
          onClose={() => setDialog(undefined)}
          onConfirm={async (reason) =>
            void (await act(
              () => api.bookkeeping.reopenReconciliation(r.id, { reason }),
              'Reconciliation reopened.',
            ))
          }
        />
      ) : null}
      {dialog === 'statement' && p ? (
        <StatementDialog
          r={r}
          bookkeepingClientId={p.bookkeepingClientId}
          onClose={() => setDialog(undefined)}
          onNotice={notice}
        />
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = 'text-heading',
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  testId?: string;
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`font-display text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

/** The statement's dates and balances, and the statement file. */
function StatementCard({
  r,
  fromLedger,
  editable,
  onNotice,
  onAttach,
}: {
  r: BookkeepingReconciliation;
  fromLedger: boolean;
  editable: boolean;
  onNotice: Notice;
  onAttach: () => void;
}) {
  const act = useAct(onNotice);
  const [start, setStart] = useState(r.statementStart);
  const [end, setEnd] = useState(r.statementEnd);
  const [begin, setBegin] = useState(() => dollars(r.beginningBalanceCents));
  const [ending, setEnding] = useState(() => dollars(r.endingBalanceCents));
  const [cleared, setCleared] = useState(() => dollars(r.clearedBalanceCents));
  const [error, setError] = useState<string>();
  return (
    <section className={card} aria-label="Statement" data-testid="recon-statement">
      <h2 className="mb-3 font-display text-lg font-bold text-heading">Statement</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (end < start) {
            setError('The statement cannot end before it starts.');
            return;
          }
          setError(undefined);
          void act(
            () =>
              api.bookkeeping.saveReconciliation(r.id, {
                statementStart: start,
                statementEnd: end,
                beginningBalanceCents: cents(begin),
                endingBalanceCents: cents(ending),
                ...(fromLedger ? {} : { clearedBalanceCents: cents(cleared) }),
              }),
            'Progress saved.',
          );
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Starts"
            type="date"
            value={start}
            disabled={!editable}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input
            label="Ends"
            type="date"
            value={end}
            disabled={!editable}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <Input
          label="Beginning balance ($)"
          inputMode="decimal"
          value={begin}
          disabled={!editable}
          onChange={(e) => setBegin(e.target.value)}
        />
        <Input
          label="Ending balance ($)"
          inputMode="decimal"
          value={ending}
          disabled={!editable}
          onChange={(e) => setEnding(e.target.value)}
        />
        {fromLedger ? null : (
          <Input
            label="Cleared balance ($)"
            inputMode="decimal"
            value={cleared}
            disabled={!editable}
            onChange={(e) => setCleared(e.target.value)}
          />
        )}
        <p className="text-sm text-heading" data-testid="recon-statement-file">
          {r.statementDocumentId
            ? 'The statement is attached and kept with the client’s documents.'
            : 'No statement attached yet.'}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary}>
              Save Progress
            </button>
            <button type="button" className={outlined} onClick={onAttach}>
              <FileArrowUp aria-hidden weight="bold" className="size-4" />
              {r.statementDocumentId ? 'Replace Statement' : 'Attach Statement'}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

/** Upload the bank or card statement; it is filed with the client's documents and linked. */
function StatementDialog({
  r,
  bookkeepingClientId,
  onClose,
  onNotice,
}: {
  r: BookkeepingReconciliation;
  bookkeepingClientId: string;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const ws = useApiQuery([...BK_KEY, 'client', bookkeepingClientId], () =>
    api.bookkeeping.getClient(bookkeepingClientId),
  );
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const w = ws.data;
  return (
    <Modal
      open
      title="Attach Statement"
      subtitle={`${r.account.name}: the statement is kept with the client's documents.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!file || !w || busy}
            onClick={async () => {
              if (!file || !w) return;
              setBusy(true);
              setError(undefined);
              try {
                const doc = await uploadFile(file, {
                  start: (facts) =>
                    api.documents.createUpload(w.client.id, {
                      serviceId: w.engagementId,
                      shareWithClient: false,
                      ...facts,
                    }),
                  finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
                  maxBytes: UPLOAD_LIMITS.maxBytes,
                });
                const ok = await act(
                  () => api.bookkeeping.saveReconciliation(r.id, { statementDocumentId: doc.id }),
                  'Statement attached.',
                );
                if (ok) onClose();
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Uploading…' : 'Attach'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="recon-statement-dialog">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <FileDropzone
          label="Statement"
          multiple={false}
          maxBytes={UPLOAD_LIMITS.maxBytes}
          onFiles={(files) => setFile(files[0])}
          onReject={() => setError('Use a PDF or image file within the size limit.')}
          hints={[file ? `Chosen: ${file.name}` : 'The bank or card statement, as a PDF or a scan']}
        />
      </div>
    </Modal>
  );
}
