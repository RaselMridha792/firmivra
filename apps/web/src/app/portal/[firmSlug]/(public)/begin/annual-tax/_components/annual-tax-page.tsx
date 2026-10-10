'use client';

import {
  BEGIN_ONLINE_ERRORS,
  fillIntakeText,
  shownIntakeKeys,
  StartBeginDraftRequest,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { ArrowRight } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { FormHeader, IntakePage, type StartFormProps } from '../../_blocks/intake-flow';
import { IntakeStepper } from '../../_blocks/form-blocks';
import {
  allAnswers,
  issueKey,
  screenValues,
  stepAnswers,
  stepIssues,
} from '../../_blocks/intake-values';
import { AnnualPersonalStep } from './annual-personal-step';
import styles from './annual-tax.module.css';
/** LVP's first-step layout sits inside the existing public portal header and footer. */
export function AnnualTaxPage({ firmSlug }: { firmSlug: string }) {
  if (firmSlug !== 'lvp') return <IntakePage firmSlug={firmSlug} form="ANNUAL_TAX" />;
  return (
    <div className={styles.annual} data-annual-tax>
      <IntakePage
        firmSlug={firmSlug}
        form="ANNUAL_TAX"
        startForm={AnnualStartForm}
        personalStep={AnnualPersonalStep}
      />
    </div>
  );
}
function AnnualStartForm({ found, notice, unavailable, onStart }: StartFormProps) {
  const { definition, taxYear } = found;
  const step = definition.steps[0]!;
  const fill = (text: string) =>
    fillIntakeText(text, { taxYear, firmName: 'LVP Accounting & Taxes' });
  const [values, setValues] = useState(() => screenValues(definition, {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const shown = shownIntakeKeys(definition, allAnswers(definition, values));
  const save = useApiMutation((body: StartBeginDraftRequest) =>
    onStart(body, stepAnswers(step, values, shown.fields)),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    const issues = stepIssues(definition, step, values, []);
    const contact = StartBeginDraftRequest.safeParse({
      firstName: values['firstName'],
      lastName: values['lastName'],
      email: values['email'],
      phone: values['phone'] || null,
    });
    const next: Record<string, string> = {};
    for (const issue of issues) next[issueKey(issue.path)] ??= issue.message;
    if (!contact.success)
      for (const issue of contact.error.issues)
        next[issue.path.map(String).join('.')] ??= issue.message;
    setErrors(next);
    if (Object.keys(next).length || !contact.success) {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    save.mutate(contact.data);
  }
  return (
    <>
      <FormHeader
        title={fill(definition.title)}
        subtitle={definition.subtitle ? fill(definition.subtitle) : undefined}
      />
      <IntakeStepper
        steps={definition.steps.map((s, i) => ({ id: i + 1, label: fill(s.title) }))}
        current={1}
        onEdit={() => undefined}
      />
      {notice}
      {unavailable && (
        <p role="alert">
          This form isn&apos;t available to submit online yet. Please contact the firm.
        </p>
      )}
      <form ref={formRef} noValidate onSubmit={submit}>
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="mb-3 text-danger">
            Please complete the highlighted fields before continuing.
          </p>
        )}
        <AnnualPersonalStep
          step={step}
          values={values}
          shown={shown.fields}
          errors={errors}
          fill={fill}
          onChange={(key, value) => {
            setValues((v) => ({ ...v, [key]: value }));
            setErrors({});
          }}
          actions={{ uploads: [], upload: async () => undefined, remove: async () => undefined }}
        />
        {save.error && (
          <p role="alert" className="text-danger">
            {errorMessage(save.error, BEGIN_ONLINE_ERRORS)}
          </p>
        )}
        <footer>
          <Button type="submit" data-testid="intake-next" disabled={save.isPending || unavailable}>
            Continue <ArrowRight aria-hidden className="size-4" />
          </Button>
        </footer>
      </form>
    </>
  );
}
