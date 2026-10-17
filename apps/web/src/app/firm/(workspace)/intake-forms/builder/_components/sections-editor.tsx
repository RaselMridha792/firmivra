'use client';

import type { QuestionType } from '@firmivra/types';
import { ActionMenu, Badge, Button, Modal } from '@firmivra/ui';
import {
  CaretDown,
  CaretRight,
  Copy,
  DotsThreeVertical,
  PencilSimple,
  Plus,
  PlusCircle,
  Trash,
} from '@phosphor-icons/react';
import { type DragEvent, createElement, useState } from 'react';
import {
  type DraftQuestion,
  type DraftSection,
  type FormDraft,
  LAYOUT_TYPES,
  answerable,
  newKey,
} from './builder-draft';
import type { BuilderState } from './builder-parts';
import { QuestionEditor, SectionEditor } from './question-editor';
import { QUESTION_LOOKS, TILE_DRAG } from './question-types';

const SECTION_DRAG = 'application/x-firmivra-section';

/** Moves the item at `from` to `to` (both in range). */
function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** A copy with new keys, so the copy is edited on its own. */
const copyQuestion = (q: DraftQuestion): DraftQuestion => {
  const { showIf: _rule, ...rest } = q;
  return { ...rest, key: newKey('q') };
};
const copySection = (s: DraftSection): DraftSection => ({
  ...s,
  key: newKey('s'),
  title: `${s.title} (copy)`,
  questions: s.questions.map(copyQuestion),
});

function IconAction({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon: typeof Copy;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
      className={`flex size-10 items-center justify-center rounded-control hover:bg-canvas ${danger ? 'text-danger' : 'text-heading'}`}
    >
      {createElement(icon, { 'aria-hidden': true, weight: 'bold', className: 'size-5' })}
    </button>
  );
}

type Editing =
  | { kind: 'section'; sectionKey: string }
  | { kind: 'question'; sectionKey: string; questionKey: string }
  | { kind: 'delete'; sectionKey: string }
  | null;

/**
 * The Form Builder tab: Form Sections (open one to see its questions), each with Duplicate, Edit,
 * Delete and a menu to move it; sections drag to reorder and take a dragged question type.
 */
