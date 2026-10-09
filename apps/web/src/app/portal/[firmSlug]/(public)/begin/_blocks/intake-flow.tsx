'use client';

import {
  ApiRequestError,
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_SERVICES,
  type BeginDraft,
  type BeginOnlineForm,
  fillIntakeText,
  type IntakeFormKey,
  type IntakeSignatureInput,
  type IntakeStep,
  type IntakeUpload,
  shownIntakeKeys,
  StartBeginDraftRequest,
} from '@firmivra/types';
import { Button, Input, PageContainer } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, LockKeyhole, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { uploadFile } from '../../../../../../lib/upload';
import { usePortal } from '../../../layout';
import { IntakeStepper, SectionPanel } from './form-blocks';
import {
  AgreementPanel,
  type AgreementState,
  agreementSignature,
  emptyAgreement,
} from './intake-agreement';
import type { Fill } from './intake-fields';
import { IntakeReview } from './intake-review';
import { StepSections } from './intake-step';
import {
  allAnswers,
  clearHidden,
  issueKey,
  screenValues,
  type ScreenValue,
  type ScreenValues,
  saveIssues,
  stepAnswers,
  stepIssues,
} from './intake-values';

export const draftKey = (slug: string, form: IntakeFormKey) => [
  'begin-online',
  slug,
  form,
  'draft',
];

/** The service's form as its mockups head it: the title with its last two words in orange. */
function FormHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  const words = title.split(' ');
  const tail = words.length > 2 ? words.splice(-2).join(' ') : '';
  return (
    <header className="mb-3 text-center">
      <h1 className="font-display text-3xl leading-tight font-bold text-heading sm:text-4xl">
        {words.join(' ')} {tail && <span className="text-accent">{tail}</span>}
      </h1>
      {subtitle && <p className="mx-auto mt-1 max-w-2xl text-xs">{subtitle}</p>}
      <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 rounded-control bg-folder-surface px-3 py-1 text-xs">
        <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
        <p>
          This is a <strong>secure and encrypted form.</strong> Your information is protected using
          industry-standard encryption.
        </p>
      </div>
      {children}
    </header>
  );
}

/**
 * A Begin Online service page (/{firm}/begin/{service}): the form from its definition. Without a
 * draft in this browser it opens with "Let's get started" (name and email start the draft); then
 * the steps, saved as the person moves between them, the review with Edit links, the agreement
 * and the submit, which opens the success page.
 */
export function IntakePage({ firmSlug, form }: { firmSlug: string; form: IntakeFormKey }) {
  const client = api.beginOnline(firmSlug);
  const draft = useApiQuery(draftKey(firmSlug, form), async (): Promise<DraftState> => {
    try {
      return await client.get(form);
    } catch (e) {
      // No draft in this browser, or the one it has was sent or has expired: start a new one.
      if (e instanceof ApiRequestError) {
        if (e.status === 404 && e.code === 'NOT_FOUND') return null;
        if (e.code === 'DRAFT_SUBMITTED') return 'SUBMITTED';
        if (e.code === 'DRAFT_EXPIRED') return 'EXPIRED';
      }
      throw e;
    }
  });
  return (
    <div
      data-theme="begin-online"
      data-testid="intake-page"
      className="bg-surface py-4 text-xs text-firm-primary"
    >
      <PageContainer>
        <PageState query={draft} isEmpty={() => false}>
          {(found) =>
            found && typeof found === 'object' ? (
              <IntakeFlow key={found.form} firmSlug={firmSlug} draft={found} />
            ) : (
              <StartCard firmSlug={firmSlug} form={form} ended={found} />
            )
          }
        </PageState>
      </PageContainer>
    </div>
  );
}

/** Each form's buttons, as its mockups word them. */
const WORDING: Record<
  IntakeFormKey,
  {
    back: (title: string, step: number) => string;
    next: string;
    later: string;
    laterAsLink?: boolean;
    submit: string;
  }
> = {
  ANNUAL_TAX: {
    back: () => 'Back',
    next: 'Continue to Next Step',
    later: 'Save and Continue Later',
    submit: 'Submit Intake Form',
  },
  QUARTERLY_TAX: {
    back: () => 'Back',
    next: 'Continue to Next Step',
    later: 'Save and Continue Later',
    submit: 'Submit Intake Form',
  },
  BOOKKEEPING: {
    back: (title) => `Back to ${title}`,
    next: 'Continue to Next Step',
    later: 'Save & Exit',
    submit: 'Submit Intake Form',
  },
  PAYROLL: {
    back: (_, step) => `Back to Step ${step}`,
    next: 'Continue to Next Step',
    later: 'Exit Form',
    submit: 'Submit Form',
  },
  TAX_PLANNING: {
    back: () => 'Previous',
    next: 'Next Step',
    later: 'Save and Continue Later',
    laterAsLink: true,
    submit: 'Submit Intake Form',
  },
  BUSINESS_DEVELOPMENT: {
    back: () => 'Previous',
    next: 'Next Step',
    later: 'Save and Continue Later',
    laterAsLink: true,
    submit: 'Submit Intake Form',
  },
};

