'use client';

import {
  type BookkeepingClientWorkspace,
  type BookkeepingTransactionRow,
  BookkeepingTxnKind,
  type ListBookkeepingTransactionsQuery,
} from '@firmivra/types';
import { Badge, type Column, Input, Select, Table } from '@firmivra/ui';
import { Paperclip, SplitHorizontal } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BK_KEY, card, dayText, linkBtn, money } from './bookkeeping-shared';

const STATUS = {
  UNCATEGORIZED: { label: 'Uncategorized', tone: 'warning' },
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'danger' },
  CATEGORIZED: { label: 'Categorized', tone: 'success' },
  MATCHED: { label: 'Matched', tone: 'info' },
  EXCLUDED: { label: 'Excluded', tone: 'neutral' },
} as const;
const VIEWS = [
  { id: '', label: 'All', count: 'all' },
  { id: 'UNCATEGORIZED', label: 'Uncategorized', count: 'uncategorized' },
  { id: 'NEEDS_REVIEW', label: 'Needs Review', count: 'needsReview' },
  { id: 'CATEGORIZED', label: 'Categorized', count: 'categorized' },
  { id: 'MATCHED', label: 'Matched', count: 'matched' },
  { id: 'EXCLUDED', label: 'Excluded', count: 'excluded' },
] as const;
const KIND_LABEL: Record<BookkeepingTransactionRow['kind'], string> = {
  STANDARD: 'Standard',
  TRANSFER: 'Transfer',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CHARGEBACK: 'Chargeback',
  FEE: 'Fee',
  PAYOUT: 'Payout',
  ADJUSTMENT: 'Adjustment',
};
const SOURCE_LABEL = { SYNC: 'Synced', IMPORT: 'Imported', MANUAL: 'Entered' } as const;
const PAGE_SIZE = 25;

/**
 * The client's Transactions (Octavia's BK-T01): the ledger lines the accounting software's sync
 * or an import brought in, newest first, with views by status and their counts, search and
 * filters. The grid shows its columns before the first line, and says why there is none.
 */
