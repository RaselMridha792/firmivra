'use client';

import type { QuestionType } from '@firmivra/types';
import {
  Button,
  Callout,
  Checkbox,
  FileDropzone,
  Input,
  Radio,
  Select,
  Textarea,
} from '@firmivra/ui';
import {
  CloudArrowUp,
  Eye,
  Info,
  PaperPlaneRight,
  Signature,
  TreeStructure,
} from '@phosphor-icons/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { type DraftQuestion, type DraftSettings, LAYOUT_TYPES } from './builder-draft';
import type { BuilderState } from './builder-parts';

const ANSWER = 'Your answer';
const QUIET = 'rounded-lg bg-subtle p-3 text-sm text-muted';
const TEXT = 'whitespace-pre-line wrap-anywhere';
const ignore = () => undefined;

/** The one-line input each of these types answers in; Short Answer is plain text. */
const SHORT: InputHTMLAttributes<HTMLInputElement> = { type: 'text', placeholder: ANSWER };
const INPUTS: Partial<Record<QuestionType, InputHTMLAttributes<HTMLInputElement>>> = {
  EMAIL: { type: 'email', placeholder: 'name@example.com' },
  PHONE: { type: 'tel', placeholder: '(555) 000-0000' },
  DATE: { type: 'date' },
  NUMBER: { type: 'number', inputMode: 'decimal', placeholder: '0' },
};

type Rule = NonNullable<DraftQuestion['showIf']>;

/** A condition's value in words: Yes / No, a number, or the quoted answer. */
function valueWords(value: Rule['equals']) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return `"${value}"`;
}

/** "Shown when "Filing status" is "Married"" for a conditional question (Logic & Rules). */
function shownWhen(rule: Rule, byKey: Map<string, DraftQuestion>) {
  const source = byKey.get(rule.questionKey)?.label.trim();
  const value = valueWords(rule.equals);
  return source ? `Shown when "${source}" is ${value}` : `Shown when an earlier answer is ${value}`;
}

/** Whether the client must answer: its own Required, or Require all / Require e-signature. */
function isRequired(q: DraftQuestion, settings: DraftSettings) {
  if (LAYOUT_TYPES.includes(q.type)) return false;
  if (q.type === 'FILE_UPLOAD' && !settings.allowFileUploads) return false;
  return (
    q.required ||
    settings.requireAllQuestions ||
    (q.type === 'SIGNATURE' && settings.requireSignature)
  );
}

/** A question answered with a group of controls (choices, Yes / No, a file, a signature). */
function Group({ legend, help, children }: { legend: string; help: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className={`text-sm font-medium text-text ${TEXT}`}>{legend}</legend>
      {help ? <p className={`text-xs text-muted ${TEXT}`}>{help}</p> : null}
      {children}
    </fieldset>
  );
}

/** The signature box the client signs in; here it takes nothing. */
function SignatureBox() {
  return (
    <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-control-border bg-subtle p-4 text-sm text-muted">
      <Signature aria-hidden weight="fill" className="size-6 text-heading" />
      Sign here
    </div>
  );
}

/** One question as the client answers it: the real control, switched off. */
function PreviewQuestion({
  q,
  settings,
  byKey,
}: {
  q: DraftQuestion;
  settings: DraftSettings;
  byKey: Map<string, DraftQuestion>;
}) {
  const required = isRequired(q, settings);
  const label = `${q.label.trim() || 'Untitled question'}${required ? ' *' : ''}`;
  const helpId = `preview-${q.key}-help`;
  const help = q.help.trim();
  const field = {
    label,
    disabled: true,
    'aria-required': required || undefined,
    'aria-describedby': help ? helpId : undefined,
  };
  const helpLine = help ? (
    <p id={helpId} className={`text-xs text-muted ${TEXT}`}>
      {help}
    </p>
  ) : null;
  const choices = q.options.filter((o) => o.trim());
  const noChoices = <p className="text-sm text-muted">No choices yet.</p>;

  let body: ReactNode;
  switch (q.type) {
    case 'SECTION_BREAK':
      body = (
        <div className="flex flex-col gap-1 border-t border-divider pt-3">
          <h5 className={`text-base font-bold text-heading ${TEXT}`}>
            {q.label.trim() || 'Untitled part'}
          </h5>
          {help ? <p className={`text-sm text-muted ${TEXT}`}>{help}</p> : null}
        </div>
      );
      break;
    case 'INSTRUCTION_TEXT':
      body = (
        <Callout icon={Info} tone="blue" surface="info" size="compact">
          <span className={TEXT}>{q.label.trim() || 'Instructions for the client'}</span>
        </Callout>
      );
      break;
    case 'PARAGRAPH':
      body = (
        <>
          <Textarea {...field} rows={3} placeholder={ANSWER} />
          {helpLine}
        </>
      );
      break;
    case 'MULTIPLE_CHOICE':
      body = (
        <Group legend={label} help={help}>
          {choices.length
            ? choices.map((o, i) => (
                <Radio key={`${o}-${i}`} name={`preview-${q.key}`} label={o} disabled />
              ))
            : noChoices}
        </Group>
      );
      break;
    case 'CHECKBOXES':
      body = (
        <Group legend={label} help={help}>
          {choices.length
            ? choices.map((o, i) => <Checkbox key={`${o}-${i}`} label={o} disabled />)
            : noChoices}
        </Group>
      );
      break;
    case 'DROPDOWN':
      body = (
        <>
          <Select
            {...field}
            defaultValue=""
            options={[
              { value: '', label: choices.length ? 'Choose…' : 'No choices yet' },
              ...choices.map((o, i) => ({ value: String(i + 1), label: o })),
            ]}
          />
          {helpLine}
        </>
      );
      break;
    case 'YES_NO':
      body = (
        <Group legend={label} help={help}>
          <div className="flex flex-wrap gap-x-6">
            <Radio name={`preview-${q.key}`} label="Yes" disabled />
            <Radio name={`preview-${q.key}`} label="No" disabled />
          </div>
        </Group>
      );
      break;
    case 'FILE_UPLOAD':
      body = settings.allowFileUploads ? (
        <Group legend={label} help={help}>
          <FileDropzone label={label} icon={CloudArrowUp} onFiles={ignore} disabled />
        </Group>
      ) : (
        <p data-testid="upload-off" className={`${QUIET} ${TEXT}`}>
          {`${q.label.trim() || 'File upload'}: the client does not see this question while Allow file uploads is off in Form Settings.`}
        </p>
      );
      break;
    case 'SIGNATURE':
      body = (
        <Group legend={label} help={help}>
          <SignatureBox />
        </Group>
      );
      break;
    case 'CURRENCY':
      body = (
        <>
          <div className="relative">
            <Input {...field} inputMode="decimal" placeholder="0.00" className="pl-7" />
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-3 flex h-11 items-center text-base text-muted"
            >
              $
            </span>
          </div>
          {helpLine}
        </>
      );
      break;
    default:
      body = (
        <>
          <Input {...field} {...(INPUTS[q.type] ?? SHORT)} />
          {helpLine}
        </>
      );
  }

  return (
    <div data-testid="preview-question" className="flex min-w-0 flex-col gap-1">
      {q.showIf ? (
        <p className="flex items-start gap-1 text-xs font-medium text-purple">
          <TreeStructure aria-hidden weight="fill" className="size-4 shrink-0" />
          <span className="wrap-anywhere">{shownWhen(q.showIf, byKey)}</span>
        </p>
      ) : null}
      {body}
    </div>
  );
}

