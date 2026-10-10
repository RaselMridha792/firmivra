'use client';

import {
  type FilingStatus,
  estimateTaxBracket,
  TaxBracketInput,
  type TaxBracketResult,
  taxYearConstants,
  CURRENT_TAX_YEAR,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Radio, Select } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { PortalPageHeader } from '../../_components/portal-page-header';
import { formatCents, formatRate } from './format';

const STATUSES: { value: FilingStatus; label: string }[] = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED_JOINT', label: 'Married Filing Jointly' },
  { value: 'MARRIED_SEPARATE', label: 'Married Filing Separately' },
  { value: 'HEAD_OF_HOUSEHOLD', label: 'Head of Household' },
  { value: 'QUALIFYING_SURVIVING_SPOUSE', label: 'Qualifying Surviving Spouse' },
];

interface Form {
  filingStatus: FilingStatus;
  annualIncome: string;
  adjustments: string;
  deductionType: 'STANDARD' | 'ITEMIZED';
  itemizedDeductions: string;
  age65: boolean;
  blind: boolean;
  spouseAge65: boolean;
  spouseBlind: boolean;
  mfsSpouseItemizes: boolean;
}
const EMPTY: Form = {
  filingStatus: 'SINGLE',
  annualIncome: '',
  adjustments: '',
  deductionType: 'STANDARD',
  itemizedDeductions: '',
  age65: false,
  blind: false,
  spouseAge65: false,
  spouseBlind: false,
  mfsSpouseItemizes: false,
};

/** A blank optional amount is $0; anything else must be a number, which the contract then checks. */
const amount = (text: string): number => (text.trim() === '' ? 0 : Number(text.replace(/,/g, '')));

const NOTICES = {
  MFS_STANDARD_NOT_ALLOWED:
    'Your spouse itemizes, so the standard deduction is $0 for you. Choose Itemized Deduction and enter your estimate.',
  ITEMIZED_BELOW_STANDARD:
    'Your itemized deductions are less than the standard deduction you would get. The amount you entered was used.',
} as const;

/** /{firm}/calculator/tax-bracket: the Tax Bracket Calculator (Octavia's guide). Runs in the browser. */
export function TaxBracketScreen() {
  const slug = String(useParams<{ firmSlug: string }>().firmSlug);
  const calculator = useApiQuery(['my-calculator', slug, 'tax_bracket'], () =>
    api.myCalculators(slug).get('tax_bracket'),
  );
  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title="Tax Bracket Calculator"
        subtitle={`Estimate your ${CURRENT_TAX_YEAR} federal income tax before credits.`}
      />
      <PageState query={calculator}>{(c) => <Calculator disclaimer={c.disclaimer} />}</PageState>
    </div>
  );
}

function Calculator({ disclaimer }: { disclaimer: string }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [result, setResult] = useState<TaxBracketResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
  };
  const married = form.filingStatus === 'MARRIED_JOINT';
  const standard = taxYearConstants(CURRENT_TAX_YEAR).standardDeductionCents[form.filingStatus];

  function calculate() {
    const parsed = TaxBracketInput.safeParse({
      filingStatus: form.filingStatus,
      annualIncome: amount(form.annualIncome),
      adjustments: amount(form.adjustments),
      deductionType: form.deductionType,
      itemizedDeductions: amount(form.itemizedDeductions),
      taxpayer: { age65OrOlder: form.age65, blind: form.blind },
      ...(married ? { spouse: { age65OrOlder: form.spouseAge65, blind: form.spouseBlind } } : {}),
      mfsSpouseItemizes: form.filingStatus === 'MARRIED_SEPARATE' && form.mfsSpouseItemizes,
    });
    if (!parsed.success) {
      setResult(null);
      setError('Enter amounts as positive numbers with at most 2 decimals, for example 75000.');
      return;
    }
    setError(null);
    setResult(estimateTaxBracket(parsed.data));
  }

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
          <p className="text-sm text-text">Tax Year: {CURRENT_TAX_YEAR}</p>
          <Select
            label="Filing Status"
            value={form.filingStatus}
            options={STATUSES}
            onChange={(e) => set('filingStatus', e.target.value as FilingStatus)}
          />
          <div>
            <Input
              label="Annual Income"
              inputMode="decimal"
              placeholder="0"
              value={form.annualIncome}
              onChange={(e) => set('annualIncome', e.target.value)}
              error={error ?? undefined}
            />
            <p className="mt-1 text-xs text-muted">
              Enter your total estimated income for {CURRENT_TAX_YEAR} before deductions.
            </p>
          </div>
          <div>
            <Input
              label="Adjustments to Income (optional)"
              inputMode="decimal"
              placeholder="0"
              value={form.adjustments}
              onChange={(e) => set('adjustments', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Enter eligible adjustments that reduce adjusted gross income, if known. Leave blank if
              none.
            </p>
          </div>
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">
              Which deduction would you like to use?
            </legend>
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
          {form.deductionType === 'ITEMIZED' ? (
            <Input
              label="Estimated Itemized Deductions"
              inputMode="decimal"
              placeholder="0"
              value={form.itemizedDeductions}
              onChange={(e) => set('itemizedDeductions', e.target.value)}
            />
          ) : (
            <p className="text-sm text-text">
              {CURRENT_TAX_YEAR} Standard Deduction Applied: {formatCents(standard)}
            </p>
          )}
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">
              To get your standard deduction right
            </legend>
            <Checkbox
              label={`I will be 65 or older at the end of ${CURRENT_TAX_YEAR}`}
              checked={form.age65}
              onChange={(e) => set('age65', e.target.checked)}
            />
            <Checkbox
              label="I am considered blind under IRS rules"
              checked={form.blind}
              onChange={(e) => set('blind', e.target.checked)}
            />
            {married ? (
              <>
                <Checkbox
                  label={`My spouse will be 65 or older at the end of ${CURRENT_TAX_YEAR}`}
                  checked={form.spouseAge65}
                  onChange={(e) => set('spouseAge65', e.target.checked)}
                />
                <Checkbox
                  label="My spouse is considered blind under IRS rules"
                  checked={form.spouseBlind}
                  onChange={(e) => set('spouseBlind', e.target.checked)}
                />
              </>
            ) : null}
            {form.filingStatus === 'MARRIED_SEPARATE' ? (
              <Checkbox
                label="My spouse will itemize deductions"
                checked={form.mfsSpouseItemizes}
                onChange={(e) => set('mfsSpouseItemizes', e.target.checked)}
              />
            ) : null}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Calculate My {CURRENT_TAX_YEAR} Federal Tax</Button>
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
        {result ? <Results result={result} /> : <BracketChart form={form} />}
        <p className="text-sm text-text">{disclaimer}</p>
      </div>
    </div>
  );
}

