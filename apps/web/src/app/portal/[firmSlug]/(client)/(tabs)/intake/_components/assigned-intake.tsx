'use client';

import {
  ApiRequestError,
  type ConfirmUploadRequest,
  type CreateIntakeUploadRequest,
  fillIntakeText,
  type IntakeAgreementBlock,
  INTAKE_ERRORS,
  type IntakeSignatureInput,
  type IntakeStep,
  type IntakeUpload,
  type MyIntake,
  type SaveIntakeStepRequest,
  shownIntakeKeys,
  type SubmitIntakeRequest,
  UPLOAD_LIMITS,
  type UploadTicket,
} from '@firmivra/types';
import { Button, Card, Checkbox } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CircleCheck, Info, Save } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { uploadFile } from '../../../../../../../lib/upload';
import { IntakeStepper } from '../../../../(public)/begin/_blocks/form-blocks';
import {
  AgreementPanel,
  type AgreementState,
  agreementSignature,
  emptyAgreement,
} from '../../../../(public)/begin/_blocks/intake-agreement';
import type { Fill } from '../../../../(public)/begin/_blocks/intake-fields';
import { IntakeReview, UploadedFiles } from '../../../../(public)/begin/_blocks/intake-review';
import { StepSections } from '../../../../(public)/begin/_blocks/intake-step';
import {
  allAnswers,
  checkFirmFileSize,
  clearHidden,
  issueKey,
  saveIssues,
  screenValues,
  type ScreenValue,
  type ScreenValues,
  stepAnswers,
  stepIssues,
} from '../../../../(public)/begin/_blocks/intake-values';
import { formLook } from '../../../../(public)/begin/_blocks/looks';
import { usePortal } from '../../../../layout';

/** The portal's query for one assigned intake. */
export const assignedKey = (slug: string, id: string) => ['portal', slug, 'intakes', id] as const;

/** What the form needs of an intake: the portal's MyIntake or a lead link's LinkIntake. */
export type FlowIntake = Pick<
  MyIntake,
  | 'id'
  | 'form'
  | 'version'
  | 'dueOn'
  | 'definition'
  | 'taxYear'
  | 'answers'
  | 'uploads'
  | 'maxFileSizeMb'
  | 'savedSteps'
  | 'signature'
  | 'canEdit'
> & {
  correction: { note: string } | null;
  /** The form's status where the source has one (a signed-in client's form). */
  status?: MyIntake['status'];
  /** Review Two row 21: the firm's consent checkbox on the review step. */
  consentRequired?: boolean;
  /** Review Two row 21: the firm's message and redirect once it is sent. */
  completion?: MyIntake['completion'];
  /** Intake Review 2 23-h: the form's Show progress bar (the stepper); shown unless it is off. */
  showProgressBar?: boolean;
};

/**
 * Where the form reads and writes: the signed-in client's intake (`api.myIntakes`) or a lead's
 * secure link (`api.intakeLink`).
 */
export interface IntakeSource {
  /** The form's query (set again after a submit). */
  key: readonly unknown[];
  get: () => Promise<FlowIntake>;
  saveStep: (step: string, body: SaveIntakeStepRequest) => Promise<unknown>;
  submit: (body: SubmitIntakeRequest) => Promise<FlowIntake>;
  agreementsKey: readonly unknown[];
  agreements: () => Promise<IntakeAgreementBlock>;
  createUpload: (body: CreateIntakeUploadRequest) => Promise<UploadTicket>;
  confirmUpload: (body: ConfirmUploadRequest) => Promise<IntakeUpload>;
  removeUpload: (uploadId: string) => Promise<unknown>;
  /** Anything else a submit changes (the portal's list). */
  onSubmitted?: () => void;
  /** The way back, above the form. */
  back?: ReactNode;
  /** What Save and Continue Later says once saved. */
  laterNotice: string;
}

