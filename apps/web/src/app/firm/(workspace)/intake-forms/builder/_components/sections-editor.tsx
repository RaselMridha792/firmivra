'use client';

import { QuestionType } from '@firmivra/types';
import { Badge, Button, Modal } from '@firmivra/ui';
import {
  CaretDown,
  CaretRight,
  Copy,
  type Icon,
  PencilSimple,
  Plus,
  PlusCircle,
  Trash,
} from '@phosphor-icons/react';
import { type DragEvent, useState } from 'react';
import {
  type DraftQuestion,
  type DraftSection,
  type FormDraft,
  LAYOUT_TYPES,
  answerable,
  newKey,
  problemDomId,
  withoutRulesOn,
} from './builder-draft';
import type { BuilderState } from './builder-parts';
import { MoreMenu } from './more-menu';
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

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/** A copy with new keys and no rule, so the copy is edited on its own. */
const copyQuestion = (q: DraftQuestion): DraftQuestion => {
  const { showIf: _rule, ...rest } = q;
  return { ...rest, key: newKey('q') };
};
const copySection = (s: DraftSection): DraftSection => ({
  ...s,
  key: newKey('s'),
  title: `${s.title} (copy)`.slice(0, 120),
  questions: s.questions.map(copyQuestion),
});

/** A bare icon button of a section or question row (Duplicate, Edit, Delete). */
function IconAction({
  label,
  icon: Glyph,
  danger = false,
  onClick,
}: {
  label: string;
  icon: Icon;
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
      className={`flex size-9 shrink-0 items-center justify-center rounded-control hover:bg-canvas ${danger ? 'text-danger' : 'text-text hover:text-heading'}`}
    >
      <Glyph aria-hidden weight="fill" className="size-5" />
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
 * Delete and a menu to move it; sections drag to reorder and take a dragged question type. With
 * no sections, a quiet line and Add New Section.
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
  const openSection = (key: string) => setOpen((now) => new Set(now).add(key));
  const toggle = (key: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A section opens when a question lands in it (a tile click adds to the chosen section), so the
  // new question shows. Adjusted while rendering, as React suggests for state that follows props.
  const sizes = new Map(sections.map((s): [string, number] => [s.key, s.questions.length]));
  const [seen, setSeen] = useState(sizes);
  if (sizes.size !== seen.size || sections.some((s) => seen.get(s.key) !== s.questions.length)) {
    setSeen(sizes);
    const grown = sections.filter(
      (s) => s.questions.length > (seen.get(s.key) ?? 0) && (seen.has(s.key) || s.key === active),
    );
    if (grown.length) {
      setOpen((now) => new Set([...now, ...grown.map((s) => s.key)]));
    }
  }
  // A section with a problem on one of its questions opens, so the problem shows where it is
  // (Octavia's review, I3: a closed section hid it). Adjusted while rendering, as above.
  const flagged = sections
    .filter((s) => s.questions.some((q) => errors[`question:${q.key}`]))
    .map((s) => s.key)
    .join(' ');
  const [shown, setShown] = useState('');
  if (flagged !== shown) {
    setShown(flagged);
    if (flagged) setOpen((now) => new Set([...now, ...flagged.split(' ')]));
  }

  const removeQuestion = (sectionKey: string, questionKey: string) =>
    setSections((list) =>
      withoutRulesOn(
        list.map((s) =>
          s.key === sectionKey
            ? { ...s, questions: s.questions.filter((q) => q.key !== questionKey) }
            : s,
        ),
        new Set([questionKey]),
      ),
    );
  const removeSection = (section: DraftSection) => {
    setSections((list) =>
      withoutRulesOn(
        list.filter((s) => s.key !== section.key),
        new Set(section.questions.map((q) => q.key)),
      ),
    );
    if (active === section.key) setActive(null);
  };

  const onDrop = (ev: DragEvent, index: number, key: string) => {
    ev.preventDefault();
    setOver(null);
    const type = QuestionType.safeParse(ev.dataTransfer.getData(TILE_DRAG));
    if (type.success) {
      state.addQuestion(type.data, key);
      openSection(key);
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
      <div data-testid="form-sections" className="flex flex-col gap-3 rounded-xl bg-canvas p-2">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 xl:flex-nowrap">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-heading">Form Sections</h3>
            <p className="text-sm text-text">
              Organize your questions into sections. Drag to reorder.
            </p>
          </div>
          <Button type="button" variant="outline" className="shrink-0" onClick={state.addSection}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Section
          </Button>
        </div>
        {sections.length ? (
          <ol aria-label="Form sections" className="flex flex-col gap-2">
            {sections.map((s, index) => {
              const expanded = open.has(s.key);
              const count = answerable(s);
              const chosen = active === s.key;
              const error = errors[`section:${s.key}`];
              const name = s.title || 'Untitled section';
              return (
                <li
                  key={s.key}
                  id={problemDomId(`section:${s.key}`)}
                  data-testid="form-section"
                  data-invalid={error ? true : undefined}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData(SECTION_DRAG, s.key);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    if (over !== s.key) setOver(s.key);
                  }}
                  onDragLeave={(ev) => {
                    // Moving onto a child of the row is not leaving it.
                    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver(null);
                  }}
                  onDrop={(ev) => onDrop(ev, index, s.key)}
                  className={`rounded-lg border bg-surface shadow-sm ${chosen ? 'border-action' : 'border-transparent'} ${over === s.key ? 'ring-2 ring-action' : ''}`}
                >
                  <div className="flex items-center gap-1 px-1 py-1 sm:pr-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Close' : 'Open'} ${name}`}
                      onClick={() => {
                        toggle(s.key);
                        setActive(s.key);
                      }}
                      className="flex size-9 shrink-0 items-center justify-center rounded-control text-heading hover:bg-canvas"
                    >
                      {expanded ? (
                        <CaretDown aria-hidden weight="bold" className="size-5" />
                      ) : (
                        <CaretRight aria-hidden weight="bold" className="size-5" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setActive(s.key)}
                      className="min-w-0 flex-1 rounded-control py-1 text-left"
                    >
                      <span className="block truncate font-semibold text-heading">{name}</span>
                      <span data-testid="section-count" className="block text-sm text-text">
                        {plural(count, 'question')}
                      </span>
                      {error ? <span className="block text-sm text-danger">{error}</span> : null}
                    </button>
                    <IconAction
                      label={`Duplicate ${name}`}
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
                      label={`Edit ${name}`}
                      icon={PencilSimple}
                      onClick={() => setEditing({ kind: 'section', sectionKey: s.key })}
                    />
                    <IconAction
                      label={`Delete ${name}`}
                      icon={Trash}
                      danger
                      onClick={() => setEditing({ kind: 'delete', sectionKey: s.key })}
                    />
                    <MoreMenu
                      label={`More for ${name}`}
                      items={[
                        {
                          label: 'Add questions here',
                          onSelect: () => {
                            setActive(s.key);
                            openSection(s.key);
                          },
                        },
                        {
                          label: 'Move up',
                          disabled: index === 0,
                          onSelect: () => setSections((list) => move(list, index, index - 1)),
                        },
                        {
                          label: 'Move down',
                          disabled: index === sections.length - 1,
                          onSelect: () => setSections((list) => move(list, index, index + 1)),
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
                      onRemove={(q) => removeQuestion(s.key, q.key)}
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
        className="flex min-h-18 items-center justify-center gap-2 rounded-xl border border-dashed border-control-border bg-canvas px-4 font-semibold text-action hover:border-action hover:bg-info-soft"
      >
        <PlusCircle aria-hidden weight="fill" className="size-7" />
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
                  removeSection(editingSection);
                  setEditing(null);
                }}
              >
                Delete Section
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            {`Delete ${editingSection.title || 'this section'} and its ${plural(editingSection.questions.length, 'item')} from this draft? Forms already sent are not changed.`}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** An open section's questions: type, label, Required, and Duplicate, Edit, Delete, Move. */
function QuestionList({
  section,
  errors,
  onEdit,
  onRemove,
  onChange,
}: {
  section: DraftSection;
  errors: Record<string, string>;
  onEdit: (q: DraftQuestion) => void;
  onRemove: (q: DraftQuestion) => void;
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
        const Glyph = look.icon;
        const error = errors[`question:${q.key}`];
        const name = q.label || 'Untitled';
        return (
          <li
            key={q.key}
            id={problemDomId(`question:${q.key}`)}
            data-testid="form-question"
            data-invalid={error ? true : undefined}
            className="flex items-center gap-1 border-b border-divider py-2 pr-1 pl-3 last:border-b-0 sm:gap-2 sm:pr-2"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action">
              <Glyph aria-hidden weight="fill" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-heading">{name}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {look.label}
                {q.required && !LAYOUT_TYPES.includes(q.type) ? (
                  <Badge tone="info">Required</Badge>
                ) : null}
                {q.showIf ? <Badge tone="purple">Conditional</Badge> : null}
              </p>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
            </div>
            <IconAction
              label={`Duplicate ${name}`}
              icon={Copy}
              onClick={() =>
                onChange((all) => [...all.slice(0, i + 1), copyQuestion(q), ...all.slice(i + 1)])
              }
            />
            <IconAction label={`Edit ${name}`} icon={PencilSimple} onClick={() => onEdit(q)} />
            <IconAction label={`Delete ${name}`} icon={Trash} danger onClick={() => onRemove(q)} />
            <MoreMenu
              label={`More for ${name}`}
              items={[
                {
                  label: 'Move up',
                  disabled: i === 0,
                  onSelect: () => onChange((all) => move(all, i, i - 1)),
                },
                {
                  label: 'Move down',
                  disabled: i === list.length - 1,
                  onSelect: () => onChange((all) => move(all, i, i + 1)),
                },
              ]}
            />
          </li>
        );
      })}
    </ul>
  );
}
