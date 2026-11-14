'use client';

import {
  LEAD_STEP_MODE_LABELS,
  LEAD_STEP_OWNER_LABELS,
  type LeadActionType,
  type LeadSequenceTemplate,
  type LeadStepMode,
  type LeadStepOwner,
  SaveLeadSequenceRequest,
} from '@firmivra/types';
import { Badge, Button, Card, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { ArrowLeft, ListNumbers, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

export const SEQUENCES_KEY = ['lead-sequences'] as const;

/** The follow-up actions a step can take (the lead's Next Action types). */
export const STEP_ACTIONS: { value: LeadActionType; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'SEND_DOCUMENTS', label: 'Send Documents' },
  { value: 'FOLLOW_UP', label: 'Follow Up' },
];
const MODES = (Object.keys(LEAD_STEP_MODE_LABELS) as LeadStepMode[]).map((value) => ({
  value,
  label: LEAD_STEP_MODE_LABELS[value],
}));
const OWNERS = (Object.keys(LEAD_STEP_OWNER_LABELS) as LeadStepOwner[]).map((value) => ({
  value,
  label: LEAD_STEP_OWNER_LABELS[value],
}));
const actionLabel = (v: LeadActionType) => STEP_ACTIONS.find((a) => a.value === v)?.label ?? v;

/**
 * Templates > Lead follow-up sequences (Leads R2 19): reusable ordered steps, each so many days
 * after the sequence is applied, at a time or not, with its action, owner and whether it is an
 * internal reminder or outreach the owner sends. Nothing is ever sent automatically. Owner and
 * Admin create, edit and archive; everyone applies them from a lead.
 */
export function LeadSequencesScreen() {
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const query = useApiQuery(SEQUENCES_KEY, () => api.leadSequences.list());
  const [editing, setEditing] = useState<LeadSequenceTemplate | 'new' | null>(null);
  const archive = useApiMutation((id: string) => api.leadSequences.archive(id), {
    invalidate: SEQUENCES_KEY,
  });
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-sequences">
      <Link
        href="/templates"
        className="flex w-fit items-center gap-2 text-sm font-medium text-link"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Templates
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <ListNumbers aria-hidden weight="fill" className="size-7" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">
              Lead follow-up sequences
            </h1>
            <p className="text-muted">
              Reusable follow-up steps for a lead. Applying one never sends anything by itself.
            </p>
          </div>
        </div>
        {manager ? (
          <Button onClick={() => setEditing('new')} data-testid="sequence-new">
            <Plus aria-hidden className="size-4" />
            New Sequence
          </Button>
        ) : null}
      </header>
      {archive.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(archive.error)}
        </p>
      ) : null}
      <PageState query={query} empty="No sequences yet.">
        {(templates) => (
          <ul className="grid gap-3 lg:grid-cols-2" aria-label="Sequences">
            {templates.map((t) => (
              <li key={t.id}>
                <Card className="flex h-full flex-col gap-2">
                  <h2 className="font-semibold text-heading">{t.name}</h2>
                  {t.description ? <p className="text-sm text-text">{t.description}</p> : null}
                  <ol className="flex flex-col gap-1 text-sm">
                    {t.steps.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <span className="text-muted">
                          Day {s.offsetDays}
                          {s.atTime ? `, ${s.atTime}` : ''}:
                        </span>
                        <span className="text-heading">{actionLabel(s.actionType)}</span>
                        <Badge tone={s.mode === 'OUTREACH' ? 'warning' : 'info'}>
                          {LEAD_STEP_MODE_LABELS[s.mode]}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                  {manager ? (
                    <div className="mt-auto flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => archive.mutate(t.id)}
                        disabled={archive.isPending}
                      >
                        Archive<span className="sr-only"> {t.name}</span>
                      </Button>
                      <Button variant="secondary" onClick={() => setEditing(t)}>
                        Edit<span className="sr-only"> {t.name}</span>
                      </Button>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      {editing ? (
        <SequenceEditor
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

type StepDraft = {
  key: number;
  offsetDays: string;
  atTime: string;
  actionType: LeadActionType;
  mode: LeadStepMode;
  owner: LeadStepOwner;
  note: string;
};
let nextKey = 0;

function SequenceEditor({
  template,
  onClose,
}: {
  template: LeadSequenceTemplate | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [steps, setSteps] = useState<StepDraft[]>(
    (
      template?.steps ?? [
        {
          offsetDays: 0,
          atTime: null,
          actionType: 'CALL',
          mode: 'REMINDER',
          owner: 'LEAD_OWNER',
          note: null,
        },
      ]
    ).map((s) => ({
      key: nextKey++,
      offsetDays: String(s.offsetDays),
      atTime: s.atTime ?? '',
      actionType: s.actionType,
      mode: s.mode,
      owner: s.owner,
      note: s.note ?? '',
    })),
  );
  const [error, setError] = useState('');
  const save = useApiMutation(
    (body: SaveLeadSequenceRequest) =>
      template ? api.leadSequences.update(template.id, body) : api.leadSequences.create(body),
    { invalidate: SEQUENCES_KEY },
  );
  const patch = (key: number, next: Partial<StepDraft>) =>
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...next } : s)));

  function submit() {
    const parsed = SaveLeadSequenceRequest.safeParse({
      name,
      description,
      steps: steps.map((s) => ({
        offsetDays: Number(s.offsetDays),
        atTime: s.atTime || null,
        actionType: s.actionType,
        mode: s.mode,
        owner: s.owner,
        note: s.note,
      })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the sequence');
      return;
    }
    setError('');
    save.mutate(parsed.data, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      title={template ? 'Edit Sequence' : 'New Sequence'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending} data-testid="sequence-save">
            Save Sequence
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Name *"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Description"
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <ol className="flex flex-col gap-3" aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className="flex flex-col gap-2 rounded-control border border-border p-3"
              data-testid="sequence-step"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-heading">Step {i + 1}</span>
                <Button
                  variant="ghost"
                  aria-label={`Remove step ${i + 1}`}
                  disabled={steps.length === 1}
                  onClick={() => setSteps((list) => list.filter((x) => x.key !== s.key))}
                >
                  <Trash aria-hidden className="size-4" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  label="Days after applying"
                  type="number"
                  min={0}
                  max={365}
                  value={s.offsetDays}
                  onChange={(e) => patch(s.key, { offsetDays: e.target.value })}
                />
                <Input
                  label="Time (optional)"
                  type="time"
                  value={s.atTime}
                  onChange={(e) => patch(s.key, { atTime: e.target.value })}
                />
                <Select
                  label="Action"
                  options={STEP_ACTIONS}
                  value={s.actionType}
                  onChange={(e) => patch(s.key, { actionType: e.target.value as LeadActionType })}
                />
                <Select
                  label="Kind"
                  options={MODES}
                  value={s.mode}
                  onChange={(e) => patch(s.key, { mode: e.target.value as LeadStepMode })}
                />
                <Select
                  label="Owner"
                  options={OWNERS}
                  value={s.owner}
                  onChange={(e) => patch(s.key, { owner: e.target.value as LeadStepOwner })}
                />
                <Input
                  label="Note"
                  maxLength={500}
                  value={s.note}
                  onChange={(e) => patch(s.key, { note: e.target.value })}
                />
              </div>
            </li>
          ))}
        </ol>
        {steps.length < 20 ? (
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                setSteps((list) => [
                  ...list,
                  {
                    key: nextKey++,
                    offsetDays: String(Number(list.at(-1)?.offsetDays ?? 0) + 1),
                    atTime: '',
                    actionType: 'FOLLOW_UP',
                    mode: 'REMINDER',
                    owner: 'LEAD_OWNER',
                    note: '',
                  },
                ])
              }
            >
              <Plus aria-hidden className="size-4" />
              Add Step
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          Outreach steps are reminders for the owner to send the message; nothing is sent
          automatically.
        </p>
        {error || save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {error || errorMessage(save.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