function mySource(
  slug: string,
  id: string,
  refresh: (key: readonly unknown[]) => void,
): IntakeSource {
  const client = api.myIntakes(slug);
  return {
    key: assignedKey(slug, id),
    get: () => client.get(id),
    saveStep: (step, body) => client.saveStep(id, step, body),
    submit: (body) => client.submit(id, body),
    agreementsKey: ['portal', slug, 'intakes', id, 'agreements'],
    agreements: () => api.myIntakeAgreements(slug).block(id),
    createUpload: (body) => client.createUpload(id, body),
    confirmUpload: (body) => client.confirmUpload(id, body),
    removeUpload: (uploadId) => client.removeUpload(id, uploadId),
    // The list counts again, and linked appointments refresh.
    onSubmitted: () => {
      refresh(['portal', slug, 'intakes']);
      refresh(['my-appointments', slug]);
      refresh(['appointments']);
    },
    back: <BackToList slug={slug} />,
    laterNotice: 'Your answers are saved. Come back to Intake Forms any time to finish and submit.',
  };
}

/**
 * One intake form the firm sent this client (Intake Forms Review Two, INTAKE-ACCESS-01): the exact
 * version assigned, opened from its email, its portal notice or the Intake Forms list. The client
 * fills it step by step (each step saves as it is left), adds the files it asks for, reviews,
 * signs the firm's agreement and submits. The same form blocks as Begin Online draw it. A
 * submitted form, or one this login may only read, shows the answers without editing.
 */
export function AssignedIntake({ slug, id }: { slug: string; id: string }) {
  const queryClient = useQueryClient();
  const source = useMemo(
    () => mySource(slug, id, (key) => void queryClient.invalidateQueries({ queryKey: [...key] })),
    [slug, id, queryClient],
  );
  const intake = useApiQuery(source.key, source.get);
  return (
    <div data-theme="begin-online" data-testid="assigned-intake" className="min-w-0">
      <PageState query={intake} isEmpty={() => false}>
        {(found) => <IntakeForm slug={slug} intake={found} source={source} />}
      </PageState>
    </div>
  );
}

/** The form to fill while it is open, else its answers to read. */
export function IntakeForm({
  slug,
  intake,
  source,
}: {
  slug: string;
  intake: FlowIntake;
  source: IntakeSource;
}) {
  return intake.canEdit ? (
    <IntakeFlow
      key={`${intake.id}:${intake.version}`}
      slug={slug}
      intake={intake}
      source={source}
    />
  ) : (
    <ReadOnlyIntake intake={intake} back={source.back} slug={slug} />
  );
}

function useFill(taxYear: number): Fill {
  const { business } = usePortal();
  return (text: string) => fillIntakeText(text, { taxYear, firmName: business.name });
}

function BackToList({ slug }: { slug: string }) {
  return (
    <Link href={`/${slug}/intake`} className="inline-flex items-center gap-2 text-link underline">
      <ArrowLeft aria-hidden className="size-4" /> All intake forms
    </Link>
  );
}

/** Review Two row 21: how long the firm's message shows before its redirect page opens. */
const REDIRECT_MS = 3000;

const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

/** A submitted form, or one this login may only read: its answers and files, no editing. */
function ReadOnlyIntake({
  intake,
  back,
  slug,
}: {
  intake: FlowIntake;
  back?: ReactNode;
  slug: string;
}) {
  const fill = useFill(intake.taxYear);
  const { definition } = intake;
  const values = useMemo(() => screenValues(definition, intake.answers), [definition, intake]);
  const answers = useMemo(() => allAnswers(definition, values), [definition, values]);
  const shown = useMemo(() => shownIntakeKeys(definition, answers), [definition, answers]);
  return (
    <Card className="grid min-w-0 gap-4">
      {back}
      <h1 className="font-display text-3xl font-bold text-heading">{fill(definition.title)}</h1>
      <p
        role="status"
        className="flex gap-2 rounded-card bg-folder-surface p-3 text-sm text-text"
        data-testid="intake-read-only"
      >
        <Info aria-hidden className="size-5 shrink-0 text-firm-text" />
        {intake.signature ? (
          <span data-testid="intake-completion">
            {/* Review Two row 21: the firm's own message (the form's, else Intake Form Settings'). */}
            {intake.completion?.message ? (
              <span className="block font-semibold">{intake.completion.message}</span>
            ) : null}
            {`Submitted and signed by ${intake.signature.printedName} on ${day(intake.signature.signedAt)}. Your firm has it; they will tell you if anything needs changing.`}
            {/* Intake Review 2 23-g: the form's Submission ID, when the firm numbers its forms. */}
            {intake.completion?.submissionId ? (
              <span className="block font-semibold" data-testid="submission-id">
                Submission ID {intake.completion.submissionId}
              </span>
            ) : null}
          </span>
        ) : intake.status === 'EXPIRED' || intake.status === 'ARCHIVED' ? (
          // INTAKE-ACCESS-01: an expired or closed form says so, and what to do next.
          <span>
            {intake.status === 'EXPIRED'
              ? 'This form has expired, so it can no longer be filled in.'
              : 'Your firm has closed this form, so it can no longer be filled in.'}{' '}
            If you still need to send it,{' '}
            <Link href={`/${slug}/messages`} className="text-link underline">
              message your firm
            </Link>{' '}
            and ask them to send it again.
          </span>
        ) : (
          'You can read this form, but only the person it was sent to can fill it in.'
        )}
      </p>
      <IntakeReview
        definition={definition}
        values={values}
        shownSteps={shown.steps}
        shownFields={shown.fields}
        uploads={intake.uploads}
        fill={fill}
        onEdit={() => undefined}
        look={formLook(intake.form)}
      />
    </Card>
  );
}

