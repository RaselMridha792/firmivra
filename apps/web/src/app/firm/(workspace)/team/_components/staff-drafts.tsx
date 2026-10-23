'use client';

import type { StaffDraft } from '@firmivra/types';
import { Button, Modal, Table, type Column } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { draftData, STEPS, stepHref } from '../new/_components/wizard-parts';
import { NOT_LOADED } from './quiet-card';

/** The person a draft is for, as far as step 1 got. */
function personOf(d: StaffDraft) {
  const account = draftData(d.data).account ?? {};
  const name = [account.firstName, account.lastName].filter(Boolean).join(' ').trim();
  return { name: name || 'Unnamed draft', email: account.email ?? null };
}

const savedOn = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The directory's Drafts view (Octavia's SM5 and SM12, review of Oct 21 to 22): Create Staff's
 * saved drafts, which have no account and no invitation. Continue reopens the step it was saved
 * on with its values; Delete asks first. Owner and Admin only, as the drafts API. `search` narrows
 * by name or email.
 */
export function StaffDrafts({ search }: { search: string }) {
  const list = useApiQuery(['staff', 'drafts'], () => api.staff.drafts());
  const [deleting, setDeleting] = useState<StaffDraft | null>(null);
  const [message, setMessage] = useState('');
  const term = search.toLowerCase();
  const rows = (list.data ?? []).filter((d) => {
    if (!term) return true;
    const p = personOf(d);
    return p.name.toLowerCase().includes(term) || (p.email ?? '').toLowerCase().includes(term);
  });
  const columns: Column<StaffDraft>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (d) => (
        <span className="font-bold whitespace-nowrap text-heading">{personOf(d).name}</span>
      ),
    },
    {
      id: 'email',
      label: 'Email',
      cell: (d) => personOf(d).email ?? <span className="text-muted">—</span>,
    },
    {
      id: 'status',
      label: 'Status',
      cell: () => (
        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-text">
          Draft
        </span>
      ),
    },
    {
      id: 'step',
      label: 'Saved at',
      className: 'whitespace-nowrap',
      cell: (d) => `Step ${d.step} of 4: ${STEPS[d.step - 1]?.label ?? ''}`,
    },
    {
      id: 'saved',
      label: 'Last saved',
      className: 'whitespace-nowrap',
      cell: (d) => `${savedOn(d.updatedAt)}${d.createdBy ? ` by ${d.createdBy}` : ''}`,
    },
  ];
  return (
    <>
      {message ? (
        <p role="status" data-testid="drafts-result" className="text-sm text-success">
          {message}
        </p>
      ) : null}
      <Table
        rows={rows}
        loading={list.isPending}
        rowKey={(d) => d.id}
        caption="Staff drafts"
        noun="drafts"
        columns={columns}
        rowActions={(d) => (
          <div className="flex justify-end gap-2">
            <Link
              href={stepHref(STEPS[d.step - 1]?.id ?? 'account', d.id)}
              className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-link hover:underline"
            >
              Continue
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setMessage('');
                setDeleting(d);
              }}
            >
              Delete
            </Button>
          </div>
        )}
        emptyTitle={
          list.isError ? 'Drafts are not available' : term ? 'No matching drafts' : 'No drafts'
        }
        emptyText={
          list.isError
            ? NOT_LOADED
            : term
              ? 'Try another name or email.'
              : 'Save as Draft in Create Staff keeps a staff record here until you finish it.'
        }
        emptyAction={
          list.isError ? (
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          ) : undefined
        }
      />
      {deleting ? (
        <DeleteDraftModal
          draft={deleting}
          onClose={() => setDeleting(null)}
          onDone={(text) => {
            setDeleting(null);
            setMessage(text);
          }}
        />
      ) : null}
    </>
  );
}

function DeleteDraftModal({
  draft,
  onClose,
  onDone,
}: {
  draft: StaffDraft;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const name = personOf(draft).name;
  const remove = useApiMutation(() => api.staff.deleteDraft(draft.id), {
    invalidate: ['staff', 'drafts'],
  });
  return (
    <Modal open title="Delete Draft" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          The draft for {name} is deleted. No account or invitation was made from it.
        </p>
        {remove.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(remove.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            className="bg-danger text-on-action hover:bg-danger"
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => onDone(`The draft for ${name} was deleted.`),
              })
            }
          >
            Delete Draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
