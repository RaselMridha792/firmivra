'use client';

import { FORM_CATEGORY_LABELS, type FormCategory } from '@firmivra/types';
import { Input, Radio, Select, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { type StartFrom, fromDetail } from './builder-draft';
import { type BuilderState, BuilderCard, INTAKE_FORMS } from './builder-parts';

const STARTS: { id: StartFrom; label: string }[] = [
  { id: 'SCRATCH', label: 'Create from scratch' },
  { id: 'TEMPLATE', label: 'Use existing template' },
  { id: 'DUPLICATE', label: 'Duplicate an existing form' },
];

/** A count under a text box ("0/500"). */
function Count({ value, max }: { value: string; max: number }) {
  return <p className="-mt-1 self-end text-xs text-muted">{`${value.length}/${max}`}</p>;
}

/**
 * 1. Form Details: Form Name and Service / Category (required), the client-visible description,
 * internal notes (never shown to the client), and Form Template: start from scratch, or copy the
 * sections of a template or of another form into this draft.
 */
export function FormDetailsCard({ state }: { state: BuilderState }) {
  const { draft: d, errors: e, update } = state;
  const [picked, setPicked] = useState('');
  const [note, setNote] = useState('');
  const kind = d.start;
  const choices = useApiQuery([...INTAKE_FORMS, 'builder-sources', kind], () =>
    kind === 'SCRATCH'
      ? Promise.resolve([])
      : api.intakeForms.forms({ templates: kind === 'TEMPLATE' ? 'true' : 'false' }),
  );
  const copy = useApiMutation((sourceId: string) => api.intakeForms.form(sourceId));
  // Retired forms are not offered; this form itself is not a source.
  const sources = (choices.data ?? []).filter((f) => f.id !== state.id && f.status !== 'RETIRED');

  const choose = (sourceId: string) => {
    setPicked(sourceId);
    setNote('');
    if (!sourceId) return;
    copy.mutate(sourceId, {
      onSuccess: (source) => {
        const from = fromDetail(source);
        update((x) => ({ ...x, sections: from.sections }));
        setNote(`The sections of ${source.name} are in Build Your Form.`);
      },
    });
  };

  return (
    <BuilderCard title="1. Form Details" testId="form-details">
      <Input
        label="Form Name *"
        maxLength={120}
        value={d.name}
        error={e.name}
        onChange={(ev) => update((x) => ({ ...x, name: ev.target.value }))}
      />
      <Select
        label="Service / Category *"
        options={Object.entries(FORM_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
        value={d.category}
        error={e.category}
        onChange={(ev) => update((x) => ({ ...x, category: ev.target.value as FormCategory }))}
      />
      <div className="flex flex-col gap-1">
        <Textarea
          label="Description (visible to client)"
          rows={4}
          maxLength={500}
          placeholder="Tell the client what this form is for and what to have ready."
          value={d.description}
          error={e.description}
          onChange={(ev) => update((x) => ({ ...x, description: ev.target.value }))}
        />
        <Count value={d.description} max={500} />
      </div>
      <div className="flex flex-col gap-1">
        <Textarea
          label="Internal Notes (optional)"
          rows={3}
          maxLength={500}
          placeholder="Add internal notes for your team…"
          value={d.internalNotes}
          error={e.internalNotes}
          onChange={(ev) => update((x) => ({ ...x, internalNotes: ev.target.value }))}
        />
        <Count value={d.internalNotes} max={500} />
      </div>
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-semibold text-heading">Form Template</legend>
        {STARTS.map((s) => (
          <Radio
            key={s.id}
            name={`start-${state.id}`}
            label={s.label}
            checked={kind === s.id}
            onChange={() => {
              setPicked('');
              setNote('');
              update((x) => ({ ...x, start: s.id }));
            }}
          />
        ))}
      </fieldset>
      {kind !== 'SCRATCH' ? (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
          <Select
            label={kind === 'TEMPLATE' ? 'Template to start from' : 'Form to duplicate'}
            options={[
              {
                value: '',
                label: choices.isPending
                  ? 'Loading…'
                  : sources.length
                    ? 'Choose…'
                    : choices.isError
                      ? 'Not available right now'
                      : 'None yet',
              },
              ...sources.map((f) => ({ value: f.id, label: `${f.name} (${f.questionCount})` })),
            ]}
            value={picked}
            disabled={copy.isPending || !sources.length}
            onChange={(ev) => choose(ev.target.value)}
          />
          <p role="status" className="text-xs text-muted">
            {copy.isPending
              ? 'Copying its sections…'
              : copy.error
                ? errorMessage(copy.error)
                : note || 'Choosing one replaces the sections in Build Your Form with a copy.'}
          </p>
        </div>
      ) : null}
    </BuilderCard>
  );
}
