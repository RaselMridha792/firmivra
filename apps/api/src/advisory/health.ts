import { createHash } from 'node:crypto';

// The Business Health Score: out of 100, from the firm's own formula (factor weights that add up to
// 100). Every factor has its own 0 to 100 value and a plain explanation, a factor whose data is
// missing has no value and is left out of the score (the others are re-weighted), and the score is
// stored with the factors it was made from, so nothing is opaque.

export interface FactorDef {
  factor: string;
  label: string;
  explanation: string;
}

export const FACTORS: readonly FactorDef[] = [
  {
    factor: 'revenue_trend',
    label: 'Revenue trend',
    explanation:
      'Revenue of the latest period against the one before: no change is 50, +20% or more is 100, -20% or less is 0.',
  },
  {
    factor: 'profit_margin',
    label: 'Profit margin',
    explanation: 'Net profit over revenue of the latest period: a 25% margin or more is 100.',
  },
  {
    factor: 'cash_flow',
    label: 'Cash flow',
    explanation: 'Positive cash flow in the latest period is 100, none is 50, negative is 0.',
  },
  {
    factor: 'debt_ratio',
    label: 'Debt load',
    explanation:
      'Debt over revenue: a quarter of revenue or less is 100, one and a half times or more is 0.',
  },
  {
    factor: 'goal_progress',
    label: 'Goal progress',
    explanation: 'The average progress of the client’s open goals.',
  },
  {
    factor: 'action_completion',
    label: 'Action items done',
    explanation: 'The share of action items done, of those not cancelled.',
  },
  {
    factor: 'budget_variance',
    label: 'Revenue against budget',
    explanation: 'Revenue of the latest period as a share of its budget, up to 100.',
  },
];
export const FACTOR_KEYS = new Set(FACTORS.map((f) => f.factor));
const factorOf = (key: string) => FACTORS.find((f) => f.factor === key);

export const DEFAULT_FORMULA: { factor: string; weight: number }[] = [
  { factor: 'revenue_trend', weight: 20 },
  { factor: 'profit_margin', weight: 20 },
  { factor: 'cash_flow', weight: 10 },
  { factor: 'debt_ratio', weight: 15 },
  { factor: 'goal_progress', weight: 15 },
  { factor: 'action_completion', weight: 10 },
  { factor: 'budget_variance', weight: 10 },
];

/** The formula stored in settings, or the default when none is stored; unknown factors are dropped. */
export function formulaOf(stored: unknown): { factor: string; weight: number }[] {
  const list = Array.isArray(stored) ? stored : [];
  const parsed = list
    .map((x) => x as { factor?: unknown; weight?: unknown })
    .filter(
      (x): x is { factor: string; weight: number } =>
        typeof x.factor === 'string' && typeof x.weight === 'number' && FACTOR_KEYS.has(x.factor),
    );
  return parsed.length > 0 ? parsed : DEFAULT_FORMULA;
}

export interface HealthInput {
  /** The latest period and the one before it (newest first). */
  periods: {
    revenueCents: number | null;
    netProfitCents: number | null;
    cashFlowCents: number | null;
    debtCents: number | null;
    budgetRevenueCents: number | null;
  }[];
  /** The progress of each open goal. */
  goalProgress: number[];
  actionsDone: number;
  actionsCounted: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Each factor's 0 to 100 value, or null when its data is missing. */
export function factorValues(input: HealthInput): Record<string, number | null> {
  const [latest, previous] = input.periods;
  const revenue = latest?.revenueCents ?? null;
  const out: Record<string, number | null> = {};
  out.revenue_trend =
    revenue !== null && previous?.revenueCents != null && previous.revenueCents > 0
      ? clamp(50 + ((revenue - previous.revenueCents) / previous.revenueCents) * 100 * 2.5)
      : null;
  out.profit_margin =
    revenue !== null && revenue > 0 && latest?.netProfitCents != null
      ? clamp((latest.netProfitCents / revenue) * 100 * 4)
      : null;
  out.cash_flow =
    latest?.cashFlowCents == null
      ? null
      : latest.cashFlowCents > 0
        ? 100
        : latest.cashFlowCents === 0
          ? 50
          : 0;
  out.debt_ratio =
    revenue !== null && revenue > 0 && latest?.debtCents != null
      ? clamp(100 - ((latest.debtCents / revenue - 0.25) / 1.25) * 100)
      : null;
  out.goal_progress =
    input.goalProgress.length > 0
      ? clamp(input.goalProgress.reduce((a, b) => a + b, 0) / input.goalProgress.length)
      : null;
  out.action_completion =
    input.actionsCounted > 0 ? clamp((input.actionsDone / input.actionsCounted) * 100) : null;
  out.budget_variance =
    revenue !== null && latest?.budgetRevenueCents != null && latest.budgetRevenueCents > 0
      ? clamp((revenue / latest.budgetRevenueCents) * 100)
      : null;
  return out;
}

export interface StoredFactor {
  factor: string;
  label: string;
  weight: number;
  value: number | null;
  explanation: string | null;
}

/** The score and the factors it was made from: a missing factor is left out and the rest re-weighted. */
export function computeHealth(
  formula: { factor: string; weight: number }[],
  input: HealthInput,
): { score: number | null; factors: StoredFactor[] } {
  const values = factorValues(input);
  const factors: StoredFactor[] = formula.map((f) => ({
    factor: f.factor,
    label: factorOf(f.factor)?.label ?? f.factor,
    weight: f.weight,
    value: values[f.factor] ?? null,
    explanation: factorOf(f.factor)?.explanation ?? null,
  }));
  const used = factors.filter((f) => f.value !== null && f.weight > 0);
  const total = used.reduce((n, f) => n + f.weight, 0);
  const score =
    total > 0 ? clamp(used.reduce((n, f) => n + f.weight * (f.value as number), 0) / total) : null;
  return { score, factors };
}

/** A short fingerprint of the weights a score was made with. */
export const formulaVersion = (factors: { factor: string; weight: number }[]) =>
  createHash('sha1')
    .update(factors.map((f) => `${f.factor}:${f.weight}`).join('|'))
    .digest('hex')
    .slice(0, 8);
