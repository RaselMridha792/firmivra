'use client';

import { CreateTaxStatusRequest } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../../../../../lib/errors';
import { api } from '../../../../../../lib/api';
import { useApiMutation } from '../../../../../../lib/query';
import { STATUS_ERRORS, TAX_STATUSES } from './shared';

/** Add a status. The form checks the same schema the API uses (from @firmivra/types). */
export function AddStatusForm() {
  const form = useForm<CreateTaxStatusRequest>({
    resolver: zodResolver(CreateTaxStatusRequest),
    defaultValues: { name: '' },
  });
  // 3. Change data from the browser only, then refetch the list.
  const create = useApiMutation((body: CreateTaxStatusRequest) => api.taxStatuses.create(body), {
    invalidate: TAX_STATUSES,
  });

  return (
    <form
      onSubmit={form.handleSubmit((body) => create.mutate(body, { onSuccess: () => form.reset() }))}
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Input
          label="New status"
          data-testid="new-status-name"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
      </div>
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Adding…' : 'Add status'}
      </Button>
      {/* 4. API errors through errorMessage, with this module's own codes. */}
      {create.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(create.error, STATUS_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