function IntakeFlow({
  slug,
  intake,
  source,
}: {
  slug: string;
  intake: FlowIntake;
  source: IntakeSource;
}) {
  const { definition } = intake;
  const queryClient = useQueryClient();
  const fill = useFill(intake.taxYear);
  const { business } = usePortal();
  const look = formLook(intake.form);
  const [values, setValues] = useState<ScreenValues>(() =>
    screenValues(definition, intake.answers),
  );
  const [uploads, setUploads] = useState<IntakeUpload[]>(intake.uploads);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [agreement, setAgreement] = useState<AgreementState>(emptyAgreement);
  const [agreementError, setAgreementError] = useState('');
  const topRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const answers = useMemo(() => allAnswers(definition, values), [definition, values]);
  const shown = useMemo(() => shownIntakeKeys(definition, answers), [definition, answers]);
  const steps = definition.steps.filter((s) => shown.steps.has(s.key));
  // Resume at the first step not saved yet (the last one when every step is).
  const [stepKey, setStepKey] = useState(() => {
    const open = steps.find((s) => !intake.savedSteps.includes(s.key));
    return (open ?? steps.at(-1))?.key ?? '';
  });
  const index = Math.max(
    0,
    steps.findIndex((s) => s.key === stepKey),
  );
  const step = steps[index]!;

  // A file being checked turns READY or BLOCKED in a few seconds: ask again until none is.
  const checking = uploads.some((u) => u.status === 'CHECKING');
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => {
      source.get().then(
        (fresh) =>
          setUploads((list) => {
            const byId = new Map(fresh.uploads.map((u) => [u.id, u]));
            return list.map((u) => byId.get(u.id) ?? u);
          }),
        () => setUploads((list) => [...list]),
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, [checking, source, uploads]);

  const save = useApiMutation((key: string) => {
    const s = definition.steps.find((x) => x.key === key)!;
    return source.saveStep(key, { answers: stepAnswers(s, values, shown.fields) });
  });
  // The firm's current agreements for this form's service, signed on the review step.
  const agreements = useApiQuery(source.agreementsKey, source.agreements);
  // Review Two row 21: the firm's consent checkbox, when Intake Form Settings asks for one.
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  const submit = useApiMutation((signature: IntakeSignatureInput) =>
    source.submit({
      answers: stepAnswers(step, values, shown.fields),
      signature,
      ...(intake.consentRequired ? { consent: true as const } : {}),
    }),
  );

  const onChange = (key: string, value: ScreenValue) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((all) => {
      const left = Object.entries(all).filter(([k]) => k !== key && !k.startsWith(`${key}.`));
      return left.length === Object.keys(all).length ? all : Object.fromEntries(left);
    });
  };

  function showIssues(list: ReturnType<typeof stepIssues>) {
    const map: Record<string, string> = {};
    for (const issue of list) map[issueKey(issue.path)] ??= issue.message;
    setErrors(map);
    requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (first ?? summaryRef.current)?.focus();
    });
  }

  /** Saves the step on screen; false (with the problems shown) when it can't be saved. */
  async function saveStep(): Promise<boolean> {
    const issues = saveIssues(definition, step, values, shown.fields);
    if (issues.length) {
      showIssues(issues);
      return false;
    }
    try {
      await save.mutateAsync(step.key);
      setValues((v) => clearHidden(definition, step, v));
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'VALIDATION_FAILED') {
        const found = stepIssues(definition, step, values, uploads);
        if (found.length) showIssues(found);
      }
      return false;
    }
  }

  function go(key: string) {
    setStepKey(key);
    setErrors({});
    setNotice('');
    requestAnimationFrame(() => {
      topRef.current?.focus();
      topRef.current?.scrollIntoView({ block: 'start' });
    });
  }

  async function jump(key: string) {
    if (key === step.key) return;
    if (await saveStep()) go(key);
  }

  async function next() {
    const issues = stepIssues(definition, step, values, uploads);
    if (issues.length) return showIssues(issues);
    if (!(await saveStep())) return;
    const following = steps[index + 1];
    if (following) go(following.key);
  }

  async function back() {
    const previous = steps[index - 1];
    if (previous && (await saveStep())) go(previous.key);
  }

  async function later() {
    if (await saveStep()) setNotice(source.laterNotice);
  }

  async function send() {
    for (const s of steps) {
      const issues = stepIssues(definition, s, values, uploads);
      if (issues.length) {
        if (s.key !== step.key) go(s.key);
        requestAnimationFrame(() => showIssues(issues));
        return;
      }
    }
    let signed: { signature: IntakeSignatureInput } | { error: string };
    if (agreements.data) {
      signed = agreementSignature(agreements.data, agreement);
    } else if (agreements.isError || agreements.data === null) {
      signed = {
        signature: {
          agreements: [],
          acknowledgments: [],
          acceptLegal: null,
          signer: {
            printedName: agreement.printedName,
            method: 'TYPED',
            typedSignature: agreement.typedSignature,
          },
          title: agreement.title.trim() || null,
        },
      };
    } else {
      setAgreementError("The agreement couldn't be loaded. Please try again.");
      void agreements.refetch();
      return;
    }
    if ('error' in signed) {
      setAgreementError(signed.error);
      return;
    }
    setAgreementError('');
    if (intake.consentRequired && !consent) {
      setConsentError(INTAKE_ERRORS.CONSENT_REQUIRED);
      return;
    }
    try {
      const done = await submit.mutateAsync(signed.signature);
      // The form as it now is (submitted, read only), with the firm's message (row 21).
      queryClient.setQueryData(source.key, done);
      source.onSubmitted?.();
      // Then the firm's page, when Redirect after completion is on (an https address).
      const to = done.completion?.redirectUrl;
      if (to?.startsWith('https://')) setTimeout(() => window.location.assign(to), REDIRECT_MS);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'AGREEMENT_OUTDATED') {
        setAgreement((a) => ({ ...a, ticked: [] }));
        void agreements.refetch();
      }
    }
  }

  const failure = save.error ?? submit.error;
  const failureText = failure ? errorMessage(failure, INTAKE_ERRORS) : '';
  const previous = steps[index - 1];
  const infoOnly = (sec: IntakeStep['sections'][number]) =>
    sec.fields.every((f) => f.type === 'info');
  const intro = { ...step, sections: step.review ? step.sections.filter(infoOnly) : [] };
  const rest = {
    ...step,
    sections: step.review ? step.sections.filter((sec) => !infoOnly(sec)) : step.sections,
  };
  const sectionProps = {
    values,
    shown: shown.fields,
    onChange,
    errors,
    fill,
    actions: {
      uploads,
      maxFileSizeMb: intake.maxFileSizeMb,
      upload: async (slot: string, file: File) => {
        checkFirmFileSize(file, intake.maxFileSizeMb);
        const saved = await uploadFile(file, {
          start: (facts) => source.createUpload({ slot, ...facts }),
          finish: (uploadToken) => source.confirmUpload({ uploadToken }),
          maxBytes: UPLOAD_LIMITS.maxBytes,
        });
        setUploads((list) => [...list, saved]);
      },
      remove: async (uploadId: string) => {
        await source.removeUpload(uploadId);
        setUploads((list) => list.filter((u) => u.id !== uploadId));
      },
    },
  };

  return (
    <div ref={topRef} tabIndex={-1} className="grid min-w-0 gap-3 outline-none">
      {source.back}
      <header className="grid gap-1">
        <h1 className="font-display text-3xl font-bold text-heading">{fill(definition.title)}</h1>
        {definition.subtitle ? <p className="text-text">{fill(definition.subtitle)}</p> : null}
        {intake.dueOn ? (
          <p className="text-sm text-muted">Please complete it by {day(intake.dueOn)}.</p>
        ) : null}
      </header>
      {intake.correction ? (
        <p
          role="status"
          className="rounded-control border border-warning bg-warning-soft p-3 text-sm text-heading"
        >
          Your firm asked for changes: {intake.correction.note}
        </p>
      ) : null}
      {intake.showProgressBar === false ? null : (
        <IntakeStepper
          steps={definition.steps.map((s, i) => ({
            id: i + 1,
            label: fill(s.title),
            skipped: !shown.steps.has(s.key),
          }))}
          current={definition.steps.findIndex((s) => s.key === step.key) + 1}
          onEdit={(n) => {
            const target = definition.steps[n - 1];
            if (target && shown.steps.has(target.key)) void jump(target.key);
          }}
        />
      )}
      {!definition || !definition.steps?.length ? (
        <p role="alert" className="rounded-control border border-danger bg-danger-soft p-3 text-sm">
          This form can&apos;t be submitted online yet. Your answers are saved: please message your
          firm.
        </p>
      ) : null}
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void (step.review ? send() : next());
        }}
      >
        {Object.keys(errors).length > 0 ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="mb-3 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger"
          >
            Please complete the highlighted fields before continuing.
          </div>
        ) : null}
        {step.review && intro.sections.length > 0 ? (
          <div className="mb-3">
            <StepSections {...sectionProps} step={intro} look={look} />
          </div>
        ) : null}
        {step.review ? (
          <div className="grid gap-3">
            <IntakeReview
              definition={definition}
              values={values}
              shownSteps={shown.steps}
              shownFields={shown.fields}
              uploads={uploads}
              fill={fill}
              onEdit={(key) => void jump(key)}
              look={look}
            />
            <UploadedFiles
              definition={definition}
              uploads={uploads}
              fill={fill}
              onEdit={(key) => void jump(key)}
            />
          </div>
        ) : null}
        <div className={step.review ? 'mt-3' : ''}>
          <StepSections {...sectionProps} step={rest} look={look} />
        </div>
        {step.review ? (
          <div className="mt-3">
            <AgreementPanel
              firmSlug={slug}
              block={agreements.data}
              failed={agreements.isError}
              onRetry={() => void agreements.refetch()}
              form={intake.form}
              value={agreement}
              onChange={setAgreement}
              error={agreementError}
              title={look.agreementTitle}
            />
            {intake.consentRequired ? (
              <div className="mt-3 grid gap-1" data-testid="intake-consent">
                <Checkbox
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    setConsentError('');
                  }}
                  label={`I confirm the information and files I've provided are accurate and complete, and I agree to ${business.name} using them to provide the requested services.`}
                />
                {consentError ? (
                  <p role="alert" className="text-sm text-danger">
                    {consentError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mt-3 flex gap-2 rounded-control border border-folder-border bg-folder-surface p-3 text-sm text-heading"
          >
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            {notice}
          </p>
        ) : null}
        {failureText ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {failureText}
          </p>
        ) : null}
        <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {previous ? (
              <Button
                variant="outline"
                data-testid="intake-back"
                onClick={() => void back()}
                disabled={save.isPending}
                className="min-w-32"
              >
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void later()}
              disabled={save.isPending}
              className="min-w-32"
            >
              <Save aria-hidden className="size-4" />
              Save and Continue Later
            </Button>
          </div>
          <Button
            type="submit"
            data-testid="intake-next"
            disabled={save.isPending || submit.isPending}
            className="min-w-40"
          >
            {step.review ? 'Submit Intake Form' : 'Continue'}
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        </footer>
      </form>
    </div>
  );
}
