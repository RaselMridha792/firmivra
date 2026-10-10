'use client';

import {
  CURRENT_TAX_YEAR,
  type FilingStatus,
  estimateQuarterlySteady,
  QuarterlySteadyInput,
  type QuarterlySteadyNotice,
  type QuarterlySteadyResult,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Radio, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { PortalPageHeader } from '../../_components/portal-page-header';
import { formatCents } from './format';

const STATUSES: { value: FilingStatus; label: string }[] = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED_JOINT', label: 'Married Filing Jointly' },
  { value: 'MARRIED_SEPARATE', label: 'Married Filing Separately' },
  { value: 'HEAD_OF_HOUSEHOLD', label: 'Head of Household' },
  { value: 'QUALIFYING_SURVIVING_SPOUSE', label: 'Qualifying Surviving Spouse' },
];

const NOTICES: Record<QuarterlySteadyNotice, string> = {
  NOT_INCLUDED:
    'This estimate does not include tax credits, the qualified business income deduction, special deductions (such as tips, overtime, senior or car-loan interest), capital gains or other taxes. If these apply to you, ask us for a full review.',
  NO_PAYMENT_REQUIRED:
    'You are expected to owe less than $1,000 after withholding, so no estimated payment is required.',
  MFS_STANDARD_NOT_ALLOWED:
    'Your spouse itemizes, so the standard deduction is $0 for you. Choose Itemized Deduction and enter your estimate.',
  BUSINESS_LOSS_NOT_USED:
    'Your business expenses are more than your business income. The estimate counts this as no business income.',
};

interface Form {
  filingStatus: FilingStatus;
  wages: string;
  businessIncome: string;
  businessExpenses: string;
  otherIncome: string;
  deductionType: 'STANDARD' | 'ITEMIZED';
  itemizedDeductions: string;
  mfsSpouseItemizes: boolean;
  withholding: string;
  priorOn: boolean;
  priorTotalTax: string;
  priorAgi: string;
  priorCovered: boolean;
}
const EMPTY: Form = {
  filingStatus: 'SINGLE',
  wages: '',
  businessIncome: '',
  businessExpenses: '',
  otherIncome: '',
  deductionType: 'STANDARD',
  itemizedDeductions: '',
  mfsSpouseItemizes: false,
  withholding: '',
  priorOn: false,
  priorTotalTax: '',
  priorAgi: '',
  priorCovered: true,
};

/** A blank is $0; anything else must be a number, which the contract then checks. */
const amount = (text: string): number => (text.trim() === '' ? 0 : Number(text.replace(/,/g, '')));

/**
 * /{firm}/calculator/quarterly-estimate (signed in) and /{firm}/calculators/quarterly-estimate
 * (public): the Quarterly Estimated Tax Calculator (Octavia's guide). Runs in the browser. Only
 * "My Income Is Fairly Steady" is built so far.
 */
export function QuarterlyScreen({ publicPage = false }: { publicPage?: boolean }) {
  const slug = String(useParams<{ firmSlug: string }>().firmSlug);
  const calculator = useApiQuery(['my-calculator', slug, 'quarterly_estimate', publicPage], () =>
    (publicPage ? api.publicCalculators(slug) : api.myCalculators(slug)).get('quarterly_estimate'),
  );
  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title={`${CURRENT_TAX_YEAR} Quarterly Estimated Tax Calculator`}
        subtitle="How is your income earned during the year?"
      />
      <PageState query={calculator}>
        {(c) => <Calculator disclaimer={c.disclaimer} slug={slug} publicPage={publicPage} />}
      </PageState>
    </div>
  );
}

