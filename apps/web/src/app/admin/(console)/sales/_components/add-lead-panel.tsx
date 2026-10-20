'use client';

import { Button, Callout, Checkbox, Drawer, Input, Select, Textarea } from '@firmivra/ui';
import { Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminSales,
  errorMessage,
  fieldErrors,
  LEAD_SOURCES,
  maxExtraUsers,
  monthlyCents,
  SalesDuplicateError,
  type LeadSource,
  type PlanId,
  type SalesOpportunity,
  type SalesPipeline,
  type SaveOpportunity,
} from './sales-api';
import { FrameError, money, parseMoney, SALES_KEY, useSalesMeta } from './sales-ui';
import { EMPTY_ENTRY, entryInput, StageEntryFields, type EntryState } from './stage-entry-fields';

interface FormState {
  firmName: string;
  contactName: string;
  email: string;
  phone: string;
  source: LeadSource | '';
  plan: PlanId | '';
  extraUsers: string;
  value: string;
  ownerId: string;
  stageId: string;
  tagIds: string[];
  notes: string;
}

export function usePipelines() {
  return useApiQuery<SalesPipeline[]>([...SALES_KEY, 'pipelines'], () => adminSales.pipelines());
}

/**
 * Add Lead / Opportunity (docx §16): a form panel on the page, no route. It checks probable
 * duplicates before creating; the new record lands in its stage and the KPIs refresh.
 */