const CARD =
  'flex min-w-0 flex-col gap-4 rounded-lg border border-divider bg-surface p-4 shadow-sm';

/**
 * The Preview tab (guide Frame 1): the unsaved draft as the client sees it, with its
 * client-visible description (never the internal notes), the progress bar, each section and
 * question in order with required ones marked *, conditional questions labelled, uploads and the
 * signature when Form Settings turn them on, and an inert Submit with the success message.
 * Nothing is sent or recorded from here.
 */
export function FormPreview({ state }: { state: BuilderState }) {
  const { draft } = state;
  const { settings, sections } = draft;
  const all = sections.flatMap((s) => s.questions);
  const byKey = new Map(all.map((q) => [q.key, q]));
  const signLast = settings.requireSignature && !all.some((q) => q.type === 'SIGNATURE');
  const anyRequired = signLast || all.some((q) => isRequired(q, settings));
  const success = settings.successMessage.trim();

  return (
    <section
      aria-label="Form preview"
      data-testid="form-preview"
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-divider bg-canvas p-3"
    >
      <Callout icon={Eye} tone="navy" surface="plain" size="compact">
        This is how your client sees the form. Nothing is sent from the preview.
      </Callout>

      <div className={CARD}>
        <div className="flex flex-col gap-1">
          <h3 className={`font-display text-xl font-bold text-heading ${TEXT}`}>
            {draft.name.trim() || 'Untitled form'}
          </h3>
          {draft.description.trim() ? (
            <p className={`text-sm text-text ${TEXT}`}>{draft.description}</p>
          ) : null}
        </div>
        {settings.showProgressBar ? (
          <div className="flex flex-col gap-1">
            <p className="flex justify-between gap-2 text-xs text-muted">
              <span>Progress</span>
              <span>0% complete</span>
            </p>
            <div
              role="progressbar"
              aria-label="Form progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              className="h-2 overflow-hidden rounded-pill bg-disabled"
            >
              <div className="h-full w-0 rounded-pill bg-action" />
            </div>
          </div>
        ) : null}
        {anyRequired ? (
          <p className="text-xs text-muted">Questions marked * are required.</p>
        ) : null}
      </div>

      {sections.length ? (
        <>
          {sections.map((s) => (
            <section key={s.key} data-testid="preview-section" className={CARD}>
              <div className="flex flex-col gap-1">
                <h4 className={`text-lg font-bold text-heading ${TEXT}`}>
                  {s.title.trim() || 'Untitled section'}
                </h4>
                {s.description.trim() ? (
                  <p className={`text-sm text-muted ${TEXT}`}>{s.description}</p>
                ) : null}
              </div>
              {s.questions.length ? (
                s.questions.map((q) => (
                  <PreviewQuestion key={q.key} q={q} settings={settings} byKey={byKey} />
                ))
              ) : (
                <p className="text-sm text-muted">No questions in this section yet.</p>
              )}
            </section>
          ))}

          {signLast ? (
            <section data-testid="preview-signature" className={CARD}>
              <h4 className="text-lg font-bold text-heading">Signature</h4>
              <Group legend="Sign to submit *" help="">
                <SignatureBox />
              </Group>
            </section>
          ) : null}

          <div className={CARD}>
            <Button type="button" aria-disabled="true" className="cursor-not-allowed self-start">
              <PaperPlaneRight aria-hidden weight="fill" className="size-5" />
              Submit
            </Button>
            <p className="text-sm text-muted">
              {success ? (
                <>
                  After submitting, the client sees:{' '}
                  <span className={`text-text ${TEXT}`}>{success}</span>
                </>
              ) : (
                "After submitting, the client sees your firm's default thank-you message."
              )}
            </p>
          </div>
        </>
      ) : (
        <p className={QUIET}>
          No sections yet. Add one in the Form Builder tab and it shows here as your client sees it.
        </p>
      )}
    </section>
  );
}