function Calculator({
  disclaimer,
  slug,
  publicPage,
}: {
  disclaimer: string;
  slug: string;
  publicPage: boolean;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [result, setResult] = useState<QuarterlySteadyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
  };

  function calculate() {
    const parsed = QuarterlySteadyInput.safeParse({
      filingStatus: form.filingStatus,
      wages: amount(form.wages),
      businessIncome: amount(form.businessIncome),
      businessExpenses: amount(form.businessExpenses),
      otherIncome: amount(form.otherIncome),
      deductionType: form.deductionType,
      itemizedDeductions: amount(form.itemizedDeductions),
      mfsSpouseItemizes: form.filingStatus === 'MARRIED_SEPARATE' && form.mfsSpouseItemizes,
      withholding: amount(form.withholding),
      ...(form.priorOn
        ? {
            priorYear: {
              totalTax: amount(form.priorTotalTax),
              agi: amount(form.priorAgi),
              coveredTwelveMonths: form.priorCovered,
            },
          }
        : {}),
    });
    if (!parsed.success) {
      setResult(null);
      setError('Enter amounts as positive numbers with at most 2 decimals, for example 75000.');
      return;
    }
    setError(null);
    setResult(estimateQuarterlySteady(parsed.data));
  }

  const money = (key: keyof Form, label: string, hint?: string) => (
    <div>
      <Input
        label={label}
        inputMode="decimal"
        placeholder="0"
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value as never)}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Your information">
        <div className="mb-4 flex flex-wrap gap-3">
          <Button type="button" aria-pressed="true">
            My Income Is Fairly Steady
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled
            title="Coming soon"
            aria-describedby="varies-note"
          >
            My Income Varies During the Year
          </Button>
        </div>
        <p id="varies-note" className="mb-4 text-xs text-muted">
          The option for income that changes during the year is coming soon.
        </p>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            calculate();
          }}
        >
          <Select
            label="Filing Status"
            value={form.filingStatus}
            options={STATUSES}
            onChange={(e) => set('filingStatus', e.target.value as FilingStatus)}
          />
          {money('wages', `Expected ${CURRENT_TAX_YEAR} W-2 Wages`)}
          {money('businessIncome', 'Gross Business Income (if self-employed)')}
          {money('businessExpenses', 'Business Expenses')}
          {money('otherIncome', 'Other Taxable Income')}
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Deduction Method</legend>
            <Radio
              name="deduction"
              label="Standard Deduction"
              checked={form.deductionType === 'STANDARD'}
              onChange={() => set('deductionType', 'STANDARD')}
            />
            <Radio
              name="deduction"
              label="Itemized Deduction"
              checked={form.deductionType === 'ITEMIZED'}
              onChange={() => set('deductionType', 'ITEMIZED')}
            />
          </fieldset>
          {form.deductionType === 'ITEMIZED'
            ? money('itemizedDeductions', 'Estimated Itemized Deductions')
            : null}
          {form.filingStatus === 'MARRIED_SEPARATE' ? (
            <Checkbox
              label="My spouse will itemize deductions"
              checked={form.mfsSpouseItemizes}
              onChange={(e) => set('mfsSpouseItemizes', e.target.checked)}
            />
          ) : null}
          {money('withholding', `Expected ${CURRENT_TAX_YEAR} Federal Withholding`)}
          <Checkbox
            label="I filed a 2025 return and want to use the prior-year safe harbor"
            checked={form.priorOn}
            onChange={(e) => set('priorOn', e.target.checked)}
          />
          {form.priorOn ? (
            <>
              {money('priorTotalTax', '2025 Total Tax')}
              {money('priorAgi', '2025 AGI')}
              <Checkbox
                label="My 2025 return covered 12 months"
                checked={form.priorCovered}
                onChange={(e) => set('priorCovered', e.target.checked)}
              />
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Calculate My Estimated Tax Payment</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setForm(EMPTY);
                setResult(null);
                setError(null);
              }}
            >
              Start Over
            </Button>
          </div>
        </form>
      </Card>
      <div className="flex flex-col gap-6">
        {result ? (
          <Card title="Your estimate" data-testid="quarterly-result">
            {result.notices.map((n) => (
              <p key={n} role="status" className="mb-3 text-sm text-text">
                {NOTICES[n]}
              </p>
            ))}
            <dl className="flex flex-col gap-2">
              {(
                [
                  ['Suggested Estimated Payment', result.suggestedPayment],
                  ['Safe-Harbor Estimated Payment', result.safeHarborPayment],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-text">{label}</dt>
                  <dd className="font-semibold text-heading">{formatCents(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">
              Payments are due in four installments for the year (April 15, June 15, September 15
              and January 15). Your projected {CURRENT_TAX_YEAR} tax is{' '}
              {formatCents(result.projectedTotalTax)}.
            </p>
            <Link
              href={publicPage ? `/${slug}/begin` : `/${slug}/appointments`}
              className="mt-4 inline-block text-link underline"
            >
              Book a Tax Consultation
            </Link>
          </Card>
        ) : null}
        <p className="text-sm text-text">{disclaimer}</p>
      </div>
    </div>
  );
}
