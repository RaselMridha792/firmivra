'use client';

import type { CalculatorResult } from '@firmivra/types';
import { Button, Input, Select, Toast } from '@firmivra/ui';
import { Calculator } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer, TpShell } from './tp-shell';
import {
  FILING,
  TP_ERRORS,
  TP_KEY,
  card,
  dollars,
  moneyExact,
  outlined,
  primary,
  quiet,
} from './tp-shared';

const BASE: [string, string][] = [
  ['wagesCents', 'Wages & salary'],
  ['selfEmploymentIncomeCents', 'Self-employment income'],
  ['businessIncomeCents', 'Business income'],
  ['interestDividendsCents', 'Interest & dividends'],
  ['capitalGainsCents', 'Capital gains'],
  ['otherIncomeCents', 'Other income'],
  ['adjustmentsCents', 'Adjustments to income'],
  ['itemizedDeductionsCents', 'Itemized deductions'],
  ['creditsCents', 'Credits'],
];
const STRAT: [string, string][] = [
  ['retirementContributionCents', 'Retirement contribution'],
  ['hsaContributionCents', 'HSA contribution'],
  ['section179Cents', 'Section 179 deduction'],
  ['homeOfficeCents', 'Home office deduction'],
  ['otherDeductionCents', 'Other deduction'],
  ['additionalCreditCents', 'Additional credit'],
];

/** /tax-planning/calculator: the Tax Savings Calculator: a scenario against a baseline, never a guarantee. */
export function SavingsCalculator() {
  const qc = useQueryClient();
  const clients = useApiQuery([...TP_KEY, 'pick-clients'], () =>
    api.taxPlanning.clients({ pageSize: 100 }),
  );
  const saved = useApiQuery([...TP_KEY, 'scenarios'], () =>
    api.taxPlanning.scenarios({ pageSize: 5 }),
  );
  const year = new Date().getFullYear();
  const [clientId, setClientId] = useState('');
  const [taxYear, setTaxYear] = useState(String(year));
  const [filing, setFiling] = useState('SINGLE');
  const [base, setBase] = useState<Record<string, string>>({});
  const [strat, setStrat] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CalculatorResult>();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [busy, setBusy] = useState(false);
  const pick = (m: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(m)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, dollars(v)]),
    );
  const body = () => ({
    ...(clientId ? { clientId } : {}),
    taxYear: Number(taxYear),
    filingStatus: filing as never,
    baseline: pick(base) as never,
    strategy: pick(strat) as never,
  });
  const calc = async () => {
    setBusy(true);
    try {
      setResult(await api.taxPlanning.calculate(body()));
    } catch (e) {
      setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
    }
    setBusy(false);
  };
  const save = async () => {
    try {
      await api.taxPlanning.saveScenario({
        ...(name.trim() ? { name: name.trim() } : {}),
        calculation: body(),
      });
      await qc.invalidateQueries({ queryKey: [...TP_KEY, 'scenarios'] });
      setMessage({ text: 'Scenario saved.', tone: 'success' });
    } catch (e) {
      setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
    }
  };
  return (
    <TpShell>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          className={`${card} flex flex-col gap-4`}
          aria-label="Tax savings calculator"
          data-testid="tp-calculator"
        >
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-heading">
            <Calculator aria-hidden weight="fill" className="size-6 text-action" /> Tax Savings
            Calculator
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Client (optional)"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              options={[
                { value: '', label: 'No client' },
                ...(clients.data?.items ?? []).map((c) => ({
                  value: c.client.id,
                  label: c.client.name,
                })),
              ]}
            />
            <Select
              label="Tax year"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              options={[year - 1, year, year + 1].map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
            <Select
              label="Filing status"
              value={filing}
              onChange={(e) => setFiling(e.target.value)}
              options={Object.entries(FILING).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-heading">
              Baseline ($ per year)
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {BASE.map(([k, l]) => (
                <Input
                  key={k}
                  label={l}
                  value={base[k] ?? ''}
                  onChange={(e) => setBase({ ...base, [k]: e.target.value })}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-heading">Strategy ($)</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {STRAT.map(([k, l]) => (
                <Input
                  key={k}
                  label={l}
                  value={strat[k] ?? ''}
                  onChange={(e) => setStrat({ ...strat, [k]: e.target.value })}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void calc()}>
              Calculate
            </button>
            <button
              type="button"
              className={outlined}
              onClick={() => {
                setBase({});
                setStrat({});
                setResult(undefined);
              }}
            >
              Reset
            </button>
          </div>
        </section>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-label="Result" data-testid="calc-result">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Estimated Result</h2>
            {!result ? (
              <p className={quiet}>Enter a baseline and a strategy, then calculate.</p>
            ) : result.differenceCents === null ? (
              <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
                {result.unavailableReason ?? 'The result is not available.'}
              </p>
            ) : (
              <dl className="divide-y divide-divider text-sm">
                <div className="flex justify-between py-1.5">
                  <dt className="text-muted">Estimated tax without the strategy</dt>
                  <dd className="font-medium text-heading">
                    {moneyExact(result.baselineTaxCents)}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="text-muted">Estimated tax with the strategy</dt>
                  <dd className="font-medium text-heading">{moneyExact(result.modeledTaxCents)}</dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="font-semibold text-heading">Projected saving</dt>
                  <dd className="font-display text-xl font-bold text-success" data-testid="saving">
                    {moneyExact(result.differenceCents)}
                  </dd>
                </div>
              </dl>
            )}
            {result?.unavailableReason && result.differenceCents !== null ? (
              <p className="mt-2 text-xs text-muted">{result.unavailableReason}</p>
            ) : null}
            {result ? (
              <ul className="mt-3 list-disc pl-5 text-xs text-muted">
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2">
              <Disclaimer
                text={
                  result?.disclaimer ??
                  'Estimates are based on the information provided and current tax law. Actual results may vary.'
                }
              />
            </div>
            {result && result.differenceCents !== null ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Input
                    label="Scenario name (optional)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <Button onClick={() => void save()}>Save Scenario</Button>
              </div>
            ) : null}
          </section>
          <section className={card} aria-label="Saved scenarios" data-testid="scenarios">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Recent Scenarios</h2>
            {saved.data?.items.length === 0 ? (
              <p className={quiet}>No saved scenarios yet.</p>
            ) : null}
            <ul>
              {(saved.data?.items ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
                >
                  <span className="text-heading">
                    {s.name ?? 'Scenario'} · {s.taxYear}
                  </span>
                  <span className="text-muted">
                    {s.result.differenceCents === null
                      ? 'N/A'
                      : moneyExact(s.result.differenceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <Link href="/tax-planning" className="text-sm font-medium text-link">
            ← Back to Tax Planning &amp; Strategy
          </Link>
        </div>
      </div>
    </TpShell>
  );
}
