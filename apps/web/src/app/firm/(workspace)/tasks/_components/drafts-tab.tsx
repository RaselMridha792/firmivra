'use client';

import type { TaskDraftQuery, TaskDraftRow, TaskPriority } from '@firmivra/types';
import { Badge, Button, Modal, Pagination, Select, Toast } from '@firmivra/ui';
import { MagnifyingGlass, PencilSimple, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useClients, useTypes } from './task-data';
import { PRIORITY_LABEL, TASKS_KEY, TASK_ERRORS, dayText, shortName } from './task-shared';

// Octavia's A2: Drafts, beside Completed Tasks. A draft is not live: no list, count, calendar,
// reminder or client sees it until Save Task publishes it. Search, filters, reopen to edit (and
// publish), and discard. Staff see their clients' drafts and their own drafts with no client yet.

const btn =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-divider px-3 text-sm font-medium text-heading hover:bg-canvas disabled:opacity-50';
const quiet = 'rounded-lg bg-canvas p-8 text-center text-sm text-muted';
const PAGE_SIZE = 10;

export function DraftsTab() {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [typeId, setTypeId] = useState('');
  const [clientId, setClientId] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const { types } = useTypes();
  const { clients } = useClients();
  const query: TaskDraftQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(term ? { search: term } : {}),
    ...(priority ? { priority } : {}),
    ...(typeId ? { typeId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(mine ? { mine: true } : {}),
  };
  const list = useApiQuery([...TASKS_KEY, 'drafts', query], () => api.taskWork.drafts(query));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [discarding, setDiscarding] = useState<TaskDraftRow>();
  const discard = useApiMutation((id: string) => api.taskWork.discardDraft(id), {
    invalidate: [...TASKS_KEY],
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const filtered = !!(term || priority || typeId || clientId || mine);
  const reset = () => setPage(1);
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Drafts are not available right now.'
      : filtered
        ? 'No drafts match. Clear the search or filters.'
        : 'No drafts. Save as Draft on Create Task keeps one here until it is ready.';

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="drafts-tab">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="drafts-filters">
        <label className="flex min-h-10 min-w-56 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 text-muted" />
          <span className="sr-only">Search drafts</span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
            placeholder="Search drafts..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        <div className="w-44">
          <Select
            label="Draft client"
            hideLabel
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              reset();
            }}
            options={[
              { value: '', label: 'All Clients' },
              ...clients.map((c) => ({ value: c.id, label: c.displayName })),
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            label="Draft type"
            hideLabel
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              reset();
            }}
            options={[
              { value: '', label: 'All Types' },
              ...types.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            label="Draft priority"
            hideLabel
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as TaskPriority | '');
              reset();
            }}
            options={[
              { value: '', label: 'All Priorities' },
              ...(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => ({
                value: p,
                label: PRIORITY_LABEL[p],
              })),
            ]}
          />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="size-4"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              reset();
            }}
          />
          My drafts
        </label>
      </div>
      {rows.length === 0 ? (
        <p className={quiet}>{state}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Drafts</caption>
            <thead className="bg-table-head text-heading">
              <tr>
                <th className="px-3 py-2 font-semibold">Task</th>
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 font-semibold">Priority</th>
                <th className="px-3 py-2 font-semibold">Assigned To</th>
                <th className="px-3 py-2 font-semibold">Last Saved</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="draft-rows">
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-divider">
                  <td className="px-3 py-2">
                    <Link
                      href={`/tasks/drafts/${d.id}`}
                      data-testid="draft-link"
                      className="font-medium text-heading hover:underline"
                    >
                      {d.title}
                    </Link>
                    {d.missing.includes('clientId') ? (
                      <span className="mt-1 block">
                        <Badge tone="warning">Needs a client</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-text">{d.client?.displayName ?? '—'}</td>
                  <td className="px-3 py-2 text-text">{d.type?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-text">{d.dueOn ? dayText(d.dueOn) : '—'}</td>
                  <td className="px-3 py-2 text-text">{PRIORITY_LABEL[d.priority]}</td>
                  <td className="px-3 py-2 text-text">
                    {d.assignedTo ? shortName(d.assignedTo.name) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text">
                    {new Date(d.updatedAt).toLocaleDateString('en-US')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/tasks/drafts/${d.id}`} className={btn}>
                        <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
                        <span className="sr-only"> {d.title}</span>
                      </Link>
                      <button type="button" className={btn} onClick={() => setDiscarding(d)}>
                        <Trash aria-hidden weight="fill" className="size-4 text-danger" /> Discard
                        <span className="sr-only"> {d.title}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE_SIZE ? (
        <Pagination
          page={page}
          onPage={setPage}
          pageCount={Math.ceil(total / PAGE_SIZE)}
          summary={`Showing ${(page - 1) * PAGE_SIZE + 1} – ${Math.min(page * PAGE_SIZE, total)} of ${total} drafts`}
        />
      ) : null}
      {discarding ? (
        <Modal
          open
          title="Discard Draft"
          subtitle={discarding.title}
          onClose={() => setDiscarding(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDiscarding(undefined)}>
                Keep Draft
              </Button>
              <Button
                disabled={discard.isPending}
                onClick={() =>
                  discard.mutate(discarding.id, {
                    onSuccess: () => {
                      setMessage({ text: `${discarding.title} discarded.`, tone: 'success' });
                      setDiscarding(undefined);
                    },
                    onError: (e) => {
                      setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' });
                      setDiscarding(undefined);
                    },
                  })
                }
              >
                Discard
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            The draft, its checklist and reminders are deleted. It was never a live task, so nothing
            else changes.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
