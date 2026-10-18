'use client';

import { Eye, FileText } from '@phosphor-icons/react';
import type { IntakeFormListItem } from '@firmivra/types';
import { Button, Modal, Select } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { FieldError, FieldLabel, Loading, Panel, QuietLine, UNAVAILABLE } from './panel';
import { QUESTION_TYPE_LABELS } from './send-model';

const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;

/** Preview Form: the form as the recipient will see it, read only. Nothing is sent. */
function FormPreview({ formId }: { formId: string }) {
  const form = useApiQuery(['intake-forms', 'send', 'form', formId], () =>
    api.intakeForms.form(formId),
  );
  if (form.isPending) return <Loading rows={3} />;
  if (form.isError) return <QuietLine>{UNAVAILABLE}</QuietLine>;
  const f = form.data;
  return (
    <div className="flex flex-col gap-5" data-testid="send-form-preview">
      {f.description ? <p className="text-sm text-text">{f.description}</p> : null}
      {f.sections.length === 0 ? <QuietLine>This form has no questions yet.</QuietLine> : null}
      {f.sections.map((section) => (
        <section key={section.key} className="flex flex-col gap-2">
          <h3 className="text-base font-bold text-heading">{section.title}</h3>
          {section.description ? <p className="text-sm text-muted">{section.description}</p> : null}
          <ol className="flex flex-col gap-2">
            {section.questions.map((q) => (
              <li key={q.key} className="rounded-lg border border-divider p-3">
                <p className="text-sm font-medium text-text">
                  {q.label}
                  {q.required ? <span className="text-danger"> *</span> : null}
                </p>
                {q.help ? <p className="text-xs text-muted">{q.help}</p> : null}
                <p className="mt-1 text-xs text-muted">{QUESTION_TYPE_LABELS[q.type]}</p>
                {q.options?.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-text">
                    {q.options.map((option) => (
                      <li key={option}>{option}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Step 2: the published form or template, its question count and Preview Form. */
export function FormPanel({
  forms,
  formId,
  onForm,
  error,
  notPublished,
}: {
  forms: UseQueryResult<IntakeFormListItem[]>;
  formId: string;
  onForm: (formId: string) => void;
  error: string | undefined;
  /** The form in the link (?formId=) is not a published form. */
  notPublished: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const labelId = useId();
  const selectId = useId();
  const errorId = useId();
  const chosen = forms.data?.find((f) => f.id === formId);

  let field: ReactNode;
  if (forms.isPending) field = <Loading rows={1} />;
  else if (forms.isError) field = <QuietLine>{UNAVAILABLE}</QuietLine>;
  else if (forms.data.length === 0)
    field = (
      <QuietLine>No published forms yet. Publish a form in the form builder first.</QuietLine>
    );
  else
    field = (
      <Select
        id={selectId}
        label="Form / Template"
        hideLabel
        aria-labelledby={labelId}
        required
        value={chosen ? chosen.id : ''}
        onChange={(event) => onForm(event.target.value)}
        error={error}
        options={[
          { value: '', label: 'Select a form' },
          ...forms.data.map((f) => ({ value: f.id, label: f.name })),
        ]}
      />
    );

  return (
    <Panel
      step={2}
      title="Select Form"
      subtitle="Choose the form or template to send."
      testId="send-form"
    >
      <div className="flex flex-col gap-1">
        <FieldLabel id={labelId} htmlFor={selectId} required>
          Form / Template
        </FieldLabel>
        {field}
        {/* The select shows its own error; without one (loading, none, unreachable) it shows here. */}
        {forms.isSuccess && forms.data.length > 0 ? null : (
          <FieldError id={errorId}>{error}</FieldError>
        )}
        {notPublished ? (
          <p className="text-xs text-muted">
            The form you opened is not published yet, so it can&apos;t be sent. Publish it or choose
            another form.
          </p>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg bg-table-head p-3"
        data-testid="send-form-card"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
          <FileText aria-hidden weight="fill" className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="wrap-break-word font-semibold text-heading">
            {chosen?.name ?? 'No form selected'}
          </p>
          <p className="text-sm text-muted">
            {chosen ? questions(chosen.questionCount) : 'Choose a form above'}
          </p>
        </div>
        <Button variant="outline" disabled={!chosen} onClick={() => setPreview(true)}>
          <Eye aria-hidden weight="fill" className="size-5" />
          Preview Form
        </Button>
      </div>
      <Modal
        open={preview}
        title={chosen?.name ?? 'Preview form'}
        subtitle={`${chosen ? `${questions(chosen.questionCount)} · ` : ''}Preview only: nothing is sent.`}
        onClose={() => setPreview(false)}
        footer={
          <Button variant="secondary" onClick={() => setPreview(false)}>
            Close
          </Button>
        }
      >
        {preview && chosen ? <FormPreview formId={chosen.id} /> : null}
      </Modal>
    </Panel>
  );
}
