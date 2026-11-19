import type { DiscountProblem, DiscountType } from '@firmivra/types';

// As catalog-shared's `money`; kept here so these rules load without the screen's components.
const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Services & Pricing Review Two R1-R3 and Q1 (decided Nov 19), shared by Create Package and Edit
 * Package. A discount is never negative, a percentage is at most 100%, and a fixed amount is at
 * most the included services' total (a $0 package is fine). A typed price wins: the discount then
 * turns off, and a discount works out the price only when no price is typed, so a package is never
 * discounted twice.
 */
export const PRICE_INCLUDES_DISCOUNT = 'The price you entered already includes any discount.';
export const PRICE_FROM_DISCOUNT = 'Worked out from the discount. Choose None to enter a price.';

/** The ids the error summary focuses. */
export const FIELD_ID = {
  name: 'package-name-field',
  categoryId: 'package-category-field',
  discountValue: 'package-discount-value',
} as const;

export const DISCOUNT_PROBLEM_TEXT: Record<DiscountProblem, string> = {
  NEGATIVE: 'The discount cannot be negative.',
  OVER_100: 'Use a percentage of 100% or less.',
  MORE_THAN_TOTAL:
    'The discount is more than the included services cost. Lower it, or include more services.',
};

/** The API refused the discount (it checks it again with the services' prices at save time). */
export const DISCOUNT_REFUSED =
  'This discount cannot be saved. Use a percentage up to 100%, or an amount no more than the included services cost.';

/**
 * R2: what is wrong with the discount as typed (`raw`: percent or dollars), or null. A fixed
 * amount is checked against the included services' total when that is known.
 */
export function discountFieldError(
  type: DiscountType,
  raw: string,
  totalCents: number | null,
): string | null {
  if (type === 'NONE') return null;
  const text = raw.trim();
  if (text === '') return 'Enter the discount, or choose None.';
  const n = Number(text);
  if (!Number.isFinite(n)) return 'Enter the discount as a number.';
  if (n < 0) return DISCOUNT_PROBLEM_TEXT.NEGATIVE;
  if (n === 0) return 'Enter a discount above 0, or choose None.';
  if (type === 'PERCENTAGE' && n > 100) return DISCOUNT_PROBLEM_TEXT.OVER_100;
  if (type === 'FIXED' && totalCents !== null && Math.round(n * 100) > totalCents)
    return `The discount is more than the included services cost (${money(totalCents)}).`;
  return null;
}
