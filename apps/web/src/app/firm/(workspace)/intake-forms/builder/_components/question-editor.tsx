'use client';

import { Button, Input, Modal, Select, Textarea, Toggle } from '@firmivra/ui';
import { useState } from 'react';
import { CHOICE_TYPES, type DraftQuestion, type DraftSection, LAYOUT_TYPES } from './builder-draft';
import { QUESTION_LOOKS } from './question-types';

/**
 * Edit one question: its label, instructions, choices (one per line) and whether it is required.
 * A Number question can be a Currency amount (guide Frame 1).
 */
export function QuestionEditor({
  question,
  onSave,
  onClose,
}: {
  question: DraftQuestion;
  onSave: (q: DraftQuestion) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(question);
  const [choices, setChoices] = useState(question.options.join('\n'));
  const layout = LAYOUT_TYPES.includes(q.type);
  const choice = CHOICE_TYPES.includes(q.type);
  const numeric = q.type === 'NUMBER' || q.type === 'CURRENCY';
  const save = () =>
    onSave({
      ...q,
      options: choice
        ? choices
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
    });
  return (
    <Modal
      open
      title={`Edit ${QUESTION_LOOKS[q.type].label}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>
            Save Question
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {numeric ? (
          <Select
            label="Answer format"
            options={[
              { value: 'NUMBER', label: 'Number' },
              { value: 'CURRENCY', label: 'Currency' },
            ]}
            value={q.type}
            onChange={(ev) => setQ({ ...q, type: ev.target.value as 'NUMBER' | 'CURRENCY' })}
          />
        ) : null}
        {q.type === 'INSTRUCTION_TEXT' ? (
          <Textarea
            label="Text the client reads"
            rows={3}
            maxLength={300}
            value={q.label}
            onChange={(ev) => setQ({ ...q, label: ev.target.value })}
          />
        ) : (
          <Input
            label={q.type === 'SECTION_BREAK' ? 'Heading' : 'Question'}
            maxLength={300}
            value={q.label}
            onChange={(ev) => setQ({ ...q, label: ev.target.value })}
          />
        )}
        {q.type !== 'INSTRUCTION_TEXT' ? (
          <Textarea
            label="Instructions (optional)"
            rows={2}
            maxLength={500}
            value={q.help}
            onChange={(ev) => setQ({ ...q, help: ev.target.value })}
          />
        ) : null}
        {choice ? (
          <Textarea
            label="Choices, one per line"
            rows={4}
            value={choices}
            onChange={(ev) => setChoices(ev.target.value)}
          />
        ) : null}
        {!layout ? (
          <div className="flex min-h-10 items-center gap-3">
            <Toggle
              label="Required"
              checked={q.required}
              onChange={(on) => setQ({ ...q, required: on })}
            />
            <span className="text-sm text-heading">Required</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Edit a section's title and the line under it. */
export function SectionEditor({
  section,
  onSave,
  onClose,
}: {
  section: DraftSection;
  onSave: (s: DraftSection) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(section);
  return (
    <Modal
      open
      title="Edit Section"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(s)}>
            Save Section
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Section title"
          maxLength={120}
          value={s.title}
          onChange={(ev) => setS({ ...s, title: ev.target.value })}
        />
        <Textarea
          label="Description (optional)"
          rows={2}
          maxLength={500}
          value={s.description}
          onChange={(ev) => setS({ ...s, description: ev.target.value })}
        />
      </div>
    </Modal>
  );
}
