'use client';

import { RenameTaxStatusRequest, type TaxStatus } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { STATUS_ERRORS, TAX_STATUSES } from './shared';

/** The statuses in order, each with rename, move up or down, and archive. */
export function StatusList({ rows }: { rows: TaxStatus[] }) {
  const ids = rows.map((r) => r.id);
  // Every change refetches the list, so the screen always shows what the API has.
  const reorder = useApiMutation((order: string[]) => api.taxStatuses.reorder(order), {
    invalidate: TAX_STATUSES,
  });
  const archive = useApiMutation((id: string) => api.taxStatuses.archive(id), {
    invalidate: TAX_STATUSES,
  });

  /** The same ids with one moved by one place; the API needs every active id exactly once. */
  const moved = (from: number, to: number) => {
    const order = [...ids];
    const [id] = order.splice(from, 1);
    if (id) order.splice(to, 0, id);
    return order;
  };
  const error = reorder.error ?? archive.error;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, STATUS_ERRORS)}
        </p>
      ) : null}
      <ol className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row, i) => (
          <li
            key={row.id}
            data-testid="tax-status-row"
            className="flex flex-wrap items-center gap-2 p-3"
          >
            <StatusName row={row} />
            <RequireRole roles={['OWNER', 'ADMIN']}>
              <Button
                variant="ghost"
                aria-label={`Move ${row.name} up`}
                disabled={i === 0 || reorder.isPending}
                onClick={() => reorder.mutate(moved(i, i - 1))}
              >
                Up
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${row.name} down`}
                disabled={i === rows.length - 1 || reorder.isPending}
                onClick={() => reorder.mutate(moved(i, i + 1))}
              >
                Down
              </Button>
              <Button
                variant="secondary"
                aria-label={`Archive ${row.name}`}
                disabled={archive.isPending}
                onClick={() => archive.mutate(row.id)}
              >
                Archive
              </Button>
            </RequireRole>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The name, or a small rename form after "Rename" (Owner and Admin). */
function StatusName({ row }: { row: TaxStatus }) {
  const [editing, setEditing] = useState(false);
  const form = useForm<RenameTaxStatusRequest>({
    resolver: zodResolver(RenameTaxStatusRequest),
    defaultValues: { name: row.name },
  });
  const rename = useApiMutation(
    (body: RenameTaxStatusRequest) => api.taxStatuses.rename(row.id, body),
    { invalidate: TAX_STATUSES },
  );

  if (!editing) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <span data-testid="tax-status-name" className="text-sm font-medium text-text">
          {row.name}
        </span>
        <RequireRole roles={['OWNER', 'ADMIN']}>
          <Button
            variant="ghost"
            aria-label={`Rename ${row.name}`}
            onClick={() => setEditing(true)}
          >
            Rename
          </Button>
        </RequireRole>
      </div>
    );
  }
  return (
    <form
      className="flex flex-1 flex-wrap items-end gap-2"
      onSubmit={form.handleSubmit((body) =>
        rename.mutate(body, { onSuccess: () => setEditing(false) }),
      )}
    >
      <div className="flex-1">
        <Input
          label={`New name for ${row.name}`}
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
      </div>
      <Button type="submit" disabled={rename.isPending}>
        Save
      </Button>
      <Button variant="secondary" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {rename.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(rename.error, STATUS_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
