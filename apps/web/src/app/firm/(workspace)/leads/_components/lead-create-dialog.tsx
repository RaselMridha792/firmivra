'use client';

import {
  CreateLeadRequest,
  type CreateLeadRequest as CreateLeadBody,
  type LeadOptions,
  type NextActionType,
  previewSequence,
} from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useMe } from '../../../../../components/signed-in';
import { SEQUENCES_KEY } from '../../templates/lead-sequences/_components/lead-sequences-screen';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES } from './lead-shared';
import { OtherContactsField } from './other-contacts-field';

/**
 * "No campaign" and "Unassigned" are empty choices: none, not an id. Without this the form
 * refused itself without a word whenever either was left empty.
 */
const noneIfEmpty = (value: string) => value || undefined;

const CHANNELS = [
  { value: 'PHONE', label: 'Phone' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
] as const;

const ACTIONS = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'SEND_DOCUMENTS', label: 'Send Documents' },
  { value: 'FOLLOW_UP', label: 'Follow Up' },
  { value: 'CLOSE_LEAD', label: 'Close Lead' },
];

export function LeadCreateDialog({
  open,
  options,
  onClose,
}: {
  open: boolean;
  options?: LeadOptions;
  onClose: () => void;
}) {
  // R2 19: a follow-up sequence applied once the lead exists (its steps from today).
  const { me } = useMe();
  const [sequenceId, setSequenceId] = useState('');
  const [sequenceError, setSequenceError] = useState('');
  const sequences = useApiQuery(SEQUENCES_KEY, () => api.leadSequences.list());
  // L8: "+ Add Follow-Up" adds a step; each has its action, date and time, and notes.
  const [steps, setSteps] = useState<
    { key: number; type: NextActionType; date: string; time: string; notes: string }[]
  >([]);
  const [stepKey, setStepKey] = useState(0);
  const setStep = (key: number, change: Partial<(typeof steps)[number]>) =>
    setSteps((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)));
  const [duplicateFound, setDuplicateFound] = useState(false);
  const { register, handleSubmit, formState, setValue, control } = useForm<CreateLeadBody>({
    resolver: zodResolver(CreateLeadRequest),
    defaultValues: {
      firstName: '',
      lastName: '',
      businessName: '',
      email: '',
      phone: '',
      otherContacts: [],
      source: 'OTHER',
      sourceDetail: '',
      serviceIds: [],
      preferredContact: [],
      priority: 'WARM',
      stage: 'SUBMITTED',
      allowDuplicate: false,
    },
  });
  const create = useApiMutation((body: CreateLeadBody) => api.leadPipeline.create(body), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const selectedServices = useWatch({ control, name: 'serviceIds' }) ?? [];
  const preferredContact = useWatch({ control, name: 'preferredContact' }) ?? [];
  const allowDuplicate = useWatch({ control, name: 'allowDuplicate' }) ?? false;
  const others = useWatch({ control, name: 'otherContacts' }) ?? [];

  const submit = (body: CreateLeadBody) => {
    const { campaignId, assignedUserId, ...rest } = body;
    const payload: CreateLeadBody = {
      ...rest,
      ...(campaignId ? { campaignId } : {}),
      ...(assignedUserId ? { assignedUserId } : {}),
      // L8: every step with a date.
      ...(steps.some((st) => st.date)
        ? {
            followUps: steps
              .filter((st) => st.date)
              .map((st) => ({
                type: st.type,
                dueAt: new Date(`${st.date}T${st.time || '09:00'}:00`).toISOString(),
                notes: st.notes.trim() || null,
              })),
          }
        : {}),
    };
    create.mutate(payload, {
      onSuccess: async (lead) => {
        const template = sequences.data?.find((t) => t.id === sequenceId);
        if (template) {
          const startOn = new Date().toLocaleDateString('en-CA');
          try {
            await api.leadSequences.apply(lead.id, {
              templateId: template.id,
              steps: previewSequence(template, {
                startOn,
                leadOwnerId: lead.assignedTo?.userId ?? null,
                applierId: me.user.id,
              }),
            });
          } catch (error) {
            // The lead is saved; say the sequence wasn't, so it can be applied from the lead.
            setSequenceError(
              `The lead was added, but the sequence was not applied: ${errorMessage(error)} Apply it from the lead's Tasks tab.`,
            );
            return;
          }
        }
        onClose();
      },
      onError: (error) => setDuplicateFound(errorCode(error) === 'POSSIBLE_DUPLICATE'),
    });
  };

  return (
    <Modal
      open={open}
      title="Add New Lead"
      subtitle="Add a prospect to your firm's pipeline."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-create-form" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save Lead'}
          </Button>
        </>
      }
    >
      <form
        id="lead-create-form"
        noValidate
        className="flex flex-col gap-5 overflow-y-auto pr-1"
        onSubmit={handleSubmit(submit)}
      >
        <section className="flex flex-col gap-3" aria-labelledby="lead-contact-section">
          <h3 id="lead-contact-section" className="font-semibold text-heading">
            Contact Information
          </h3>
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
          <Input
            label="Business / Company name"
            error={formState.errors.businessName?.message}
            {...register('businessName')}
          />
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
          <OtherContactsField
            value={others}
            onChange={(next) => setValue('otherContacts', next, { shouldDirty: true })}
            errors={
              formState.errors.otherContacts as Parameters<typeof OtherContactsField>[0]['errors']
            }
          />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="lead-details-section">
          <h3 id="lead-details-section" className="font-semibold text-heading">
            Lead Details
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Lead source" options={SOURCES} {...register('source')} />
            <Input
              label="Source / campaign detail"
              error={formState.errors.sourceDetail?.message}
              {...register('sourceDetail')}
            />
          </div>
          {options?.campaigns?.length ? (
            <Select
              label="Campaign"
              options={[
                { value: '', label: 'No campaign' },
                ...options.campaigns.map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                })),
              ]}
              {...register('campaignId', { setValueAs: noneIfEmpty })}
            />
          ) : null}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-text">Services interested in</legend>
            <div className="grid gap-x-3 sm:grid-cols-2">
              {options?.services.map((service) => (
                <Checkbox
                  key={service.id}
                  label={service.name}
                  checked={selectedServices.includes(service.id)}
                  onChange={(event) =>
                    setValue(
                      'serviceIds',
                      event.target.checked
                        ? [...selectedServices, service.id]
                        : selectedServices.filter((id) => id !== service.id),
                      { shouldValidate: true },
                    )
                  }
                />
              ))}
              {!options?.services.length ? (
                <p className="text-sm text-muted">No services available to select.</p>
              ) : null}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-text">Preferred contact</legend>
            <div className="grid gap-x-3 sm:grid-cols-3">
              {CHANNELS.map((channel) => (
                <Checkbox
                  key={channel.value}
                  label={channel.label}
                  checked={preferredContact.includes(channel.value)}
                  onChange={(event) =>
                    setValue(
                      'preferredContact',
                      event.target.checked
                        ? [...preferredContact, channel.value]
                        : preferredContact.filter((item) => item !== channel.value),
                      { shouldValidate: true },
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Priority" options={PRIORITIES} {...register('priority')} />
            <Select
              label="Status"
              options={STAGES.filter((item) => item.value !== 'CONVERTED')}
              {...register('stage')}
            />
            <Select
              label="Assigned staff"
              options={[
                { value: '', label: 'Unassigned' },
                ...(options?.staff.map((member) => ({
                  value: member.userId,
                  label: member.name,
                })) ?? []),
              ]}
              {...register('assignedUserId', { setValueAs: noneIfEmpty })}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="lead-follow-up-section">
          <h3 id="lead-follow-up-section" className="font-semibold text-heading">
            Next Follow-Up
          </h3>
          {steps.map((st, n) => (
            <fieldset
              key={st.key}
              className="grid gap-3 rounded-control border border-divider p-3 sm:grid-cols-2"
              aria-label={`Follow-up ${n + 1}`}
            >
              <Select
                label="Action type"
                value={st.type}
                onChange={(event) =>
                  setStep(st.key, { type: event.target.value as NextActionType })
                }
                options={ACTIONS}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Date"
                  type="date"
                  value={st.date}
                  onChange={(event) => setStep(st.key, { date: event.target.value })}
                />
                <Input
                  label="Time"
                  type="time"
                  value={st.time}
                  onChange={(event) => setStep(st.key, { time: event.target.value })}
                />
              </div>
              <Textarea
                label="Notes"
                rows={2}
                maxLength={500}
                value={st.notes}
                onChange={(event) => setStep(st.key, { notes: event.target.value })}
              />
              <Button
                variant="ghost"
                className="self-end sm:justify-self-end"
                onClick={() => setSteps((all) => all.filter((x) => x.key !== st.key))}
              >
                Remove<span className="sr-only"> follow-up {n + 1}</span>
              </Button>
            </fieldset>
          ))}
          <Button
            variant="secondary"
            className="w-fit"
            disabled={steps.length >= 10}
            onClick={() => {
              setSteps((all) => [
                ...all,
                { key: stepKey, type: 'CALL', date: '', time: '09:00', notes: '' },
              ]);
              setStepKey((k) => k + 1);
            }}
          >
            + Add Follow-Up
          </Button>
          {/* R2 19: a reusable sequence, applied once the lead is saved (its steps from today). */}
          <Select
            label="Follow-up sequence (optional)"
            options={[
              { value: '', label: 'None' },
              ...(sequences.data ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
            value={sequenceId}
            onChange={(event) => setSequenceId(event.target.value)}
          />
          {sequenceError ? (
            <p role="alert" className="text-sm text-danger">
              {sequenceError}
            </p>
          ) : null}
        </section>

        {duplicateFound ? (
          <Checkbox
            label="Create this lead anyway if the matching email or phone is correct"
            checked={allowDuplicate}
            onChange={(event) => setValue('allowDuplicate', event.target.checked)}
          />
        ) : null}
        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