/** The firm's current agreements for this form (R14): signed on the review step. */
function useAgreements(firmSlug: string, form: IntakeFormKey) {
  return useApiQuery(['begin-online', firmSlug, form, 'agreements'], () =>
    api.publicAgreements(firmSlug).block({ form }),
  );
}

/** Shown before any step when the firm has no published agreement (submit would refuse). */
function UnavailableNote() {
  return (
    <p
      role="alert"
      className="mx-auto mb-3 max-w-2xl rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger"
    >
      This form isn&apos;t available to submit online yet. Please contact the firm.
    </p>
  );
}

/** The draft this browser has for the form, or why it has none to continue. */
type DraftState = BeginDraft | 'SUBMITTED' | 'EXPIRED' | null;

const ENDED_NOTICE = {
  SUBMITTED:
    'Your earlier form for this service was sent. Thank you! You can start a new one below.',
  EXPIRED: 'Your saved form expired and its answers were removed. Please start again below.',
} as const;

function useFill(taxYear: number): Fill {
  const { business } = usePortal();
  return (text: string) => fillIntakeText(text, { taxYear, firmName: business.name });
}

function StartCard({
  firmSlug,
  form,
  ended,
}: {
  firmSlug: string;
  form: IntakeFormKey;
  ended: 'SUBMITTED' | 'EXPIRED' | null;
}) {
  const client = api.beginOnline(firmSlug);
  const queryClient = useQueryClient();
  const definition = useApiQuery(['begin-online', firmSlug, form, 'form'], () => client.form(form));
  const agreements = useAgreements(firmSlug, form);
  const notice = ended && (
    <p
      role="status"
      className="mx-auto mb-3 max-w-2xl rounded-control border border-folder-border bg-folder-surface p-3 text-sm text-heading"
    >
      {ENDED_NOTICE[ended]}
    </p>
  );
  return (
    <PageState query={definition} isEmpty={() => false}>
      {(found) => (
        <StartForm
          notice={notice}
          unavailable={agreements.data?.ready === false}
          found={found}
          onStart={async (body) => {
            const started = await client.start(form, body);
            queryClient.setQueryData(draftKey(firmSlug, form), started);
          }}
        />
      )}
    </PageState>
  );
}

