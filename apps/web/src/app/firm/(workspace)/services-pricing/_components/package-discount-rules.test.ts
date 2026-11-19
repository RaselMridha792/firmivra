import { describe, expect, it } from 'vitest';
import { discountFieldError } from './package-discount-rules';

// Services & Pricing Review Two R2/R3: the discount field's own error, before any request.
describe('discountFieldError', () => {
  it('asks for a discount above 0 once a type is chosen; None needs nothing', () => {
    expect(discountFieldError('NONE', '', null)).toBeNull();
    expect(discountFieldError('PERCENTAGE', '', null)).toBe('Enter the discount, or choose None.');
    expect(discountFieldError('FIXED', '0', 10_000)).toBe(
      'Enter a discount above 0, or choose None.',
    );
    expect(discountFieldError('FIXED', 'ten', 10_000)).toBe('Enter the discount as a number.');
  });

  it('refuses a negative discount and a percentage over 100; 100% is allowed', () => {
    expect(discountFieldError('PERCENTAGE', '-1', null)).toBe('The discount cannot be negative.');
    expect(discountFieldError('PERCENTAGE', '101', null)).toBe('Use a percentage of 100% or less.');
    expect(discountFieldError('PERCENTAGE', '100', null)).toBeNull();
  });

  it('refuses a fixed amount above the included services’ total; the whole total is allowed', () => {
    expect(discountFieldError('FIXED', '250', 20_000)).toBe(
      'The discount is more than the included services cost ($200.00).',
    );
    expect(discountFieldError('FIXED', '200', 20_000)).toBeNull();
    // An unknown total (a quote-required service) is not held against it.
    expect(discountFieldError('FIXED', '250', null)).toBeNull();
  });
});
