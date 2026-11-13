'use client';

import {
  TAG_ERRORS,
  UpdateLeadRequest,
  type ContactChannel,
  type LeadProfile,
  type LeadRow,
} from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Skeleton, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useFirm } from '../../../../../components/firm-context';
import { TagPicker } from '../../../../../components/tag-picker';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { profileKey } from '../[id]/_components/profile-shared';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES } from './lead-shared';

const CHANNELS: { value: ContactChannel; label: string }[] = [
  { value: 'PHONE', label: 'Phone' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
];

const sameText = (a: unknown, b: unknown) =>
  (typeof a === 'string' ? a.trim() : (a ?? '')) === (typeof b === 'string' ? b.trim() : (b ?? ''));
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t) => b.some((u) => u.toLowerCase() === t.toLowerCase()));

/** Every value the save sent is what the lead holds now (R2 7: a save's real outcome). */
function holds(lead: LeadProfile, sent: UpdateLeadRequest): boolean {
  return Object.entries(sent).every(([key, value]) => {
    if (key === 'version') return true;
    const now = (lead as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) return Array.isArray(now) && sameSet(value, now as string[]);
    if (key === 'email') return sameText(String(value).toLowerCase(), now);
    return sameText(value, now);
  });
}

/**
 * Edit Lead, from the row, the lead's page and its "+ Add Tag" (L5). Leads R2 8: every field the
 * Contact Information card shows is here (address, preferred contact, best time; date of birth once
 * leads keep one). R2 7: only the changed fields are sent, a saved change shows at once with a
 * message, and an error is checked against the lead before it is shown, so a save that went
 * through is never reported as failed.
 */
export function LeadEditDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadRow | LeadProfile;
  onClose: () => void;
  /** Told after a save that went through ("Changes saved."). */
  onSaved?: (message: string) => void;
}) {
  const given = 'address' in lead ? lead : undefined;
  // From the list, the row lacks the contact details: the form waits for the lead's profile.
  const loaded = useQuery({
    queryKey: profileKey(lead.id),
    queryFn: () => api.leadPipeline.profile(lead.id),
    enabled: !given,
  });
  const profile = given ?? loaded.data;
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
          <Button type="submit" form="lead-edit-form" disabled={!profile}>
            Save Changes
          </Button>
        </>
      }
    >
      {profile ? (
        <EditForm lead={profile} onClose={onClose} onSaved={onSaved} />
      ) : loaded.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(loaded.error)}
        </p>
      ) : (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
    </Modal>
  );
}

function EditForm({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadProfile;
  onClose: () => void;
  onSaved?: (message: string) => void;
}) {
  const client = useQueryClient();
  const { register, handleSubmit, formState, control, setValue } = useForm<UpdateLeadRequest>({
    resolver: zodResolver(UpdateLeadRequest),
    defaultValues: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone ?? '',
      address: lead.address ?? '',
      preferredContact: lead.preferredContact,
      bestTimeToContact: lead.bestTimeToContact ?? '',
      source: lead.source,
      sourceDetail: lead.sourceDetail ?? '',
      priority: lead.priority,
      stage: lead.stage === 'CONVERTED' ? undefined : lead.stage,
      tags: lead.tags,
    },
  });
  const tags = useWatch({ control, name: 'tags' }) ?? [];
  const preferred = useWatch({ control, name: 'preferredContact' }) ?? [];
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const { role } = useFirm();
  const [checking, setChecking] = useState(false);
  const save = useApiMutation((body: UpdateLeadRequest) => api.leadPipeline.update(lead.id, body), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const done = (saved: LeadProfile) => {
    // The lead's page shows the saved values straight away; the refetch follows.
    client.setQueryData(profileKey(lead.id), saved);
    onSaved?.('Changes saved.');
    onClose();
  };
  const submit = (values: UpdateLeadRequest) => {
    if (save.isPending || checking) return;
    // Only what changed: a field this form did not touch is never written back.
    const dirty = Object.keys(formState.dirtyFields) as (keyof UpdateLeadRequest)[];
    const body = Object.fromEntries(
      dirty
        .filter((key) => key !== 'tags' || !sameSet(values.tags ?? [], lead.tags))
        .map((key) => [key, values[key]]),
    ) as UpdateLeadRequest;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    save.mutate(body, {
      onSuccess: done,
      onError: async () => {
        // R2 7: before saying it failed, look at the lead. A save that went through is a save.
        setChecking(true);
        try {
          const now = await api.leadPipeline.profile(lead.id);
          if (holds(now, body)) {
            await client.invalidateQueries({ queryKey: LEAD_PIPELINE_KEY });
            done(now);
            return;
          }
        } catch {
          // The check itself failed: the save's own error stands.
        } finally {
          setChecking(false);
        }
      },
    });
  };
  const busy = save.isPending || checking;
  return (
    <form
      id="lead-edit-form"
      className="flex flex-col gap-4"
      noValidate
      aria-busy={busy}
      onSubmit={handleSubmit(submit)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="First name *"
          required
          error={formState.errors.firstName?.message}
          {...register('firstName')}
        />
        <Input
          label="Last name *"
          required
          error={formState.errors.lastName?.message}
          {...register('lastName')}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Email *"
          type="email"
          required
          error={formState.errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Phone"
          type="tel"
          error={formState.errors.phone?.message}
          {...register('phone')}
        />
      </div>
      <Textarea
        label="Address"
        rows={2}
        maxLength={300}
        error={formState.errors.address?.message}
        {...register('address')}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">Preferred contact</legend>
        <div className="flex flex-wrap gap-4">
          {CHANNELS.map((channel) => (
            <Checkbox
              key={channel.value}
              label={channel.label}
              checked={preferred.includes(channel.value)}
              onChange={(event) =>
                setValue(
                  'preferredContact',
                  event.target.checked
                    ? [...preferred, channel.value]
                    : preferred.filter((item) => item !== channel.value),
                  { shouldDirty: true },
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Best time to contact"
          maxLength={80}
          error={formState.errors.bestTimeToContact?.message}
          {...register('bestTimeToContact')}
        />
        <Input
          label="Date of birth"
          type="date"
          disabled
          value={lead.dateOfBirth ?? ''}
          readOnly
          aria-describedby="lead-dob-note"
        />
      </div>
      <p id="lead-dob-note" className="-mt-2 text-xs text-muted">
        A lead&apos;s date of birth can be saved once leads keep one (the next update).
      </p>
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
      {busy ? (
        <p role="status" className="text-sm text-muted">
          {checking ? 'Checking the lead…' : 'Saving…'}
        </p>
      ) : save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, TAG_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
