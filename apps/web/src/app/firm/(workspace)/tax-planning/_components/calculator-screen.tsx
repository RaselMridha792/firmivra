'use client';

import type { CalculatorResult, TaxScenario } from '@firmivra/types';
import { Button, Input, Modal, Select, Toast } from '@firmivra/ui';
import { Calculator } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer, TpShell } from './tp-shell';
import {
  CATEGORY_LABEL,
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // C20 (Review 2): a saved scenario opens here (`?scenario=`), from this list or a plan.
  const openId = params.get('scenario');
  const saved = useApiQuery([...TP_KEY, 'scenarios'], () =>
    api.taxPlanning.scenarios({ pageSize: 10 }),
  );
  const opened = useApiQuery([...TP_KEY, 'scenario', openId ?? ''], () =>
    openId ? api.taxPlanning.scenario(openId) : Promise.resolve(null),
  );
  const year = new Date().getFullYear();
  const [clientId, setClientId] = useState('');
  const [taxYear, setTaxYear] = useState(String(year));
  const [filing, setFiling] = useState('SINGLE');
  const [base, setBase] = useState<Record<string, string>>({});
  const [strat, setStrat] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CalculatorResult>();
  // C26 (Review 2): the inputs the shown result was worked out from. Once they change, the result
  // is marked stale and cannot be saved until it is calculated again.
  const [calculatedFor, setCalculatedFor] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState('');
  const [adding, setAdding] = useState(false);
  const plans = useApiQuery([...TP_KEY, 'client-plans', clientId], () =>
    clientId ? api.taxPlanning.plans({ clientId, pageSize: 50 }) : Promise.resolve(null),
  );
  const livePlans = (plans.data?.items ?? []).filter((p) => !p.archived && p.status !== 'CLOSED');
  const pick = (m: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(m)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, dollars(v)]),
    );
  const bodyOf = (
    c: string,
    y: string,
    f: string,
    b: Record<string, string>,
    st: Record<string, string>,
  ) => ({
    ...(c ? { clientId: c } : {}),
    taxYear: Number(y),
    filingStatus: f as never,
    baseline: pick(b) as never,
    strategy: pick(st) as never,
  });
  const body = () => bodyOf(clientId, taxYear, filing, base, strat);
  // The opened scenario fills the form with what it kept, once, as it arrives (state set while
  // rendering, React's way to adjust state to new data). Its kept result counts as calculated for
  // those inputs until they change; Calculate works it out again with today's tables.
  const [loaded, setLoaded] = useState<string>();
  const sc: TaxScenario | null | undefined = opened.data;
  if (sc && loaded !== sc.id) {
    const cents = (m: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(m)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => [k, String((v as number) / 100)]),
      );
    const nb = cents(sc.baseline as Record<string, unknown>);
    const ns = cents(sc.strategy as Record<string, unknown>);
    const c = sc.client?.id ?? '';
    const f = sc.filingStatus ?? 'SINGLE';
    setLoaded(sc.id);
    setClientId(c);
    setTaxYear(String(sc.taxYear));
    setFiling(f);
    setBase(nb);
    setStrat(ns);
    setName(sc.name ?? '');
    setResult(sc.result);
    setCalculatedFor(JSON.stringify(bodyOf(c, String(sc.taxYear), f, nb, ns)));
  }
  const stale = !!result && JSON.stringify(body()) !== calculatedFor;
  const calc = async () => {
    setBusy(true);
    try {
      const sent = body();
      setResult(await api.taxPlanning.calculate(sent));
      setCalculatedFor(JSON.stringify(sent));
    } catch (e) {
      setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
    }
    setBusy(false);
  };
  // C19 (Review 2): with a plan, the scenario is saved to it as a snapshot that never changes.
  const save = async (toPlan?: string): Promise<boolean> => {
    if (stale) return false;
    try {
      await api.taxPlanning.saveScenario({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(toPlan ? { planId: toPlan } : {}),
        calculation: body(),
      });
      await qc.invalidateQueries({ queryKey: [...TP_KEY] });
      setMessage({
        text: toPlan ? 'Scenario saved to the plan.' : 'Scenario saved.',
        tone: 'success',
      });
      return true;
    } catch (e) {
      setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
      return false;
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
            {opened.data && loaded === opened.data.id && !stale ? (
              <p
                className="mb-2 rounded-lg bg-info-soft p-3 text-sm text-info"
                data-testid="kept-result"
              >
                Opened from {opened.data.name ?? 'a saved scenario'}
                {opened.data.plan ? `, saved to ${opened.data.plan.name}` : ''}. This is the result
                kept then; Calculate again to work it out with today&apos;s tables.
              </p>
            ) : null}
            {stale ? (
              <p
                role="status"
                data-testid="calc-stale"
                className="mb-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
              >
                The inputs changed after this result. It is out of date: Calculate again before you
                save it.
              </p>
            ) : null}
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
                <Button disabled={stale} onClick={() => void save()}>
                  Save Scenario
                </Button>
              </div>
            ) : null}
            {result && result.differenceCents !== null && !stale ? (
              <div className="mt-3 flex flex-col gap-2" data-testid="save-to-plan">
                {clientId ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-40 flex-1">
                      <Select
                        label="Plan"
                        value={planId}
                        onChange={(e) => setPlanId(e.target.value)}
                        options={[
                          {
                            value: '',
                            label: livePlans.length
                              ? 'Choose a plan…'
                              : 'This client has no open plan',
                          },
                          ...livePlans.map((p) => ({
                            value: p.id,
                            label: `${p.name} (${p.planYear})`,
                          })),
                        ]}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!planId}
                      onClick={() => void save(planId)}
                    >
                      Save to Plan
                    </Button>
                    <Button variant="secondary" disabled={!planId} onClick={() => setAdding(true)}>
                      Add as Strategy
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Choose the client above to save this scenario to one of their plans or add it as
                    a strategy.
                  </p>
                )}
              </div>
            ) : null}
          </section>
          <section className={card} aria-label="How this is worked out" data-testid="methodology">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">
              How This Is Worked Out
            </h2>
            {/* C21 (Review 2): the method and what it checks, before anyone relies on a figure. */}
            <ul className="list-disc pl-5 text-sm text-text">
              <li>
                Federal ordinary income tax for the tax year chosen, from that year&apos;s brackets
                and standard deduction for the filing status (the larger of the standard deduction
                and the itemized deductions entered).
              </li>
              <li>
                The baseline is worked out from the income, adjustments, deductions and credits
                entered; the scenario subtracts the strategy amounts and adds the extra credit. The
                saving is the difference.
              </li>
              <li>
                Checked: 401(k) and HSA (self-only) contributions over the year&apos;s limit, and
                Section 179 or home office deductions without business income, are flagged.
              </li>
              <li>
                Not checked: other limits, phase-outs, overlap between strategies, self-employment
                tax, the QBI deduction, AMT and state tax. Capital gains make the result
                unavailable.
              </li>
            </ul>
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
                  <button
                    type="button"
                    className="text-left font-medium text-link"
                    data-testid="open-scenario"
                    onClick={() => router.replace(`${pathname}?scenario=${s.id}`)}
                  >
                    {s.name ?? 'Scenario'} · {s.taxYear}
                    {s.plan ? ` · ${s.plan.name}` : ''}
                  </button>
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
      {adding && result && result.differenceCents !== null ? (
        <AddAsStrategy
          planName={livePlans.find((p) => p.id === planId)?.name ?? ''}
          savingCents={result.differenceCents}
          taxYear={Number(taxYear)}
          onClose={() => setAdding(false)}
          onAdd={async (strategyName, category) => {
            try {
              await api.taxPlanning.addStrategy(planId, {
                kind: 'CUSTOM',
                name: strategyName,
                category: category as never,
                estimatedSavingsCents: result.differenceCents,
                assumptions:
                  `From the Tax Savings Calculator (${taxYear}). ${result.assumptions.join(' ')}`.slice(
                    0,
                    2000,
                  ),
              });
              // The scenario is kept with the plan too, as a snapshot.
              await save(planId);
              setAdding(false);
              setMessage({ text: `${strategyName} added to the plan.`, tone: 'success' });
            } catch (e) {
              setMessage({ text: errorMessage(e, TP_ERRORS), tone: 'error' });
            }
          }}
        />
      ) : null}
    </TpShell>
  );
}

/** C21 (Review 2): the calculated saving as a named strategy in one of the client's plans. */
function AddAsStrategy({
  planName,
  savingCents,
  taxYear,
  onClose,
  onAdd,
}: {
  planName: string;
  savingCents: number;
  taxYear: number;
  onClose: () => void;
  onAdd: (name: string, category: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('RETIREMENT');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Add as Strategy"
      subtitle={`To ${planName}: about ${moneyExact(savingCents)} estimated saving for ${taxYear}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              await onAdd(name.trim(), category);
              setBusy(false);
            }}
          >
            Add Strategy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-as-strategy">
        <Input
          label="Strategy name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </div>
    </Modal>
  );
}
