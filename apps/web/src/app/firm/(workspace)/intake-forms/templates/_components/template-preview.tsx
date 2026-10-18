'use client';

import { FORM_CATEGORY_LABELS, type IntakeFormListItem, type QuestionType } from '@firmivra/types';
import { Button, Modal, Skeleton } from '@firmivra/ui';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { LIBRARY_KEY, LoadFailed, Quiet } from './template-look';

/** How each question shows its kind in the preview (display words only). */
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SHORT_ANSWER: 'Short answer',
  PARAGRAPH: 'Paragraph',
  MULTIPLE_CHOICE: 'Multiple choice',
  CHECKBOXES: 'Checkboxes',
  DROPDOWN: 'Dropdown',
  DATE: 'Date',
  FILE_UPLOAD: 'File upload',
  NUMBER: 'Number',
  CURRENCY: 'Currency',
  EMAIL: 'Email',
  PHONE: 'Phone',
  YES_NO: 'Yes / No',
  SIGNATURE: 'Signature',
  SECTION_BREAK: 'Section break',
  INSTRUCTION_TEXT: 'Instructions',
};

/**
 * Preview: the template's sections and questions, read-only (guide Frame 4: "Preview displays the
 * template without sending"). Mounted only while open, so the form loads only when asked for.
 */
export function TemplatePreview({
  template,
  onClose,
  onEdit,
  onUse,
}: {
  template: IntakeFormListItem;
  onClose: () => void;
  onEdit: () => void;
  onUse: () => void;
}) {
  const form = useApiQuery([...LIBRARY_KEY, 'form', template.id], () =>
    api.intakeForms.form(template.id),
  );
  const detail = form.data;
  const sections = detail?.sections ?? [];
  return (
    <Modal
      open
      title={template.name}
      subtitle={`${FORM_CATEGORY_LABELS[template.category]} · ${template.questionCount} questions · Preview only, nothing is sent`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button onClick={onUse}>Use Template</Button>
        </>
      }
    >
      <div data-testid="template-preview" className="flex flex-col gap-4">
        {form.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Loading the template…</span>
            <Skeleton className="w-1/2" />
            <Skeleton />
            <Skeleton />
            <Skeleton className="w-2/3" />
          </div>
        ) : form.isError || !detail ? (
          <LoadFailed error={form.error} onRetry={() => void form.refetch()} />
        ) : (
          <>
            {detail.description ? <p className="text-sm text-text">{detail.description}</p> : null}
            {sections.length === 0 ? (
              <Quiet>This template has no questions yet.</Quiet>
            ) : (
              <ol className="flex flex-col gap-3">
                {sections.map((section, index) => (
                  <li key={section.key} className="rounded-lg border border-divider p-4">
                    <h3 className="text-base font-semibold text-heading">
                      {index + 1}. {section.title}
                    </h3>
                    {section.description ? (
                      <p className="mt-1 text-sm text-muted">{section.description}</p>
                    ) : null}
                    {section.questions.length === 0 ? (
                      <p className="mt-2 text-sm text-muted">No questions in this section.</p>
                    ) : (
                      <ol className="mt-2 flex flex-col divide-y divide-divider">
                        {section.questions.map((question) => (
                          <li
                            key={question.key}
                            className="flex items-start justify-between gap-3 py-2 text-sm"
                          >
                            <span className="min-w-0">
                              <span className="text-text">{question.label}</span>
                              {question.required ? (
                                <span className="text-danger">
                                  {' '}
                                  <span aria-hidden>*</span>
                                  <span className="sr-only">(required)</span>
                                </span>
                              ) : null}
                              {question.help ? (
                                <span className="block text-xs text-muted">{question.help}</span>
                              ) : null}
                              {question.options?.length ? (
                                <span className="block text-xs text-muted">
                                  Options: {question.options.join(', ')}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs text-muted">
                              {QUESTION_TYPE_LABELS[question.type]}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
