'use client';

import {
  ApiRequestError,
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_SERVICES,
  type BeginDraft,
  type BeginOnlineForm,
  fillIntakeText,
  type IntakeFormKey,
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
  issueKey,
  screenValues,
  type ScreenValue,
  type ScreenValues,
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
  const draft = useApiQuery(draftKey(firmSlug, form), async () => {
    try {
      return await client.get(form);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404 && e.code === 'NOT_FOUND') return null;
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
            found ? (
              <IntakeFlow key={found.form} firmSlug={firmSlug} draft={found} />
            ) : (
              <StartCard firmSlug={firmSlug} form={form} />
            )
          }
        </PageState>
      </PageContainer>
    </div>
  );
}

function useFill(taxYear: number): Fill {
  const { business } = usePortal();
  return (text: string) => fillIntakeText(text, { taxYear, firmName: business.name });
}

function StartCard({ firmSlug, form }: { firmSlug: string; form: IntakeFormKey }) {
  const client = api.beginOnline(firmSlug);
  const queryClient = useQueryClient();
  const definition = useApiQuery(['begin-online', firmSlug, form, 'form'], () => client.form(form));
  return (
    <PageState query={definition} isEmpty={() => false}>
      {(found) => (
        <StartForm
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
  onStart,
}: {
  found: BeginOnlineForm;
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
  const client = api.beginOnline(firmSlug);
  const router = useRouter();
  const fill = useFill(draft.taxYear);
  const [values, setValues] = useState<ScreenValues>(() => screenValues(definition, draft.answers));
  const [uploads, setUploads] = useState<IntakeUpload[]>(draft.uploads);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [agreement, setAgreement] = useState<AgreementState>(emptyAgreement);
  const [agreementError, setAgreementError] = useState('');
  const topRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const answers = useMemo(() => allAnswers(definition, values), [definition, values]);
  const shown = useMemo(() => shownIntakeKeys(definition, answers), [definition, answers]);
  const steps = definition.steps.filter((s) => shown.steps.has(s.key));
  const [stepKey, setStepKey] = useState(() => {
    const open = steps.find((s) => !draft.savedSteps.includes(s.key));
    return (open ?? steps[0])?.key ?? '';
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
      client.uploads(form).then(setUploads, () => undefined);
    }, 3000);
    return () => clearTimeout(timer);
  }, [checking, uploads, client, form]);

  const save = useApiMutation((key: string) => {
    const s = definition.steps.find((x) => x.key === key)!;
    return client.saveStep(form, key, { answers: stepAnswers(s, values) });
  });
  // The firm's current agreements for this form (R14), signed on the review step.
  const agreements = useApiQuery(['begin-online', firmSlug, form, 'agreements'], () =>
    api.publicAgreements(firmSlug).block({ form }),
  );
  // TODO(R15): send `signature` with the answers once contract B's SubmitIntakeRequest has it.
  const submit = useApiMutation(() => client.submit(form, { answers: stepAnswers(step, values) }));
  const resumeLink = useApiMutation(() => client.emailResumeLink({ email: draft.contact.email }));

  const onChange = (key: string, value: ScreenValue) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

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
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function next() {
    const issues = stepIssues(definition, step, values, uploads);
    if (issues.length) return showIssues(issues);
    try {
      await save.mutateAsync(step.key);
    } catch {
      return;
    }
    const following = steps[index + 1];
    if (following) go(following.key);
  }

  async function back() {
    const previous = steps[index - 1];
    if (!previous) return;
    try {
      await save.mutateAsync(step.key);
    } catch {
      return;
    }
    go(previous.key);
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
      const done = await submit.mutateAsync();
      router.push(`/${firmSlug}/begin/done?form=${BEGIN_ONLINE_SERVICES[done.form].path}`);
    } catch (error) {
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
    try {
      await save.mutateAsync(step.key);
      await resumeLink.mutateAsync();
      setNotice(
        `Your answers are saved. We've sent a link to ${draft.contact.email} so you can continue later.`,
      );
    } catch {
      // Shown below the buttons.
    }
  }

  const failure = save.error ?? submit.error ?? resumeLink.error;
  // Until the firm's agreements can be signed online the API answers a submit with 503.
  const failureText =
    failure === submit.error &&
    submit.error instanceof ApiRequestError &&
    submit.error.status === 503 &&
    submit.error.code !== 'ENCRYPTION_UNAVAILABLE'
      ? "Online submission isn't open yet. Your answers are saved: choose Save and Continue Later and we'll email you a link to finish."
      : failure
        ? errorMessage(failure, BEGIN_ONLINE_ERRORS)
        : '';
  const nextStep = steps[index + 1];
  return (
    <div ref={topRef} tabIndex={-1} className="outline-none">
      <FormHeader
        title={fill(definition.title)}
        subtitle={definition.subtitle ? fill(definition.subtitle) : undefined}
      />
      <IntakeStepper
        steps={steps.map((s, i) => ({ id: i + 1, label: fill(s.title) }))}
        current={index + 1}
        onEdit={(id) => {
          const target = steps[id - 1];
          if (target) go(target.key);
        }}
      />
      {step.subtitle && <p className="mb-2 text-center text-xs">{fill(step.subtitle)}</p>}
      <form
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
        {step.review && (
          <IntakeReview
            definition={definition}
            values={values}
            shownSteps={shown.steps}
            shownFields={shown.fields}
            uploads={uploads}
            fill={fill}
            onEdit={go}
          />
        )}
        <div className={step.review ? 'mt-3' : ''}>
          <StepSections
            step={step}
            values={values}
            shown={shown.fields}
            onChange={onChange}
            errors={errors}
            fill={fill}
            actions={{
              uploads,
              upload: async (slot, file) => {
                const saved = await uploadFile(file, {
                  start: (facts) => client.createUpload(form, { slot, ...facts }),
                  finish: (uploadToken) => client.confirmUpload(form, { uploadToken }),
                });
                setUploads((list) => [...list, saved]);
              },
              remove: async (id) => {
                await client.removeUpload(form, id);
                setUploads((list) => list.filter((u) => u.id !== id));
              },
            }}
          />
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
          <div className="flex flex-wrap gap-2">
            {index > 0 && (
              <Button
                variant="outline"
                onClick={() => void back()}
                disabled={save.isPending}
                className="min-w-32"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                Previous
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => void later()}
              disabled={save.isPending || resumeLink.isPending}
            >
              <Save aria-hidden="true" className="size-4" />
              Save and Continue Later
            </Button>
          </div>
          <Button type="submit" disabled={save.isPending || submit.isPending} className="min-w-40">
            {step.review
              ? 'Submit Intake Form'
              : nextStep
                ? `Continue to ${fill(nextStep.title)}`
                : 'Continue'}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </footer>
      </form>
    </div>
  );
}
