'use client';

import {
  BOOKKEEPING_TXN_ERRORS,
  type BookkeepingCategoryRow,
  type BookkeepingClientWorkspace,
  type BookkeepingTransactionRow,
} from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { Plus, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_KEY, dayText, money } from './bookkeeping-shared';

// BK-T01 engines (Octavia's Oct 25 review): one line's category, split, transfer, exclusion and
// receipt, and the same for several lines at once. Each dialog says what the ledger requires (a
// split adds up to the amount; a transfer's other side is the same amount the other way on
// another account) and shows the API's refusal in the firm's words.

export type TxnDialog =
  | {
      kind: 'categorize' | 'split' | 'transfer' | 'exclude' | 'receipt';
      row: BookkeepingTransactionRow;
    }
  | { kind: 'bulk-categorize' | 'bulk-exclude'; ids: string[] };

const cents = (dollars: string) => Math.round(Number(dollars) * 100);

export function TransactionDialog({
  w,
  dialog,
  categories,
  onClose,
  onDone,
}: {
  w: BookkeepingClientWorkspace;
  dialog: TxnDialog;
  categories: BookkeepingCategoryRow[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const active = categories.filter((c) => c.active);
  const options = [
    { value: '', label: 'Choose a category' },
    ...active.map((c) => ({ value: c.id, label: c.name })),
  ];
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [parts, setParts] = useState([
    { categoryId: '', amount: '', memo: '' },
    { categoryId: '', amount: '', memo: '' },
  ]);
  const [pairId, setPairId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const row = 'row' in dialog ? dialog.row : null;
  const candidates = useQuery({
    queryKey: [...BK_KEY, 'transfer-candidates', w.id, row?.id ?? ''],
    queryFn: () => api.bookkeeping.transferCandidates(w.id, row!.id),
    enabled: dialog.kind === 'transfer',
  });
  const documents = useQuery({
    queryKey: [...BK_KEY, 'receipt-documents', w.id],
    queryFn: () => api.documents.list(w.client.id, { serviceId: w.engagementId, limit: 100 }),
    enabled: dialog.kind === 'receipt',
  });
  const left = row ? row.amountCents - parts.reduce((n, p) => n + (cents(p.amount) || 0), 0) : 0;

  const save = async () => {
    setError(undefined);
    setBusy(true);
    try {
      let text = '';
      if (dialog.kind === 'categorize') {
        await api.bookkeeping.categorizeTransaction(w.id, dialog.row.id, { categoryId });
        text = 'Categorized.';
      } else if (dialog.kind === 'split') {
        await api.bookkeeping.splitTransaction(w.id, dialog.row.id, {
          parts: parts.map((p) => ({
            categoryId: p.categoryId,
            amountCents: cents(p.amount),
            ...(p.memo.trim() ? { memo: p.memo.trim() } : {}),
          })),
        });
        text = `Split in ${parts.length} parts.`;
      } else if (dialog.kind === 'transfer') {
        await api.bookkeeping.matchTransfer(w.id, dialog.row.id, { pairId });
        text = 'Matched as a transfer.';
      } else if (dialog.kind === 'exclude') {
        await api.bookkeeping.excludeTransaction(w.id, dialog.row.id, { reason });
        text = 'Excluded from the books.';
      } else if (dialog.kind === 'receipt') {
        await api.bookkeeping.attachReceipt(w.id, dialog.row.id, {
          documentId: documentId || null,
        });
        text = documentId ? 'Receipt attached.' : 'Receipt removed.';
      } else {
        const result = await api.bookkeeping.bulkTransactions(w.id, {
          ids: 'ids' in dialog ? dialog.ids : [],
          ...(dialog.kind === 'bulk-categorize'
            ? { action: 'CATEGORIZE' as const, categoryId }
            : { action: 'EXCLUDE' as const, reason }),
        });
        text = `${result.done} changed.${
          result.refused.length
            ? ` ${result.refused.length} could not be: ${[
                ...new Set(result.refused.map((r) => BOOKKEEPING_TXN_ERRORS[r.code] ?? r.code)),
              ].join(' ')}`
            : ''
        }`;
      }
      await qc.invalidateQueries({ queryKey: [...BK_KEY] });
      onDone(text);
    } catch (e) {
      setError(errorMessage(e, BOOKKEEPING_TXN_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !busy &&
    (dialog.kind === 'categorize' || dialog.kind === 'bulk-categorize'
      ? !!categoryId
      : dialog.kind === 'exclude' || dialog.kind === 'bulk-exclude'
        ? reason.trim().length > 0
        : dialog.kind === 'split'
          ? left === 0 && parts.every((p) => p.categoryId && cents(p.amount) > 0)
          : dialog.kind === 'transfer'
            ? !!pairId
            : true);
  const title = {
    categorize: 'Categorize Transaction',
    split: 'Split Transaction',
    transfer: 'Match Transfer',
    exclude: 'Exclude Transaction',
    receipt: 'Receipt',
    'bulk-categorize': 'Categorize Transactions',
    'bulk-exclude': 'Exclude Transactions',
  }[dialog.kind];
  const subtitle = row
    ? `${row.payee ?? row.description} · ${dayText(row.transactionDate)} · ${money(row.amountCents)} ${row.direction === 'DEBIT' ? 'debit' : 'credit'}`
    : `${'ids' in dialog ? dialog.ids.length : 0} selected`;

  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void save()}>
            {dialog.kind === 'receipt' && !documentId ? 'Remove Receipt' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="txn-dialog">
        {dialog.kind === 'categorize' || dialog.kind === 'bulk-categorize' ? (
          <Select
            label="Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={options}
          />
        ) : null}
        {dialog.kind === 'exclude' || dialog.kind === 'bulk-exclude' ? (
          <Textarea
            label="Why is it left out of the books?"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        {dialog.kind === 'split' && row ? (
          <>
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_1fr_auto] items-end gap-2">
                <Select
                  label={`Part ${i + 1} category`}
                  value={p.categoryId}
                  onChange={(e) =>
                    setParts(
                      parts.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)),
                    )
                  }
                  options={options}
                />
                <Input
                  label={`Part ${i + 1} amount ($)`}
                  inputMode="decimal"
                  value={p.amount}
                  onChange={(e) =>
                    setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
                <Input
                  label={`Part ${i + 1} memo`}
                  value={p.memo}
                  maxLength={200}
                  onChange={(e) =>
                    setParts(parts.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove part ${i + 1}`}
                  disabled={parts.length <= 2}
                  onClick={() => setParts(parts.filter((_, j) => j !== i))}
                  className="flex size-10 items-center justify-center rounded-control text-muted hover:bg-canvas disabled:opacity-40"
                >
                  <X aria-hidden weight="bold" className="size-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={parts.length >= 20}
                onClick={() => setParts([...parts, { categoryId: '', amount: '', memo: '' }])}
                className="inline-flex items-center gap-1 text-sm font-medium text-link disabled:opacity-40"
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Part
              </button>
              <p
                className={`text-sm ${left === 0 ? 'text-success' : 'text-danger'}`}
                data-testid="split-left"
              >
                {left === 0
                  ? 'The parts add up to the amount.'
                  : `${money(Math.abs(left))} ${left > 0 ? 'left to assign' : 'over the amount'}`}
              </p>
            </div>
          </>
        ) : null}
        {dialog.kind === 'transfer' ? (
          candidates.isPending ? (
            <p className="text-sm text-muted">Looking for the other side…</p>
          ) : (candidates.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-text" data-testid="no-candidates">
              No line on another of the client&apos;s accounts has this amount the other way within
              ten days. Bring in the other account&apos;s lines first.
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-heading">The other side</legend>
              {candidates.data!.items.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-heading">
                  <input
                    type="radio"
                    name="pair"
                    value={c.id}
                    checked={pairId === c.id}
                    onChange={() => setPairId(c.id)}
                  />
                  {dayText(c.transactionDate)} · {c.account.name} · {c.payee ?? c.description} ·{' '}
                  {money(c.amountCents)} {c.direction === 'DEBIT' ? 'debit' : 'credit'}
                </label>
              ))}
            </fieldset>
          )
        ) : null}
        {dialog.kind === 'receipt' ? (
          <Select
            label="The client's document"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            options={[
              {
                value: '',
                label: row?.hasReceipt ? 'No receipt (remove it)' : 'Choose a document',
              },
              ...(documents.data?.items ?? []).map((d) => ({ value: d.id, label: d.fileName })),
            ]}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