export function SectionsEditor({ state }: { state: BuilderState }) {
  const { draft, update, errors, active, setActive } = state;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [over, setOver] = useState<string | null>(null);

  const sections = draft.sections;
  const setSections = (change: (list: DraftSection[]) => DraftSection[]) =>
    update((d: FormDraft) => ({ ...d, sections: change(d.sections) }));
  const setQuestions = (key: string, change: (list: DraftQuestion[]) => DraftQuestion[]) =>
    setSections((list) =>
      list.map((s) => (s.key === key ? { ...s, questions: change(s.questions) } : s)),
    );
  const toggle = (key: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onDrop = (ev: DragEvent, index: number, key: string) => {
    ev.preventDefault();
    setOver(null);
    const type = ev.dataTransfer.getData(TILE_DRAG) as QuestionType | '';
    if (type) {
      state.addQuestion(type, key);
      setOpen((now) => new Set(now).add(key));
      return;
    }
    const from = sections.findIndex((s) => s.key === ev.dataTransfer.getData(SECTION_DRAG));
    if (from >= 0 && from !== index) setSections((list) => move(list, from, index));
  };

  const editingSection = editing ? sections.find((s) => s.key === editing.sectionKey) : undefined;
  const editingQuestion =
    editing?.kind === 'question'
      ? editingSection?.questions.find((q) => q.key === editing.questionKey)
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="form-sections"
        className="flex flex-col gap-3 rounded-lg border border-divider bg-canvas p-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-heading">Form Sections</h3>
            <p className="text-sm text-muted">
              Organize your questions into sections. Drag to reorder.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={state.addSection}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Section
          </Button>
        </div>
        {sections.length ? (
          <ol className="flex flex-col gap-2">
            {sections.map((s, index) => {
              const expanded = open.has(s.key);
              const count = answerable(s);
              const chosen = active === s.key;
              const error = errors[`section:${s.key}`];
              return (
                <li
                  key={s.key}
                  data-testid="form-section"
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData(SECTION_DRAG, s.key);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    setOver(s.key);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(ev) => onDrop(ev, index, s.key)}
                  className={`rounded-lg border bg-surface shadow-sm ${chosen ? 'border-action' : 'border-divider'} ${over === s.key ? 'ring-2 ring-action' : ''}`}
                >
                  <div className="flex items-center gap-1 p-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Close' : 'Open'} ${s.title}`}
                      onClick={() => {
                        toggle(s.key);
                        setActive(s.key);
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-control text-heading hover:bg-canvas"
                    >
                      {expanded ? (
                        <CaretDown aria-hidden weight="bold" className="size-5" />
                      ) : (
                        <CaretRight aria-hidden weight="bold" className="size-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActive(s.key)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-semibold text-heading">
                        {s.title || 'Untitled section'}
                      </span>
                      <span className="block text-sm text-muted">
                        {count === 1 ? '1 question' : `${count} questions`}
                      </span>
                      {error ? <span className="block text-sm text-danger">{error}</span> : null}
                    </button>
                    <IconAction
                      label={`Duplicate ${s.title}`}
                      icon={Copy}
                      onClick={() =>
                        setSections((list) => [
                          ...list.slice(0, index + 1),
                          copySection(s),
                          ...list.slice(index + 1),
                        ])
                      }
                    />
                    <IconAction
                      label={`Edit ${s.title}`}
                      icon={PencilSimple}
                      onClick={() => setEditing({ kind: 'section', sectionKey: s.key })}
                    />
                    <IconAction
                      label={`Delete ${s.title}`}
                      icon={Trash}
                      danger
                      onClick={() => setEditing({ kind: 'delete', sectionKey: s.key })}
                    />
                    <ActionMenu
                      label={`More for ${s.title}`}
                      align="right"
                      trigger={
                        <span className="flex size-10 items-center justify-center rounded-control text-heading hover:bg-canvas">
                          <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
                        </span>
                      }
                      sections={[
                        {
                          items: [
                            {
                              label: 'Move up',
                              onSelect: () =>
                                index > 0 && setSections((list) => move(list, index, index - 1)),
                            },
                            {
                              label: 'Move down',
                              onSelect: () =>
                                index < sections.length - 1 &&
                                setSections((list) => move(list, index, index + 1)),
                            },
                            {
                              label: 'Add questions here',
                              onSelect: () => {
                                setActive(s.key);
                                setOpen((now) => new Set(now).add(s.key));
                              },
                            },
                          ],
                        },
                      ]}
                    />
                  </div>
                  {expanded ? (
                    <QuestionList
                      section={s}
                      errors={errors}
                      onEdit={(q) =>
                        setEditing({ kind: 'question', sectionKey: s.key, questionKey: q.key })
                      }
                      onChange={(change) => setQuestions(s.key, change)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-lg bg-surface p-3 text-sm text-muted">
            No sections yet. Add a section, then add questions from Add Questions.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={state.addSection}
        className="flex min-h-20 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-action bg-accent-soft font-semibold text-action hover:bg-surface"
      >
        <PlusCircle aria-hidden weight="bold" className="size-6" />
        Add New Section
      </button>

      {editing?.kind === 'section' && editingSection ? (
        <SectionEditor
          section={editingSection}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setSections((list) => list.map((s) => (s.key === next.key ? next : s)));
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === 'question' && editingSection && editingQuestion ? (
        <QuestionEditor
          question={editingQuestion}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setQuestions(editingSection.key, (list) =>
              list.map((q) => (q.key === next.key ? next : q)),
            );
            setEditing(null);
          }}
        />
      ) : null}
      {editing?.kind === 'delete' && editingSection ? (
        <Modal
          open
          title="Delete Section"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setSections((list) => list.filter((s) => s.key !== editingSection.key));
                  if (active === editingSection.key) setActive(null);
                  setEditing(null);
                }}
              >
                Delete Section
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            {`Delete ${editingSection.title || 'this section'} and its ${editingSection.questions.length} questions from the draft? Nothing is removed from forms already sent.`}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** An open section's questions: type, label, Required, and Edit, Duplicate, Delete, Move. */
function QuestionList({
  section,
  errors,
  onEdit,
  onChange,
}: {
  section: DraftSection;
  errors: Record<string, string>;
  onEdit: (q: DraftQuestion) => void;
  onChange: (change: (list: DraftQuestion[]) => DraftQuestion[]) => void;
}) {
  const list = section.questions;
  if (!list.length) {
    return (
      <p className="border-t border-divider px-4 py-3 text-sm text-muted">
        No questions yet. Click a type in Add Questions, or drag one here.
      </p>
    );
  }
  return (
    <ul aria-label={`Questions in ${section.title}`} className="border-t border-divider">
      {list.map((q, i) => {
        const look = QUESTION_LOOKS[q.type];
        const error = errors[`question:${q.key}`];
        return (
          <li
            key={q.key}
            data-testid="form-question"
            className="flex items-center gap-2 border-b border-divider px-2 py-2 last:border-b-0"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-action">
              {createElement(look.icon, {
                'aria-hidden': true,
                weight: 'bold',
                className: 'size-5',
              })}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-heading">{q.label || 'Untitled'}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {look.label}
                {q.required && !LAYOUT_TYPES.includes(q.type) ? (
                  <Badge tone="info">Required</Badge>
                ) : null}
                {q.showIf ? <Badge tone="purple">Conditional</Badge> : null}
              </p>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
            </div>
            <IconAction label={`Edit ${q.label}`} icon={PencilSimple} onClick={() => onEdit(q)} />
            <IconAction
              label={`Duplicate ${q.label}`}
              icon={Copy}
              onClick={() =>
                onChange((all) => [...all.slice(0, i + 1), copyQuestion(q), ...all.slice(i + 1)])
              }
            />
            <IconAction
              label={`Delete ${q.label}`}
              icon={Trash}
              danger
              onClick={() => onChange((all) => all.filter((x) => x.key !== q.key))}
            />
            <ActionMenu
              label={`More for ${q.label}`}
              align="right"
              trigger={
                <span className="flex size-10 items-center justify-center rounded-control text-heading hover:bg-canvas">
                  <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
                </span>
              }
              sections={[
                {
                  items: [
                    {
                      label: 'Move up',
                      onSelect: () => i > 0 && onChange((all) => move(all, i, i - 1)),
                    },
                    {
                      label: 'Move down',
                      onSelect: () => i < list.length - 1 && onChange((all) => move(all, i, i + 1)),
                    },
                  ],
                },
              ]}
            />
          </li>
        );
      })}
    </ul>
  );
}
