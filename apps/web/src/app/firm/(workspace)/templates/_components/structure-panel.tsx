'use client';

import {
  type BookkeepingFrequency,
  type LinkedTemplateKind,
  type MessageTemplateDetail,
  type MessageTemplateKind,
  type TemplateStructure,
} from '@firmivra/types';
import { Button, Input, Select, Textarea } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TEMPLATES_KEY, card, quiet } from './templates-shared';

// TP-F08: the real structure of a structured kind, edited in the template (R1's columns). Task,
// Document Request and Intake stand for their module's own template; Tax Workflow and Bookkeeping
// keep theirs here. Lines are one step each; blank lines are dropped.

const LINKED: Partial<Record<MessageTemplateKind, LinkedTemplateKind>> = {
  TASK: 'TASK',
  DOCUMENT_REQUEST: 'DOCUMENT_REQUEST',
  INTAKE_ORGANIZER: 'INTAKE_ORGANIZER',
};
const NOUNS: Record<LinkedTemplateKind, string> = {
  TASK: 'Task template',
  DOCUMENT_REQUEST: 'Requested documents',
  INTAKE_ORGANIZER: 'Intake and organizer',
};
const FREQUENCIES: { value: BookkeepingFrequency; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export type StructureDraft =
  | { type: 'link'; id: string }
  | { type: 'tax'; sections: { key: string; title: string; items: string }[] }
  | {
      type: 'books';
      documentRequests: { key: string; title: string; frequency: BookkeepingFrequency }[];
      closeChecklist: string;
      clientUpdates: string;
    };

/** Whether a kind has a structure to edit here. */
export const hasStructure = (kind: MessageTemplateKind) =>
  Boolean(LINKED[kind]) || kind === 'TAX_WORKFLOW' || kind === 'BOOKKEEPING';

/** A row's key: its place when loaded (so an unchanged draft equals its baseline), else new. */
let added = 0;
const newKey = () => {
  added += 1;
  return `new-${added}`;
};

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** The editor's draft of a template's structure (or an empty one of its kind). */
export function draftOf(
  kind: MessageTemplateKind,
  d?: Pick<MessageTemplateDetail, 'linkedTemplate' | 'structure'>,
): StructureDraft | null {
  if (LINKED[kind]) return { type: 'link', id: d?.linkedTemplate?.id ?? '' };
  const s = d?.structure;
  if (kind === 'TAX_WORKFLOW') {
    const sections = s && 'sections' in s ? s.sections : [];
    return {
      type: 'tax',
      sections: sections.length
        ? sections.map((x, i) => ({ key: `s${i}`, title: x.title, items: x.items.join('\n') }))
        : [{ key: 's0', title: '', items: '' }],
    };
  }
  if (kind === 'BOOKKEEPING') {
    const b = s && 'closeChecklist' in s ? s : null;
    return {
      type: 'books',
      documentRequests: (b?.documentRequests ?? []).map((r, i) => ({ key: `r${i}`, ...r })),
      closeChecklist: (b?.closeChecklist ?? []).join('\n'),
      clientUpdates: (b?.clientUpdates ?? []).join('\n'),
    };
  }
  return null;
}

/** The module template a linked kind's draft stands for (null: none), or undefined for the others. */
export const linkTarget = (draft: StructureDraft | null): string | null | undefined =>
  draft?.type === 'link' ? draft.id || null : undefined;

/** What a create or update sends for the structure (null when empty); a link goes on its own. */
export function structurePayload(draft: StructureDraft | null): {
  structure?: TemplateStructure | null;
} {
  if (!draft || draft.type === 'link') return {};
  if (draft.type === 'tax') {
    const sections = draft.sections
      .map((s) => ({ title: s.title.trim(), items: lines(s.items) }))
      .filter((s) => s.title && s.items.length);
    return { structure: sections.length ? { sections } : null };
  }
  const books = {
    documentRequests: draft.documentRequests
      .map((r) => ({ title: r.title.trim(), frequency: r.frequency }))
      .filter((r) => r.title),
    closeChecklist: lines(draft.closeChecklist),
    clientUpdates: lines(draft.clientUpdates),
  };
  const empty =
    !books.documentRequests.length && !books.closeChecklist.length && !books.clientUpdates.length;
  return { structure: empty ? null : books };
}

export function StructurePanel({
  kind,
  templateId,
  value,
  onChange,
  disabled,
}: {
  kind: MessageTemplateKind;
  /** The saved template (it may keep the module template it already stands for). */
  templateId?: string;
  value: StructureDraft;
  onChange: (next: StructureDraft) => void;
  disabled?: boolean;
}) {
  return (
    <section className={card} aria-label="Structure" data-testid="structure-panel">
      <h2 className="mb-1 font-display text-lg font-bold text-heading">Structure</h2>
      {value.type === 'link' && LINKED[kind] ? (
        <LinkedPicker
          kind={LINKED[kind]}
          templateId={templateId}
          value={value.id}
          onChange={(id) => onChange({ type: 'link', id })}
          disabled={disabled}
        />
      ) : value.type === 'tax' ? (
        <TaxSections value={value} onChange={onChange} disabled={disabled} />
      ) : value.type === 'books' ? (
        <BooksParts value={value} onChange={onChange} disabled={disabled} />
      ) : null}
    </section>
  );
}

function LinkedPicker({
  kind,
  templateId,
  value,
  onChange,
  disabled,
}: {
  kind: LinkedTemplateKind;
  templateId?: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const options = useApiQuery([...TEMPLATES_KEY, 'structure-options', kind], () =>
    api.templates.structureOptions({ kind }),
  );
  // One library template stands for each module template: the others' are not offered.
  const free = (options.data?.items ?? []).filter(
    (o) => !o.usedByTemplateId || o.usedByTemplateId === templateId,
  );
  const chosen = free.find((o) => o.id === value);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        This template stands for one of your firm&apos;s{' '}
        {kind === 'TASK'
          ? 'task templates: its checklist, due date and assignee rule'
          : kind === 'DOCUMENT_REQUEST'
            ? 'request lists: the documents it asks for'
            : 'intake templates: the organizer the client completes'}
        .
      </p>
      <Select
        label={NOUNS[kind]}
        value={value}
        disabled={disabled || !options.data}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: options.data ? 'Choose…' : 'Loading…' },
          ...free.map((o) => ({ value: o.id, label: o.name })),
        ]}
      />
      {options.isError ? <p className={quiet}>The list is not available right now.</p> : null}
      {options.data && free.length === 0 ? (
        <p className={quiet}>
          There is nothing to choose yet: make one in its module first, then come back.
        </p>
      ) : null}
      {chosen ? (
        <ol className="list-decimal pl-5 text-sm text-text" data-testid="structure-steps">
          {chosen.steps.map((step, i) => (
            <li key={`${i}-${step}`}>{step}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function TaxSections({
  value,
  onChange,
  disabled,
}: {
  value: Extract<StructureDraft, { type: 'tax' }>;
  onChange: (next: StructureDraft) => void;
  disabled?: boolean;
}) {
  const setSection = (i: number, patch: Partial<{ title: string; items: string }>) =>
    onChange({
      ...value,
      sections: value.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        The checklist by section, for the return or service type. One step per line.
      </p>
      {value.sections.map((s, i) => (
        <div
          key={s.key}
          className="flex flex-col gap-2 rounded-lg border border-divider p-3"
          data-testid="tax-section"
        >
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={`Section ${i + 1}`}
                value={s.title}
                disabled={disabled}
                maxLength={120}
                onChange={(e) => setSection(i, { title: e.target.value })}
              />
            </div>
            {value.sections.length > 1 ? (
              <button
                type="button"
                aria-label={`Remove section ${i + 1}`}
                disabled={disabled}
                onClick={() =>
                  onChange({ ...value, sections: value.sections.filter((_, j) => j !== i) })
                }
                className="mb-1 flex size-9 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            ) : null}
          </div>
          <Textarea
            label={`Steps of section ${i + 1}`}
            value={s.items}
            disabled={disabled}
            rows={4}
            onChange={(e) => setSection(i, { items: e.target.value })}
          />
        </div>
      ))}
      {value.sections.length < 20 ? (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              sections: [...value.sections, { key: newKey(), title: '', items: '' }],
            })
          }
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Section
        </Button>
      ) : null}
    </div>
  );
}

function BooksParts({
  value,
  onChange,
  disabled,
}: {
  value: Extract<StructureDraft, { type: 'books' }>;
  onChange: (next: StructureDraft) => void;
  disabled?: boolean;
}) {
  const setRequest = (
    i: number,
    patch: Partial<{ title: string; frequency: BookkeepingFrequency }>,
  ) =>
    onChange({
      ...value,
      documentRequests: value.documentRequests.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="books-requests">
        <h3 className="text-sm font-semibold text-heading">Recurring document requests</h3>
        {value.documentRequests.map((r, i) => (
          <div key={r.key} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <Input
              label={`Document ${i + 1}`}
              value={r.title}
              disabled={disabled}
              maxLength={120}
              onChange={(e) => setRequest(i, { title: e.target.value })}
            />
            <Select
              label="How often"
              value={r.frequency}
              disabled={disabled}
              onChange={(e) => setRequest(i, { frequency: e.target.value as BookkeepingFrequency })}
              options={FREQUENCIES}
            />
            <button
              type="button"
              aria-label={`Remove document ${i + 1}`}
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  documentRequests: value.documentRequests.filter((_, j) => j !== i),
                })
              }
              className="mb-1 flex size-9 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
            >
              <Trash aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        ))}
        {value.documentRequests.length < 30 ? (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                documentRequests: [
                  ...value.documentRequests,
                  { key: newKey(), title: '', frequency: 'MONTHLY' },
                ],
              })
            }
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Document
          </Button>
        ) : null}
      </div>
      <Textarea
        label="Close checklist (one step per line)"
        value={value.closeChecklist}
        disabled={disabled}
        rows={4}
        onChange={(e) => onChange({ ...value, closeChecklist: e.target.value })}
      />
      <Textarea
        label="Client updates (one per line)"
        value={value.clientUpdates}
        disabled={disabled}
        rows={3}
        onChange={(e) => onChange({ ...value, clientUpdates: e.target.value })}
      />
    </div>
  );
}