function StartForm({
  found,
  notice,
  unavailable,
  onStart,
}: {
  found: BeginOnlineForm;
  notice: ReactNode;
  unavailable: boolean;
  onStart: (body: StartBeginDraftRequest) => Promise<void>;
}) {
  const fill = useFill(found.taxYear);
  const [values, setValues] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const start = useApiMutation(onStart);
  const steps = found.definition.steps.map((s, i) => ({ id: i + 1, label: fill(s.title) }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = StartBeginDraftRequest.safeParse({ ...values, phone: values.phone || null });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    start.mutate(parsed.data);
  }
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues({ ...values, [key]: event.target.value });
  return (
    <>
      <FormHeader
        title={fill(found.definition.title)}
        subtitle={found.definition.subtitle ? fill(found.definition.subtitle) : undefined}
      />
      <IntakeStepper steps={steps} current={0} onEdit={() => undefined} />
      {notice}
      {unavailable && <UnavailableNote />}
      <form noValidate onSubmit={submit} className="mx-auto max-w-2xl">
        <SectionPanel
          number={1}
          title="Let's get started"
          subtitle="Your name and email start your secure form. We'll use them to send you a link to continue later and a confirmation when you submit."
        >
          <div className="grid gap-2 sm:grid-cols-2 [&_label]:text-xs">
            <Input
              label="First Name *"
              autoComplete="given-name"
              value={values.firstName}
              onChange={set('firstName')}
              error={errors['firstName']}
            />
            <Input
              label="Last Name *"
              autoComplete="family-name"
              value={values.lastName}
              onChange={set('lastName')}
              error={errors['lastName']}
            />
            <Input
              label="Email Address *"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={values.email}
              onChange={set('email')}
              error={errors['email']}
            />
            <Input
              label="Phone Number"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              onChange={set('phone')}
              error={errors['phone']}
            />
          </div>
          {start.error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errorMessage(start.error, BEGIN_ONLINE_ERRORS)}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={start.isPending} className="min-w-40">
              Start My Form
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </SectionPanel>
      </form>
    </>
  );
}

function IntakeFlow({ firmSlug, draft }: { firmSlug: string; draft: BeginDraft }) {
  const { definition, form } = draft;
  const client = useMemo(() => api.beginOnline(firmSlug), [firmSlug]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const fill = useFill(draft.taxYear);
  const [values, setValues] = useState<ScreenValues>(() => screenValues(definition, draft.answers));
  const [uploads, setUploads] = useState<IntakeUpload[]>(draft.uploads);
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
  const [stepKey, setStepKey] = useState(() => {
    const open = steps.find((s) => !draft.savedSteps.includes(s.key));
    return (open ?? steps.at(-1))?.key ?? '';
  });

  // The cached draft is only what the page opened with: once the person leaves, drop it, so a
  // return within the cache's lifetime loads the saved answers instead of overwriting them.
  useEffect(() => {
    const key = draftKey(firmSlug, form);
    return () => {
      // After this render's unmounts: only when nothing shows the draft any more (React's
      // development double mount keeps the page's own observer, so the draft stays).
      queueMicrotask(() => {
        const query = queryClient.getQueryCache().find({ queryKey: key, exact: true });
        if (query && query.getObserversCount() === 0) {
          queryClient.removeQueries({ queryKey: key, exact: true });
        }
      });
    };
  }, [queryClient, firmSlug, form]);
  const index = Math.max(
    0,
    steps.findIndex((s) => s.key === stepKey),
  );
  const step = steps[index]!;

  // A file being checked turns READY or BLOCKED in a few seconds: ask again until none is. Each
  // answer changes `uploads`, which arms the next ask while a file is still being checked.
  const checking = uploads.some((u) => u.status === 'CHECKING');
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => {
      // Only the files on screen are updated: one added or removed meanwhile stays as it is.
      client.uploads(form).then(
        (fresh) =>
          setUploads((list) => {
            const byId = new Map(fresh.map((u) => [u.id, u]));
            return list.map((u) => byId.get(u.id) ?? u);
          }),
        // A failed ask tries again on the next timer.
        () => setUploads((list) => [...list]),
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, [checking, client, form, uploads]);

  const save = useApiMutation((key: string) => {
    const s = definition.steps.find((x) => x.key === key)!;
    return client.saveStep(form, key, { answers: stepAnswers(s, values, shown.fields) });
  });
  // The firm's current agreements for this form (R14), signed on the review step.
  const agreements = useAgreements(firmSlug, form);
  const submit = useApiMutation((signature: IntakeSignatureInput) =>
    client.submit(form, { answers: stepAnswers(step, values, shown.fields), signature }),
  );
  const resumeLink = useApiMutation(() => client.emailResumeLink({ email: draft.contact.email }));

  const onChange = (key: string, value: ScreenValue) => {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear the field's messages, its cells' and rows' included.
    setErrors((all) => {
      const left = Object.entries(all).filter(([k]) => k !== key && !k.startsWith(`${key}.`));
      return left.length === Object.keys(all).length ? all : Object.fromEntries(left);
    });
  };

  /** A sent or expired draft: show the start card with its notice. */
  function draftEnded(error: unknown) {
    if (
      error instanceof ApiRequestError &&
      (error.code === 'DRAFT_SUBMITTED' || error.code === 'DRAFT_EXPIRED')
    ) {
      void queryClient.refetchQueries({ queryKey: draftKey(firmSlug, form), exact: true });
    }
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
      // What the save cleared (a hidden field, a row's hidden field) is cleared on screen too.
      setValues((v) => clearHidden(definition, step, v));
      return true;
    } catch (error) {
      draftEnded(error);
      if (error instanceof ApiRequestError && error.code === 'VALIDATION_FAILED') {
        // The API's issues aren't passed on, so mark what the step's own check finds.
        const found = stepIssues(definition, step, values, uploads);
        if (found.length) showIssues(found);
      }
      return false;
    }
  }

  /** Opens another step (the stepper, Edit on the review), saving this one first. */
  async function jump(key: string) {
    if (key === step.key) return;
    if (await saveStep()) go(key);
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

  function showIssues(list: ReturnType<typeof stepIssues>) {
    const map: Record<string, string> = {};
    for (const issue of list) map[issueKey(issue.path)] ??= issue.message;
    setErrors(map);
    // Focus the first field with a problem (its message is tied to it); else the summary.
    requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (first ?? summaryRef.current)?.focus();
    });
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
    if (!previous) return;
    if (await saveStep()) go(previous.key);
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
    if (!agreements.data) {
      setAgreementError("The agreement couldn't be loaded. Please try again.");
      void agreements.refetch();
      return;
    }
    const signed = agreementSignature(agreements.data, agreement);
    if ('error' in signed) {
      setAgreementError(signed.error);
      return;
    }
    setAgreementError('');
    try {
      const done = await submit.mutateAsync(signed.signature);
      router.push(`/${firmSlug}/begin/done?form=${BEGIN_ONLINE_SERVICES[done.form].path}`);
    } catch (error) {
      draftEnded(error);
      // A newer agreement or Terms version: show the current one to read and sign again.
      if (
        error instanceof ApiRequestError &&
        (error.code === 'AGREEMENT_OUTDATED' || error.code === 'TERMS_OUTDATED')
      ) {
        setAgreement((a) => ({ ...a, ticked: [], acceptLegal: false }));
        void agreements.refetch();
      }
      // The message is shown below the buttons.
    }
  }

  async function later() {
    if (!(await saveStep())) return;
    try {
      await resumeLink.mutateAsync();
      setNotice(
        `Your answers are saved. We've sent a link to ${draft.contact.email} so you can continue later.`,
      );
    } catch (error) {
      draftEnded(error);
    }
  }

  const failure = save.error ?? submit.error ?? resumeLink.error;
  const failureText = failure ? errorMessage(failure, BEGIN_ONLINE_ERRORS) : '';
  const previous = steps[index - 1];
  const words = WORDING[form];
  // The review step's info-only panels ("Review Your Information...") come before the answers.
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
      upload: async (slot: string, file: File) => {
        const saved = await uploadFile(file, {
          start: (facts) => client.createUpload(form, { slot, ...facts }),
          finish: (uploadToken) => client.confirmUpload(form, { uploadToken }),
        });
        setUploads((list) => [...list, saved]);
      },
      remove: async (id: string) => {
        await client.removeUpload(form, id);
        setUploads((list) => list.filter((u) => u.id !== id));
      },
    },
  };
  return (
    <div ref={topRef} tabIndex={-1} className="outline-none">
      <FormHeader
        title={fill(definition.title)}
        subtitle={definition.subtitle ? fill(definition.subtitle) : undefined}
      />
      {/* Every step of the form, as the mockups number them; one the answers leave out is marked. */}
      <IntakeStepper
        steps={definition.steps.map((s, i) => ({
          id: i + 1,
          label: fill(s.title),
          skipped: !shown.steps.has(s.key),
        }))}
        current={definition.steps.findIndex((s) => s.key === step.key) + 1}
        onEdit={(id) => {
          const target = definition.steps[id - 1];
          if (target && shown.steps.has(target.key)) void jump(target.key);
        }}
      />
      {step.subtitle && <p className="mb-2 text-center text-xs">{fill(step.subtitle)}</p>}
      {agreements.data?.ready === false && <UnavailableNote />}
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void (step.review ? send() : next());
        }}
      >
        {Object.keys(errors).length > 0 && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="mb-3 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger"
          >
            Please complete the highlighted fields before continuing.
          </div>
        )}
        {step.review && intro.sections.length > 0 && (
          <div className="mb-3">
            <StepSections {...sectionProps} step={intro} />
          </div>
        )}
        {step.review && (
          <IntakeReview
            definition={definition}
            values={values}
            shownSteps={shown.steps}
            shownFields={shown.fields}
            uploads={uploads}
            fill={fill}
            onEdit={(key) => void jump(key)}
          />
        )}
        <div className={step.review ? 'mt-3' : ''}>
          <StepSections {...sectionProps} step={rest} />
        </div>
        {step.review && (
          <AgreementPanel
            firmSlug={firmSlug}
            block={agreements.data}
            failed={agreements.isError}
            onRetry={() => void agreements.refetch()}
            form={form}
            value={agreement}
            onChange={setAgreement}
            error={agreementError}
          />
        )}
        {notice && (
          <p
            role="status"
            className="mt-3 rounded-control border border-folder-border bg-folder-surface p-3 text-sm text-heading"
          >
            {notice}
          </p>
        )}
        {failureText && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {failureText}
          </p>
        )}
        <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {previous && (
              <Button
                variant="outline"
                data-testid="intake-back"
                onClick={() => void back()}
                disabled={save.isPending}
                className="min-w-32"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                {words.back(fill(previous.title), definition.steps.indexOf(previous) + 1)}
              </Button>
            )}
            {words.laterAsLink ? (
              <button
                type="button"
                onClick={() => void later()}
                disabled={save.isPending || resumeLink.isPending}
                className="min-h-11 px-2 text-sm underline"
              >
                {words.later}
              </button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => void later()}
                disabled={save.isPending || resumeLink.isPending}
              >
                <Save aria-hidden="true" className="size-4" />
                {words.later}
              </Button>
            )}
          </div>
          <Button
            type="submit"
            data-testid="intake-next"
            disabled={save.isPending || submit.isPending}
            className="min-w-40"
          >
            {step.review ? words.submit : words.next}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </footer>
      </form>
    </div>
  );
}