export function AddLeadPanel({
  mode,
  pipelineId,
  stageId,
  onClose,
  onCreated,
}: {
  mode: 'LEAD' | 'OPPORTUNITY';
  pipelineId?: string;
  /** The column's "+ Add" chooses the stage. */
  stageId?: string;
  onClose: () => void;
  onCreated: (opportunity: SalesOpportunity) => void;
}) {
  const meta = useSalesMeta();
  const pipelines = usePipelines();
  const pipeline =
    pipelines.data?.find((item) => item.id === pipelineId) ??
    pipelines.data?.find((item) => item.isDefault);
  const stages = (pipeline?.stages ?? []).filter((stage) => stage.active);
  const defaultStage =
    stageId ??
    (mode === 'OPPORTUNITY'
      ? (stages.find((stage) => stage.name === 'Qualified') ?? stages[0])?.id
      : stages[0]?.id) ??
    '';
  const [form, setForm] = useState<FormState>({
    firmName: '',
    contactName: '',
    email: '',
    phone: '',
    source: '',
    plan: '',
    extraUsers: '0',
    value: '',
    ownerId: '',
    stageId: '',
    tagIds: [],
    notes: '',
  });
  const [entry, setEntry] = useState<EntryState>(EMPTY_ENTRY);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  // One per opening: a double click or a retry never makes a second record.
  const [requestId] = useState(() => crypto.randomUUID());
  const create = useApiMutation((body: SaveOpportunity) => adminSales.createOpportunity(body), {
    invalidate: SALES_KEY,
  });
  const chosenStageId = form.stageId || defaultStage;
  const stage = stages.find((item) => item.id === chosenStageId);
  const errors = { ...fieldErrors(create.error), ...localErrors };
  const duplicates = create.error instanceof SalesDuplicateError ? create.error.matches : [];
  const extraLimit = form.plan ? maxExtraUsers(form.plan) : 0;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const noun = mode === 'LEAD' ? 'Lead' : 'Opportunity';

  function submit(event: FormEvent) {
    event.preventDefault();
    const valueCents = parseMoney(form.value);
    const extraUsers = Number(form.extraUsers || '0');
    const problems: Record<string, string> = {};
    if (Number.isNaN(valueCents)) problems['valueCents'] = 'Enter an amount like 2,400 or 2400.00.';
    setLocalErrors(problems);
    if (Object.keys(problems).length) return;
    create.mutate(
      {
        requestId,
        pipelineId: pipeline?.id,
        firmName: form.firmName,
        contactName: form.contactName,
        email: form.email,
        phone: form.phone,
        source: form.source,
        plan: form.plan,
        extraUsers: Number.isInteger(extraUsers) ? extraUsers : -1,
        valueCents,
        ownerId: form.ownerId,
        stageId: chosenStageId,
        tagIds: form.tagIds,
        notes: form.notes,
        allowDuplicate,
        ...entryInput(entry, stage),
      },
      { onSuccess: (opportunity) => onCreated(opportunity) },
    );
  }

  const reps = meta.data?.reps ?? [];
  const plans = meta.data?.plans ?? [];
  const failed = (meta.isError && !meta.data) || (pipelines.isError && !pipelines.data);
  const generalError =
    create.error && !Object.keys(fieldErrors(create.error)).length && !duplicates.length
      ? errorMessage(create.error)
      : null;

  return (
    <Drawer
      open
      title={`Add ${noun}`}
      subtitle="Add a firm to the sales pipeline. Fields marked * are required."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sales-add-lead" disabled={create.isPending || failed}>
            {create.isPending ? 'Saving…' : `Save ${noun}`}
          </Button>
        </>
      }
    >
      {failed ? (
        <FrameError
          onRetry={() => {
            void meta.refetch();
            void pipelines.refetch();
          }}
        />
      ) : (
        <form id="sales-add-lead" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <section aria-labelledby="add-lead-contact" className="flex flex-col gap-3">
            <h3 id="add-lead-contact" className="text-sm font-semibold text-heading">
              Firm and contact
            </h3>
            <Input
              label="Firm / company name *"
              maxLength={120}
              autoComplete="organization"
              value={form.firmName}
              error={errors['firmName']}
              onChange={(event) => set('firmName', event.target.value)}
            />
            <Input
              label="Primary contact *"
              maxLength={80}
              autoComplete="name"
              value={form.contactName}
              error={errors['contactName']}
              onChange={(event) => set('contactName', event.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Email"
                type="email"
                maxLength={160}
                autoComplete="email"
                value={form.email}
                error={errors['email']}
                onChange={(event) => set('email', event.target.value)}
              />
              <Input
                label="Phone"
                type="tel"
                maxLength={20}
                autoComplete="tel"
                value={form.phone}
                error={errors['phone']}
                onChange={(event) => set('phone', event.target.value)}
              />
            </div>
          </section>

          <section aria-labelledby="add-lead-sales" className="flex flex-col gap-3">
            <h3 id="add-lead-sales" className="text-sm font-semibold text-heading">
              Sales details
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Lead source *"
                value={form.source}
                error={errors['source']}
                onChange={(event) => {
                  const source = LEAD_SOURCES.find((item) => item.id === event.target.value);
                  set('source', source?.id ?? '');
                }}
                options={[
                  { value: '', label: 'Choose a source' },
                  ...LEAD_SOURCES.map((source) => ({ value: source.id, label: source.label })),
                ]}
              />
              <Select
                label="Plan interest"
                value={form.plan}
                error={errors['plan']}
                onChange={(event) => {
                  const plan = plans.find((item) => item.id === event.target.value);
                  set('plan', plan?.id ?? '');
                  set('extraUsers', '0');
                }}
                options={[
                  { value: '', label: 'Not decided' },
                  ...plans.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
              {extraLimit > 0 ? (
                <Input
                  label={`Extra users (0–${extraLimit})`}
                  type="number"
                  min={0}
                  max={extraLimit}
                  value={form.extraUsers}
                  error={errors['extraUsers']}
                  onChange={(event) => set('extraUsers', event.target.value)}
                />
              ) : null}
              <Input
                label="Estimated annual value ($)"
                inputMode="decimal"
                maxLength={14}
                placeholder={
                  form.plan
                    ? money(monthlyCents(form.plan, Number(form.extraUsers) || 0, 0) * 12)
                    : '0'
                }
                value={form.value}
                error={errors['valueCents']}
                onChange={(event) => set('value', event.target.value)}
              />
              <Select
                label="Assigned rep"
                value={form.ownerId}
                error={errors['ownerId']}
                onChange={(event) => set('ownerId', event.target.value)}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...reps.map((rep) => ({ value: rep.id, label: rep.name })),
                ]}
              />
              <Select
                label="Starting stage"
                value={chosenStageId}
                error={errors['stageId']}
                onChange={(event) => set('stageId', event.target.value)}
                options={stages.map((item) => ({ value: item.id, label: item.name }))}
              />
            </div>
            <StageEntryFields
              stage={stage}
              value={entry}
              onChange={setEntry}
              errors={errors}
              reps={reps}
            />
            <fieldset className="flex flex-col">
              <legend className="mb-1 text-sm font-medium text-text">Tags</legend>
              <div className="grid grid-cols-2 gap-x-3">
                {(meta.data?.tags ?? []).map((tag) => (
                  <Checkbox
                    key={tag.id}
                    label={tag.name}
                    checked={form.tagIds.includes(tag.id)}
                    onChange={(event) =>
                      set(
                        'tagIds',
                        event.target.checked
                          ? [...form.tagIds, tag.id]
                          : form.tagIds.filter((id) => id !== tag.id),
                      )
                    }
                  />
                ))}
              </div>
              {errors['tagIds'] ? <p className="text-xs text-danger">{errors['tagIds']}</p> : null}
            </fieldset>
            <Textarea
              label="Notes"
              rows={3}
              maxLength={2000}
              value={form.notes}
              error={errors['notes']}
              onChange={(event) => set('notes', event.target.value)}
            />
          </section>

          {duplicates.length ? (
            <div data-testid="duplicate-warning" className="flex flex-col gap-2">
              <Callout
                icon={Warning}
                surface="warning"
                tone="amber"
                size="compact"
                title="Possible duplicate"
              >
                <ul className="flex flex-col gap-1">
                  {duplicates.map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/sales/opportunities/${match.id}`}
                        className="font-medium text-action hover:underline"
                      >
                        {match.firmName}
                      </Link>{' '}
                      ({match.contactName}, {match.stageName}) matches on {match.matchedOn}.
                    </li>
                  ))}
                </ul>
              </Callout>
              <Checkbox
                label="This is a different firm: create a new record anyway"
                checked={allowDuplicate}
                onChange={(event) => setAllowDuplicate(event.target.checked)}
              />
            </div>
          ) : null}
          {generalError ? (
            <p role="alert" className="text-sm text-danger">
              {generalError}
            </p>
          ) : null}
        </form>
      )}
    </Drawer>
  );
}
