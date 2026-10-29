'use client';
import { INVOICE_ERRORS, type InvoiceHistoryKind, type InvoiceListItem } from '@firmivra/types';
import { Button, Modal, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { INV_KEY, card, quiet } from './inv-shared';

const KIND: Record<InvoiceHistoryKind, { title: string; field: string; done: string }> = {
  NOTE: { title: 'Add Note', field: 'Note (firm only)', done: 'Note added.' },
  ACTIVITY_LOGGED: {
    title: 'Log Activity',
    field: 'What happened (a call, a meeting, an email)',
    done: 'Activity logged.',
  },
};

/**
 * Add Note and Log Activity (IP-F09): firm-only entries in the invoice's history. They never go
 * on the PDF, the email or the client's portal.
 */
export function InvoiceHistoryForm({
  invoice,
  kind,
  onClose,
  onDone,
}: {
  invoice: Pick<InvoiceListItem, 'id' | 'number'>;
  kind: InvoiceHistoryKind;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState('');
  const add = useApiMutation(
    () => api.invoices.addHistory(invoice.id, { type: kind, body: body.trim() }),
    { invalidate: [...INV_KEY] },
  );
  const save = () => {
    if (!body.trim()) {
      setProblem(kind === 'NOTE' ? 'Write the note.' : 'Say what happened.');
      return;
    }
    setProblem('');
    add.mutate(undefined, {
      onSuccess: () => {
        onDone(`${KIND[kind].done} (${invoice.number})`);
        onClose();
      },
    });
  };
  return (
    <Modal
      open
      title={`${KIND[kind].title}: ${invoice.number}`}
      subtitle="Kept in the invoice's history for your firm; the client never sees it."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={add.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="history-form">
        <Textarea
          label={KIND[kind].field}
          rows={3}
          maxLength={2000}
          value={body}
          error={problem || undefined}
          onChange={(e) => setBody(e.target.value)}
        />
        {add.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(add.error, INVOICE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

const LABEL: Record<string, string> = { NOTE: 'Note', ACTIVITY_LOGGED: 'Activity' };

/** The invoice page's History card: the firm's notes and logged activity, newest first. */
export function InvoiceHistoryCard({ invoiceId }: { invoiceId: string }) {
  const q = useApiQuery([...INV_KEY, 'history', invoiceId], () => api.invoices.history(invoiceId));
  const items = q.data?.items ?? [];
  return (
    <section className={card} aria-labelledby="inv-history" data-testid="invoice-history">
      <h2 id="inv-history" className="mb-3 font-display text-xl font-bold text-heading">
        History
      </h2>
      {q.isError ? (
        <p className={quiet}>The history could not be loaded. Try again in a moment.</p>
      ) : q.isPending ? (
        <p className={quiet}>Loading…</p>
      ) : items.length === 0 ? (
        <p className={quiet}>No notes or activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} className="border-t border-divider pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm text-heading">{i.body}</p>
              <p className="text-xs text-muted">
                {LABEL[i.type] ?? i.type} · {i.actor?.name ?? 'Firmivra'} ·{' '}
                {new Date(i.createdAt).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
