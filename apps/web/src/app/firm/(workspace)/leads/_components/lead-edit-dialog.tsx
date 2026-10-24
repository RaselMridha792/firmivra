'use client';

import { TAG_ERRORS, UpdateLeadRequest, type LeadRow } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useFirm } from '../../../../../components/firm-context';
import { TagPicker } from '../../../../../components/tag-picker';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES } from './lead-shared';

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t) => b.some((u) => u.toLowerCase() === t.toLowerCase()));

/**
 * Edit Lead, from the row, the lead's page and its "+ Add Tag" (L5): the tags are picked from the
 * firm's one list (components/tag-picker.tsx) and sent only when they changed.
 */
export function LeadEditDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { register, handleSubmit, formState, control, setValue } = useForm<UpdateLeadRequest>({
    resolver: zodResolver(UpdateLeadRequest),
    defaultValues: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone ?? '',
      source: lead.source,
      sourceDetail: lead.sourceDetail ?? '',
      priority: lead.priority,
      stage: lead.stage === 'CONVERTED' ? undefined : lead.stage,
      tags: lead.tags,
    },
  });
  const tags = useWatch({ control, name: 'tags' }) ?? [];
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const { role } = useFirm();
  const save = useApiMutation(
    ({ id, body }: { id: string; body: UpdateLeadRequest }) => api.leadPipeline.update(id, body),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  return (
    <Modal
      open
      title="Edit Lead"
      subtitle={`Update ${lead.firstName} ${lead.lastName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-edit-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form
        id="lead-edit-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={handleSubmit(({ tags: picked, ...rest }) =>
          save.mutate(
            {
              id: lead.id,
              body: picked && !sameTags(picked, lead.tags) ? { ...rest, tags: picked } : rest,
            },
            { onSuccess: onClose },
          ),
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="First name"
            error={formState.errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Last name"
            error={formState.errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <Input
          label="Email"
          type="email"
          error={formState.errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Phone"
          type="tel"
          error={formState.errors.phone?.message}
          {...register('phone')}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Lead source" options={SOURCES} {...register('source')} />
          <Input
            label="Source details"
            error={formState.errors.sourceDetail?.message}
            {...register('sourceDetail')}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Priority" options={PRIORITIES} {...register('priority')} />
          {lead.stage === 'CONVERTED' ? (
            <p className="self-center text-sm text-muted">
              Converted leads keep their client status.
            </p>
          ) : (
            <Select
              label="Status"
              options={STAGES.filter((item) => item.value !== 'CONVERTED')}
              {...register('stage')}
            />
          )}
        </div>
        <TagPicker
          label="Tags"
          value={tags}
          onChange={(next) => setValue('tags', next, { shouldDirty: true })}
          options={options.data?.tags ?? []}
          loading={options.isPending}
          canCreate={role === 'OWNER' || role === 'ADMIN'}
          max={20}
          error={formState.errors.tags?.message}
        />
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, TAG_ERRORS)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
