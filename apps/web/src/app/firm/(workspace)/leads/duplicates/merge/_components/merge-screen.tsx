'use client';

import type { LeadMergeField, LeadMergePick, LeadProfile } from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import { ArrowLeft } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { fullName, LEAD_PIPELINE_KEY, PRIORITIES, SOURCES } from '../../../_components/lead-shared';

type Side = 'a' | 'b';

/** What each mergeable value shows (null: none). */
const FIELDS: { field: LeadMergeField; label: string; value: (l: LeadProfile) => string | null }[] =
  [
    { field: 'name', label: 'Name', value: (l) => `${l.firstName} ${l.lastName}`.trim() || null },
    { field: 'businessName', label: 'Business', value: (l) => l.businessName },
    { field: 'email', label: 'Email', value: (l) => l.email },
    { field: 'phone', label: 'Phone', value: (l) => l.phone },
    { field: 'address', label: 'Address', value: (l) => l.address },
    { field: 'dateOfBirth', label: 'Date of birth', value: (l) => l.dateOfBirth },
    {
      field: 'source',
      label: 'Source',
      value: (l) => SOURCES.find((s) => s.value === l.source)?.label ?? l.source,
    },
    {
      field: 'priority',
      label: 'Priority',
      value: (l) => PRIORITIES.find((p) => p.value === l.priority)?.label ?? null,
    },
    { field: 'owner', label: 'Assigned to', value: (l) => l.assignedTo?.name ?? null },
  ];

/**
 * Compare and Merge (Leads R2 15): two leads side by side. The reviewer keeps one and picks, for
 * each value that differs, which lead's value it keeps; then confirms. Tags, services and every
 * phone and email of both stay; the other lead is archived and linked ("Merged into"), its notes,
 * activity, tasks, files and forms kept on it. Owner and Admin only; Staff compare without merging.
 */
export function MergeScreen({ a, b }: { a: string; b: string }) {
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const router = useRouter();
  const queryClient = useQueryClient();
  const left = useApiQuery([...LEAD_PIPELINE_KEY, 'merge', a], () => api.leadPipeline.profile(a));
  const right = useApiQuery([...LEAD_PIPELINE_KEY, 'merge', b], () => api.leadPipeline.profile(b));
  const [keep, setKeep] = useState<Side>('a');
  const [picks, setPicks] = useState<Partial<Record<LeadMergeField, Side>>>({});
  const [confirming, setConfirming] = useState(false);
  const merge = useApiMutation(() => {
    const kept = keep === 'a' ? left.data! : right.data!;
    const other = keep === 'a' ? right.data! : left.data!;
    const take: Partial<Record<LeadMergeField, LeadMergePick>> = {};
    for (const { field } of FIELDS) {
      const side = picks[field] ?? keep;
      take[field] = side === keep ? 'KEPT' : 'MERGED';
    }
    return api.leadPipeline.merge(kept.id, {
      mergeLeadId: other.id,
      take,
      versions: { kept: kept.version, merged: other.version },
    });
  });

  const back = (
    <Link
      href="/leads/duplicates"
      className="flex w-fit items-center gap-2 text-sm font-medium text-link"
    >
      <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Review Duplicates
    </Link>
  );
  if (left.isPending || right.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="status" className="text-sm text-muted">
          Loading the two leads…
        </p>
      </div>
    );
  }
  if (!left.data || !right.data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="alert" className="text-sm text-danger">
          {errorMessage(left.error ?? right.error)}
        </p>
      </div>
    );
  }
  const leads: Record<Side, LeadProfile> = { a: left.data, b: right.data };
  const name = (l: LeadProfile) => fullName(l.firstName, l.lastName, l.email);
  const kept = leads[keep];
  const other = leads[keep === 'a' ? 'b' : 'a'];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-merge">
      {back}
      <header>
        <h1 className="font-display text-3xl font-bold text-heading">Compare and Merge</h1>
        <p className="text-muted">
          Choose the lead to keep and, where they differ, which value it keeps. Nothing changes
          until you confirm.
        </p>
      </header>
      <Card className="flex min-w-0 flex-col gap-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed text-sm">
          <caption className="sr-only">The two leads, value by value</caption>
          <thead>
            <tr className="text-left text-heading">
              <th scope="col" className="w-36 py-2">
                Value
              </th>
              {(['a', 'b'] as const).map((side) => (
                <th key={side} scope="col" className="py-2">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="radio"
                      name="keep"
                      checked={keep === side}
                      disabled={!manager}
                      onChange={() => setKeep(side)}
                      className="size-5"
                    />
                    Keep {name(leads[side])} ({leads[side].number})
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(({ field, label, value }) => {
              const values = { a: value(leads.a), b: value(leads.b) };
              const same = values.a === values.b;
              const chosen = picks[field] ?? keep;
              return (
                <tr key={field} className="border-t border-divider" data-testid={`merge-${field}`}>
                  <th scope="row" className="py-2 pr-2 text-left font-medium text-text">
                    {label}
                  </th>
                  {(['a', 'b'] as const).map((side) => (
                    <td key={side} className="py-2 pr-2 [overflow-wrap:anywhere]">
                      {same ? (
                        <span className="text-text">{values[side] ?? '—'}</span>
                      ) : (
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`pick-${field}`}
                            aria-label={`${label}: ${values[side] ?? 'none'}`}
                            checked={chosen === side}
                            disabled={!manager}
                            onChange={() => setPicks((p) => ({ ...p, [field]: side }))}
                            className="mt-0.5 size-4 shrink-0"
                          />
                          <span
                            className={chosen === side ? 'font-semibold text-heading' : 'text-text'}
                          >
                            {values[side] ?? '—'}
                          </span>
                        </label>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-sm text-text">
          Kept from both: tags, services and every phone and email (the other&apos;s as other
          contacts). {name(other)} ({other.number}) will be archived and linked to {name(kept)},
          with its notes, activity, tasks, files and forms kept on it.
        </p>
        {merge.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(merge.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => router.push('/leads/duplicates')}>
            Cancel
          </Button>
          {manager ? (
            <Button onClick={() => setConfirming(true)} data-testid="merge-start">
              Merge Leads
            </Button>
          ) : (
            <p className="self-center text-sm text-muted">
              Only an Owner or Admin can merge leads.
            </p>
          )}
        </div>
      </Card>
      <Modal
        open={confirming}
        title="Merge these leads?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={merge.isPending}
              onClick={() =>
                merge.mutate(undefined, {
                  onSuccess: async (saved) => {
                    await queryClient.invalidateQueries({ queryKey: LEAD_PIPELINE_KEY });
                    router.push(`/leads/${saved.id}`);
                  },
                  onError: () => setConfirming(false),
                })
              }
            >
              Merge
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {name(other)} ({other.number}) will be merged into {name(kept)} ({kept.number}). A merge
          can&apos;t be undone; the merged lead stays readable, linked from {name(kept)}.
        </p>
      </Modal>
    </div>
  );
}
