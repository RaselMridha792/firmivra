const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Whole dollars from integer cents ("$16,100"). */
export const formatCents = (cents: number): string => dollars.format(cents / 100);

/** "22%" or "22.4%": the rate as a fraction in, a percentage out. */
export const formatRate = (rate: number, digits = 0): string => `${(rate * 100).toFixed(digits)}%`;
