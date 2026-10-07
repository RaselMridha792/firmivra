'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
} from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { DataNotice, PageHeading, Status, UnavailableAction } from './screen-kit';

export function Messages({ clientId }: { clientId?: string } = {}) {
  const { preview } = useWorkspace();
  const hasSampleThread = preview && (!clientId || clientId === 'sample-alex');
  const [thread, setThread] = useState('');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  return (
    <>
      <PageHeading
        title="Messages & notes"
        description="Keep client conversations and internal staff notes separate."
        action={
          <UnavailableAction label="New message">
            <Select
              label="Recipient"
              options={[
                { value: '', label: 'Choose a client' },
                ...(hasSampleThread
                  ? [{ value: 'sample-alex', label: 'Alex Morgan (sample)' }]
                  : []),
              ]}
            />
            <Input label="Subject" maxLength={200} />
            <Textarea label="Message" maxLength={10000} />
            <Input label="Attachment" type="file" />
          </UnavailableAction>
        }
      />
      <DataNotice />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Inbox">
          <Input label="Search messages" type="search" />
          <div className="mt-4">
            {hasSampleThread ? (
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => setThread('sample-thread')}
              >
                Alex Morgan · Document question
              </Button>
            ) : (
              <EmptyState
                title="No conversations loaded"
                description="Client conversations will appear here."
              />
            )}
          </div>
        </Card>
        <Card title="Client conversation" className="xl:col-span-2">
          {thread ? (
            <>
              <div className="mb-6 space-y-4">
                <div className="rounded-card bg-folder-surface p-4">
                  <p className="text-sm font-semibold">Alex Morgan · Sample message</p>
                  <p className="mt-2 text-sm">Which documents should I upload for my tax return?</p>
                </div>
                <div className="rounded-card border border-border p-4">
                  <p className="text-sm font-semibold">Your team · Sample reply</p>
                  <p className="mt-2 text-sm">
                    Please use your document request checklist in the portal.
                  </p>
                </div>
              </div>
              <Textarea
                label="Reply to client"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                maxLength={10000}
              />
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <Input label="Attachment" type="file" />
                <Button disabled>Send reply</Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="Select a conversation"
              description="Open a client thread to review messages."
            />
          )}
        </Card>
      </div>
      <Card title="Internal staff note">
        <Alert title="Visible to staff only">Internal notes are never shared with clients.</Alert>
        <div className="mt-4 space-y-4">
          <Textarea
            label="Internal note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
          />
          <Button disabled>Save internal note</Button>
        </div>
      </Card>
    </>
  );
}

interface Line {
  id: string;
  description: string;
  quantity: string;
  rate: string;
}
export function invoiceTotal(lines: Pick<Line, 'quantity' | 'rate'>[]) {
  return lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const rate = Number(line.rate);
    return (
      sum +
      (Number.isFinite(quantity) &&
      Number.isFinite(rate) &&
      Number.isInteger(quantity) &&
      quantity > 0 &&
      rate >= 0
        ? quantity * Math.round(rate * 100)
        : 0)
    );
  }, 0);
}
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function Invoices({ clientId }: { clientId?: string } = {}) {
  const { preview } = useWorkspace();
  const [filter, setFilter] = useState('');
  const [create, setCreate] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { id: 'first', description: '', quantity: '1', rate: '0' },
  ]);
  const rows = preview
    ? [
        {
          id: 'sample-paid',
          number: 'SAMPLE-001',
          client: 'Alex Morgan',
          service: 'Tax preparation',
          amount: 30000,
          status: 'Paid',
          due: 'Preview example',
        },
        {
          id: 'sample-due',
          number: 'SAMPLE-002',
          client: 'Example Studio LLC',
          service: 'Bookkeeping',
          amount: 25000,
          status: 'Pending',
          due: 'Preview example',
        },
      ].filter(
        (r) =>
          (!filter || r.status === filter) &&
          (!clientId ||
            r.client ===
              (clientId === 'sample-alex'
                ? 'Alex Morgan'
                : clientId === 'sample-studio'
                  ? 'Example Studio LLC'
                  : '')),
      )
    : [];
  const updateLine = (id: string, key: keyof Omit<Line, 'id'>, value: string) =>
    setLines((all) => all.map((line) => (line.id === id ? { ...line, [key]: value } : line)));
  return (
    <>
      <PageHeading
        title="Invoices"
        description="Create invoices and review payments confirmed by your payment provider."
        action={<Button onClick={() => setCreate(true)}>Create invoice</Button>}
      />
      <DataNotice />
      <Card>
        <div className="mb-6">
          <Select
            label="Invoice status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'Paid', label: 'Paid' },
              { value: 'Pending', label: 'Pending' },
            ]}
          />
        </div>
        <Table
          key={filter}
          caption="Invoices"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { id: 'number', label: 'Invoice', cell: (r) => r.number, sortValue: (r) => r.number },
            { id: 'client', label: 'Client', cell: (r) => r.client },
            { id: 'service', label: 'Service', cell: (r) => r.service },
            {
              id: 'amount',
              label: 'Amount',
              cell: (r) => money(r.amount),
              sortValue: (r) => r.amount,
            },
            { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
            {
              id: 'actions',
              label: 'Actions',
              cell: (r) => (
                <UnavailableAction label={r.status === 'Paid' ? 'Payment history' : 'Send invoice'}>
                  <p>No payment or email will be sent from this preview.</p>
                </UnavailableAction>
              ),
            },
          ]}
          emptyTitle="No invoices loaded"
        />
      </Card>
      <Modal title="Create invoice" open={create} onClose={() => setCreate(false)}>
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Client"
              options={[
                { value: '', label: 'Choose a client' },
                ...(preview ? [{ value: 'sample-alex', label: 'Alex Morgan (sample)' }] : []),
              ]}
            />
            <Input label="Service" />
            <Input label="Due date" type="date" />
            <Select label="Currency" options={[{ value: 'USD', label: 'USD' }]} />
          </div>
          <fieldset className="space-y-4">
            <legend className="mb-4 font-semibold">Line items</legend>
            {lines.map((line) => (
              <div key={line.id} className="space-y-3 rounded-card border border-border p-4">
                <Input
                  label="Description"
                  value={line.description}
                  onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Quantity"
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                  />
                  <Input
                    label="Unit price (USD)"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.rate}
                    onChange={(e) => updateLine(line.id, 'rate', e.target.value)}
                  />
                </div>
                <Button
                  variant="link"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((row) => row.id !== line.id))}
                >
                  Remove line
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setLines((all) => [
                  ...all,
                  { id: crypto.randomUUID(), description: '', quantity: '1', rate: '0' },
                ])
              }
            >
              Add line item
            </Button>
          </fieldset>
          <p aria-live="polite" className="text-xl font-bold">
            Total: {money(invoiceTotal(lines))}
          </p>
          <Alert title="Invoice has not been saved">
            Creating and sending invoices will become available when billing is ready.
          </Alert>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setCreate(false)}>
              Cancel
            </Button>
            <Button disabled>Create invoice</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
