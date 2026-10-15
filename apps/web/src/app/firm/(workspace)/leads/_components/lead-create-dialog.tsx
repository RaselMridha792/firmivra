'use client';

import {
  CreateLeadRequest,
  type CreateLeadRequest as CreateLeadBody,
  type LeadOptions,
  type NextActionType,
} from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES, STAGES } from './lead-shared';

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
  const [followUp, setFollowUp] = useState(false);
  const [followUpType, setFollowUpType] = useState<NextActionType>('CALL');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('09:00');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [duplicateFound, setDuplicateFound] = useState(false);
  const { register, handleSubmit, formState, setValue, control } = useForm<CreateLeadBody>({
    resolver: zodResolver(CreateLeadRequest),
    defaultValues: {
      firstName: '',
      lastName: '',
      businessName: '',
      email: '',
      phone: '',
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

  const submit = (body: CreateLeadBody) => {
    const { campaignId, assignedUserId, ...rest } = body;
    const payload: CreateLeadBody = {
      ...rest,
      ...(campaignId ? { campaignId } : {}),
      ...(assignedUserId ? { assignedUserId } : {}),
      ...(followUp && followUpDate
        ? {
            nextAction: {
              type: followUpType,
              dueAt: new Date(`${followUpDate}T${followUpTime || '09:00'}:00`).toISOString(),
              notes: followUpNotes.trim() || null,
            },
          }
        : {}),
    };
    create.mutate(payload, {
      onSuccess: onClose,
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
              label="First name"
              required
              error={formState.errors.firstName?.message}
              {...register('firstName')}
            />
            <Input
              label="Last name"
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
              label="Email"
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
              {...register('campaignId')}
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
              {...register('assignedUserId')}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="lead-follow-up-section">
          <h3 id="lead-follow-up-section" className="font-semibold text-heading">
            Next Follow-Up
          </h3>
          <Checkbox
            label="Set a follow-up now"
            checked={followUp}
            onChange={(event) => setFollowUp(event.target.checked)}
          />
          {followUp ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Action type"
                value={followUpType}
                onChange={(event) => setFollowUpType(event.target.value as typeof followUpType)}
                options={ACTIONS}
              />
              <div className="grid gap-3 grid-cols-2">
                <Input
                  label="Date"
                  type="date"
                  value={followUpDate}
                  onChange={(event) => setFollowUpDate(event.target.value)}
                />
                <Input
                  label="Time"
                  type="time"
                  value={followUpTime}
                  onChange={(event) => setFollowUpTime(event.target.value)}
                />
              </div>
              <Textarea
                label="Notes"
                rows={2}
                maxLength={500}
                value={followUpNotes}
                onChange={(event) => setFollowUpNotes(event.target.value)}
              />
            </div>
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
