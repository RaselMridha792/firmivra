// Integer money for the calculator engines (internal, not exported from the package). Amounts are
// integer cents; rates are integer basis points. Products of the two are exact integers in
// "cent-basis-points" (1/10,000 of a cent): at most $100,000,000 x 100% = 1e14, far below
// Number.MAX_SAFE_INTEGER (9e15), so plain numbers stay exact and no BigInt is needed.

/** Basis points in 100%. */
export const BPS = 10_000;
/** Cent-basis-points in one cent, and in one dollar. */
export const PER_CENT = BPS;
export const PER_DOLLAR = 100 * BPS;

/** A validated dollar amount (at most 2 decimals, see `CalculatorMoney`) as integer cents. */
export function toCents(dollars: number): number {
  const cents = Math.round(dollars * 100);
  assertWhole(cents);
  return cents;
}

/** `n / d` rounded half up, for whole n >= 0 and d > 0. */
export function divRoundHalfUp(n: number, d: number): number {
  assertWhole(n);
  return Math.floor((2 * n + d) / (2 * d));
}

/** Throws unless `n` is a safe, non-negative whole number (a bug, never a user error). */
export function assertWhole(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not whole money: ${String(n)}`);
}

/** `a - b`, never below zero. */
export const minusFloor0 = (a: number, b: number): number => Math.max(0, a - b);