function Results({ result }: { result: TaxBracketResult }) {
  const rows: [string, string][] = [
    ['Annual Income', formatCents(result.annualIncome)],
    [
      'Deduction Used',
      `${result.deduction.type === 'STANDARD' ? 'Standard' : 'Itemized'} Deduction — ${formatCents(result.deduction.amount)}`,
    ],
    ['Estimated Taxable Income', formatCents(result.taxableIncome)],
    ['Marginal Tax Bracket', formatRate(result.marginalRate)],
    ['Estimated Federal Income Tax Before Credits', formatCents(result.taxBeforeCredits)],
    [
      'Effective Federal Income Tax Rate',
      result.effectiveRate === null ? 'N/A' : formatRate(result.effectiveRate, 1),
    ],
  ];
  return (
    <>
      <Card title="Your estimate" data-testid="tax-bracket-result">
        {result.notices.map((n) => (
          <p key={n} role="status" className="mb-3 text-sm text-danger">
            {NOTICES[n]}
          </p>
        ))}
        <dl className="flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 text-sm">
              <dt className="text-text">{label}</dt>
              <dd className="font-semibold text-heading">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted">
          Your marginal tax bracket is the tax rate that applies to the highest portion of your
          taxable income. It does not mean all of your income is taxed at this rate.
        </p>
        <p className="mt-2 text-xs text-muted">
          This is an estimate for planning purposes only. Your final tax liability is determined
          when your complete federal income-tax return is prepared.
        </p>
      </Card>
      <Card title="How your tax is calculated">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Tax by bracket</caption>
          <thead>
            <tr>
              <th scope="col">Taxable income in this bracket</th>
              <th scope="col">Rate</th>
              <th scope="col" className="text-right">
                Tax
              </th>
            </tr>
          </thead>
          <tbody>
            {result.slices.map((s) => (
              <tr key={s.from}>
                <td>
                  {formatCents(s.from)} – {s.to === null ? 'and up' : formatCents(s.to)}
                </td>
                <td>{formatRate(s.rate)}</td>
                <td className="text-right">{formatCents(s.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/** The bracket table for the chosen filing status, before and after a calculation (guide §12). */
function BracketChart({ form }: { form: Form }) {
  const brackets = estimateTaxBracket({
    filingStatus: form.filingStatus,
    annualIncome: 0,
    deductionType: 'STANDARD',
  }).brackets;
  const label = STATUSES.find((s) => s.value === form.filingStatus)?.label;
  return (
    <Card title={`${CURRENT_TAX_YEAR} brackets: ${label}`}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Federal income tax brackets</caption>
        <thead>
          <tr>
            <th scope="col">Taxable income</th>
            <th scope="col" className="text-right">
              Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b) => (
            <tr key={b.from}>
              <td>
                {b.to === null
                  ? `Over ${formatCents(b.from)}`
                  : `${formatCents(b.from)} – ${formatCents(b.to)}`}
              </td>
              <td className="text-right">{formatRate(b.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