export function TransactionsTab({ w }: { w: BookkeepingClientWorkspace }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const badRange = !!from && !!to && from > to;
  const query: ListBookkeepingTransactionsQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(status
      ? { status: status as NonNullable<ListBookkeepingTransactionsQuery['status']> }
      : {}),
    ...(term ? { search: term } : {}),
    ...(accountId ? { accountId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(kind ? { kind: BookkeepingTxnKind.parse(kind) } : {}),
    ...(direction ? { direction: direction as 'DEBIT' | 'CREDIT' } : {}),
    ...(!badRange && from ? { from } : {}),
    ...(!badRange && to ? { to } : {}),
  };
  const list = useApiQuery([...BK_KEY, 'transactions', w.id, query], () =>
    api.bookkeeping.transactions(w.id, query),
  );
  const categories = useApiQuery([...BK_KEY, 'categories', w.id], () =>
    api.bookkeeping.categories(w.id),
  );
  const counts = list.data?.counts;
  const filtered = !!(term || accountId || categoryId || kind || direction || from || to || status);
  const sw = w.connections.find((k) => k.status !== 'DISCONNECTED');
  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };
  const clear = () => {
    setStatus('');
    setSearch('');
    setAccountId('');
    setCategoryId('');
    setKind('');
    setDirection('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const columns: Column<BookkeepingTransactionRow>[] = [
    { id: 'date', label: 'Date', cell: (r) => dayText(r.transactionDate) },
    {
      id: 'payee',
      label: 'Payee',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-heading">{r.payee ?? '—'}</span>
          <span className="max-w-64 truncate text-muted" title={r.description}>
            {r.description}
          </span>
        </span>
      ),
    },
    {
      id: 'account',
      label: 'Account',
      cell: (r) => `${r.account.name}${r.account.mask ? ` ••${r.account.mask}` : ''}`,
    },
    {
      id: 'amount',
      label: 'Amount',
      className: 'text-right',
      cell: (r) => (
        <span className={r.direction === 'CREDIT' ? 'text-success' : 'text-heading'}>
          {money(r.amountCents)}
        </span>
      ),
    },
    {
      id: 'side',
      label: 'Debit / Credit',
      cell: (r) => (r.direction === 'DEBIT' ? 'Debit' : 'Credit'),
    },
    {
      id: 'category',
      label: 'Category',
      cell: (r) => r.category?.name ?? <span className="text-muted">Uncategorized</span>,
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
    },
    { id: 'kind', label: 'Type', cell: (r) => KIND_LABEL[r.kind] },
    {
      id: 'source',
      label: 'Source',
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          {SOURCE_LABEL[r.source]}
          {r.hasReceipt ? (
            <Paperclip aria-label="Has a receipt" weight="bold" className="size-3.5 text-muted" />
          ) : null}
          {r.splitCount > 0 ? (
            <SplitHorizontal
              aria-label={`Split in ${r.splitCount}`}
              weight="bold"
              className="size-3.5 text-muted"
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <section className={card} aria-label="Transactions" data-testid="transactions-tab">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">Transactions</h2>
        <p className="text-xs text-muted">
          {sw ? `From ${sw.label}` : 'No accounting software connected'}
          {counts ? ` · ${counts.all} in all` : ''}
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Transaction views"
        className="mb-3 flex overflow-x-auto border-b border-divider"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id || 'all'}
            type="button"
            role="tab"
            aria-selected={status === v.id}
            onClick={() => set(setStatus)(v.id)}
            className={`-mb-px min-h-10 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap ${status === v.id ? 'border-action font-semibold text-action' : 'border-transparent text-heading hover:text-action'}`}
          >
            {v.label}
            {counts ? <span className="ml-1 text-xs text-muted">({counts[v.count]})</span> : null}
          </button>
        ))}
      </div>
      <div
        className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="transaction-filters"
      >
        <Input
          label="Search"
          placeholder="Payee or description"
          value={search}
          onChange={(e) => set(setSearch)(e.target.value)}
        />
        <Select
          label="Account"
          value={accountId}
          onChange={(e) => set(setAccountId)(e.target.value)}
          options={[
            { value: '', label: 'All accounts' },
            ...w.accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <Select
          label="Category"
          value={categoryId}
          disabled={!categories.data?.items.length}
          onChange={(e) => set(setCategoryId)(e.target.value)}
          options={[
            {
              value: '',
              label: categories.isError
                ? 'Categories are not available'
                : categories.data?.items.length
                  ? 'All categories'
                  : 'No categories yet',
            },
            ...(categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Type"
          value={kind}
          onChange={(e) => set(setKind)(e.target.value)}
          options={[
            { value: '', label: 'All types' },
            ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          label="Debit / Credit"
          value={direction}
          onChange={(e) => set(setDirection)(e.target.value)}
          options={[
            { value: '', label: 'Both' },
            { value: 'DEBIT', label: 'Debits' },
            { value: 'CREDIT', label: 'Credits' },
          ]}
        />
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(e) => set(setFrom)(e.target.value)}
        />
        <Input
          label="To"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => set(setTo)(e.target.value)}
        />
        <div className="flex items-end">
          <button
            type="button"
            className={`${linkBtn} pb-2 disabled:opacity-50`}
            disabled={!filtered}
            onClick={clear}
          >
            Clear All
          </button>
        </div>
      </div>
      {badRange ? (
        <p role="alert" className="mb-2 text-xs text-danger">
          The start date is after the end date.
        </p>
      ) : null}
      <Table
        rows={list.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Transactions"
        dense
        noun="transactions"
        pageSize={PAGE_SIZE}
        loading={list.isPending}
        keepHeaderWhenEmpty
        emptyTitle={
          list.isError
            ? 'Transactions are not available'
            : filtered
              ? 'No transactions match'
              : 'No transactions yet'
        }
        emptyText={
          list.isError
            ? 'We could not load them. Try again in a moment.'
            : filtered
              ? 'Change or clear the filters.'
              : sw
                ? `Transactions appear here when ${sw.label} sends them with a sync, or when they are imported.`
                : 'Connect the client’s accounting software, or import transactions, to bring them in.'
        }
        server={{
          page: list.data?.page ?? 1,
          total: list.data?.total ?? 0,
          hasNext: (list.data?.page ?? 1) * PAGE_SIZE < (list.data?.total ?? 0),
          hasPrevious: (list.data?.page ?? 1) > 1,
          onNext: () => setPage(page + 1),
          onPrevious: () => setPage(Math.max(1, page - 1)),
          onPage: (n: number) => setPage(n),
          onSort: () => undefined,
        }}
      />
    </section>
  );
}
