'use client';

import {
  CURRENT_TAX_YEAR,
  estimateTaxReturn,
  type FilingStatus,
  TaxReturnInput,
  type TaxReturnNotice,
  type TaxReturnResult,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Radio, Select } from '@firmivra/ui';
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

const NOTICES: Record<TaxReturnNotice, string> = {
  NOT_INCLUDED:
    'This estimate does not include tax credits (such as the child tax credit), special deductions (such as tips, overtime, senior, student loan or car-loan interest), the qualified business income deduction, capital gains or other taxes. If these apply to you, a professional calculation is recommended.',
  MFS_STANDARD_NOT_ALLOWED:
    'Your spouse itemizes, so the standard deduction is $0 for you. Choose Itemized Deduction and enter your estimate.',
  BUSINESS_LOSS_NOT_USED:
    'Your business expenses are more than your business income. The estimate counts this as no business income.',
  STANDARD_LARGER:
    'Your itemized deductions are less than the standard deduction, so the standard deduction was used.',
};

interface Form {
  filingStatus: FilingStatus;
  wages: string;
  otherIncome: string;
  selfEmployed: boolean;
  businessIncome: string;
  businessExpenses: string;
  deductionType: 'STANDARD' | 'ITEMIZED';
  itemizedDeductions: string;
  mfsSpouseItemizes: boolean;
  withholding: string;
  estimatedPayments: string;
}
const EMPTY: Form = {
  filingStatus: 'SINGLE',
  wages: '',
  otherIncome: '',
  selfEmployed: false,
  businessIncome: '',
  businessExpenses: '',
  deductionType: 'STANDARD',
  itemizedDeductions: '',
  mfsSpouseItemizes: false,
  withholding: '',
  estimatedPayments: '',
};

/** A blank is $0; anything else must be a number, which the contract then checks. */
const amount = (text: string): number => (text.trim() === '' ? 0 : Number(text.replace(/,/g, '')));

/**
 * /{firm}/calculator/tax-return (signed in) and /{firm}/calculators/tax-return (public): the Tax
 * Return Estimator (Octavia's guide), core version. Runs in the browser; nothing is stored.
 */
export function TaxReturnScreen({ publicPage = false }: { publicPage?: boolean }) {
  const slug = String(useParams<{ firmSlug: string }>().firmSlug);
  const calculator = useApiQuery(['my-calculator', slug, 'tax_return', publicPage], () =>
    (publicPage ? api.publicCalculators(slug) : api.myCalculators(slug)).get('tax_return'),
  );
  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title={`${CURRENT_TAX_YEAR} Federal Tax Return Estimator`}
        subtitle="A quick estimate of your refund or amount due."
      />
      <PageState query={calculator}>{(c) => <Estimator disclaimer={c.disclaimer} />}</PageState>
    </div>
  );
}

function Estimator({ disclaimer }: { disclaimer: string }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [result, setResult] = useState<TaxReturnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
  };

  function calculate() {
    const parsed = TaxReturnInput.safeParse({
      filingStatus: form.filingStatus,
      wages: amount(form.wages),
      otherIncome: amount(form.otherIncome),
      businessIncome: form.selfEmployed ? amount(form.businessIncome) : 0,
      businessExpenses: form.selfEmployed ? amount(form.businessExpenses) : 0,
      deductionType: form.deductionType,
      itemizedDeductions: amount(form.itemizedDeductions),
      mfsSpouseItemizes: form.filingStatus === 'MARRIED_SEPARATE' && form.mfsSpouseItemizes,
      withholding: amount(form.withholding),
      estimatedPayments: amount(form.estimatedPayments),
    });
    if (!parsed.success) {
      setResult(null);
      setError('Enter amounts as positive numbers with at most 2 decimals, for example 75000.');
      return;
    }
    setError(null);
    setResult(estimateTaxReturn(parsed.data));
  }

  const money = (key: keyof Form, label: string) => (
    <Input
      label={label}
      inputMode="decimal"
      placeholder="0"
      value={String(form[key])}
      onChange={(e) => set(key, e.target.value as never)}
    />
  );

  const rows = (r: TaxReturnResult): [string, string][] => [
    ['Total Income', formatCents(r.totalIncome)],
    ['Total Supported Deductions', formatCents(r.totalDeductions)],
    ['Taxable Income', formatCents(r.taxableIncome)],
    ['Estimated Federal Income Tax', formatCents(r.incomeTax)],
    ...(r.selfEmploymentTax > 0
      ? ([['Self-Employment Tax', formatCents(r.selfEmploymentTax)]] as [string, string][])
      : []),
    ['Total Federal Tax', formatCents(r.totalTax)],
    ['Tax Payments', formatCents(r.taxPayments)],
    ['Refundable Credits', formatCents(r.refundableCredits)],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Your information">
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
          {money('wages', 'W-2 Wages')}
          {money('otherIncome', 'Other Ordinary Income')}
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Are You Self-Employed?</legend>
            <Radio
              name="self-employed"
              label="Yes"
              checked={form.selfEmployed}
              onChange={() => set('selfEmployed', true)}
            />
            <Radio
              name="self-employed"
              label="No"
              checked={!form.selfEmployed}
              onChange={() => set('selfEmployed', false)}
            />
          </fieldset>
          {form.selfEmployed ? (
            <>
              {money('businessIncome', 'Gross Business Income')}
              {money('businessExpenses', 'Business Expenses')}
            </>
          ) : null}
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Deduction Type</legend>
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
            ? money('itemizedDeductions', 'Total Estimated Itemized Deductions')
            : null}
          {form.filingStatus === 'MARRIED_SEPARATE' ? (
            <Checkbox
              label="My spouse will itemize deductions"
              checked={form.mfsSpouseItemizes}
              onChange={(e) => set('mfsSpouseItemizes', e.target.checked)}
            />
          ) : null}
          <h3 className="text-sm font-semibold text-heading">Tax Payments</h3>
          {money('withholding', 'Federal Income Tax Withheld')}
          {money('estimatedPayments', `${CURRENT_TAX_YEAR} Estimated Federal Tax Payments`)}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Get My Tax Estimate</Button>
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
          <Card
            title={`Your ${CURRENT_TAX_YEAR} Federal Tax Estimate`}
            data-testid="tax-return-result"
          >
            {result.notices.map((n) => (
              <p key={n} role="status" className="mb-3 text-sm text-text">
                {NOTICES[n]}
              </p>
            ))}
            <dl className="flex flex-col gap-2">
              {rows(result).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-text">{label}</dt>
                  <dd className="font-semibold text-heading">{value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-border pt-2 text-base">
                <dt className="font-semibold text-heading">
                  {result.refundOrDue >= 0
                    ? 'Estimated Federal Refund'
                    : 'Estimated Federal Amount Due'}
                </dt>
                <dd className="font-bold text-heading">
                  {formatCents(Math.abs(result.refundOrDue))}
                </dd>
              </div>
            </dl>
          </Card>
        ) : null}
        <p className="text-sm text-text">{disclaimer}</p>
      </div>
    </div>
  );
}
