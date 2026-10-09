'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@firmivra/ui';
import { ArrowLeft, Info, LockKeyhole } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { FormProvider, useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { ContinueButton, IntakeStepper } from '../../_blocks/form-blocks';
import { hasBusiness } from './annual-data';
import { annualSchema, initialValues, type AnnualValues } from './annual-schema';
import { DocumentsStep } from './documents-step';
import { IncomeStep } from './income-step';
import { PersonalStep } from './personal-step';
import { ReviewStep } from './review-step';
import styles from './annual-tax.module.css';

const steps = [
  { id: 1, label: 'Personal & Filing Information' },
  { id: 2, label: 'Business Income & Expenses' },
  { id: 3, label: 'Required Document Upload' },
  { id: 4, label: 'Review & Sign Agreement' },
];
export function AnnualTaxForm({ taxYear, today }: { taxYear: number; today: string }) {
  const [step, setStep] = useState(1);
  const [notice, setNotice] = useState('');
  const [hasErrors, setHasErrors] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const form = useForm<AnnualValues>({
    resolver: zodResolver(annualSchema(step, today)),
    defaultValues: initialValues(),
    shouldUnregister: false,
  });
  const types = useWatch({ control: form.control, name: 'returnTypes' });
  const business = hasBusiness(types);
  const visibleSteps = steps.filter(({ id }) => id !== 2 || business || !types.length);
  function go(next: number) {
    setStep(next);
    form.clearErrors();
    setHasErrors(false);
    setNotice('');
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ block: 'start' });
    });
  }
  function invalid(errors: FieldErrors<AnnualValues>) {
    setHasErrors(true);
    if (step === 4) {
      const first = Object.keys(errors)[0];
      if (first && ['businessIncome', 'payroll', 'taxPayments', 'expenses'].includes(first))
        setStep(2);
      else if (first === 'documents' || first === 'certified') setStep(3);
      else if (first && !['payment', 'agreed', 'signature', 'signatureDate'].includes(first))
        setStep(1);
    }
    requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }
  function advance() {
    if (step === 1) go(business ? 2 : 3);
    else if (step < 4) go(step + 1);
    else {
      setHasErrors(false);
      setNotice(
        'Online submission is not available yet. Your answers and selected files remain on this page; nothing has been sent. Keep this page open to retain your information.',
      );
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    return form.handleSubmit(advance, invalid)(event);
  }
  return (
    <div
      data-theme="begin-online"
      data-testid="annual-tax-form"
      className={`-m-6 bg-surface px-4 py-3 sm:px-6 ${styles.form}`}
    >
      <header className="mb-2 text-center">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-3xl leading-tight font-bold text-heading outline-none sm:text-4xl"
        >
          Annual Tax <span className="text-accent">Intake Form</span>
        </h1>
        {step === 2 && (
          <h2 className="font-display text-xl font-bold text-heading">
            Business Income & Expenses
          </h2>
        )}
        <p className="mx-auto max-w-xl text-xs">
          Let&apos;s get started! Please complete the information below so we can prepare an
          accurate and compliant tax return for you.
        </p>
        <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 rounded-control bg-folder-surface px-3 py-1 text-xs">
          <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
          <p>
            This is a <strong>secure and encrypted form.</strong> Your information is protected
            using industry-standard encryption.
          </p>
        </div>
      </header>
      <IntakeStepper steps={visibleSteps} current={step} onEdit={go} />
      <FormProvider {...form}>
        <form noValidate onSubmit={submit}>
          {hasErrors && Object.keys(form.formState.errors).length > 0 && (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              className="mb-3 rounded-control border border-danger bg-danger-soft p-3 text-sm text-danger"
            >
              Please complete the highlighted fields before continuing.
            </div>
          )}
          {step === 1 && <PersonalStep taxYear={taxYear} today={today} />}
          {step === 2 && <IncomeStep />}
          {step === 3 && <DocumentsStep />}
          {step === 4 && <ReviewStep taxYear={taxYear} today={today} onEdit={go} />}
          {notice && (
            <p
              role="status"
              className="mt-3 rounded-control border border-folder-border bg-folder-surface p-3 text-sm text-heading"
            >
              {notice}
            </p>
          )}
          <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {step === 1 ? (
              <p className="flex flex-1 items-center gap-2 rounded-control bg-accent-soft p-2 text-xs">
                <Info aria-hidden="true" className="size-6 shrink-0 text-accent" />
                <span>
                  <strong>Important:</strong> Your answers will help us determine which documents
                  are required on the next page. Please be as accurate as possible.
                </span>
              </p>
            ) : (
              <Button
                variant="outline"
                onClick={() => go(step === 3 && !business ? 1 : step - 1)}
                className="min-w-32"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back
              </Button>
            )}
            <ContinueButton
              label={
                step === 4
                  ? 'Submit Intake Form'
                  : step === 3
                    ? 'Continue to Next Step'
                    : 'Continue'
              }
            />
          </footer>
        </form>
      </FormProvider>
    </div>
  );
}
