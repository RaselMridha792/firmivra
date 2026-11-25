// Services & Pricing Review Two R9/R13: one rule for whether a promotion applies to a service or
// package at a moment ("Check a Code" now, redemption at payment later).
import { describe, expect, it } from 'vitest';
import {
  coverageMiss,
  discountOff,
  promotionEligibility,
  type PromotionItem,
  type PromotionRules,
} from '../../src/catalog/promotion-eligibility.js';

const now = new Date('2026-11-19T12:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const promo = (over: Partial<PromotionRules> = {}): PromotionRules => ({
  id: 'p',
  name: 'Fake promo',
  status: 'ACTIVE',
  startsAt: null,
  endsAt: null,
  appliesTo: 'ALL',
  targets: [],
  allowStacking: false,
  discountType: 'PERCENT',
  discountPercent: 10,
  discountCents: null,
  ...over,
});
const target = (t: Partial<PromotionRules['targets'][number]>) => ({
  categoryId: null,
  serviceId: null,
  packageId: null,
  ...t,
});
const service: PromotionItem = { kind: 'SERVICE', id: 's1', categoryId: 'c1', priceCents: 20_000 };
const pkg: PromotionItem = { kind: 'PACKAGE', id: 'k1', categoryId: 'c1', priceCents: 50_000 };
const check = (p: PromotionRules, item = service, automatic: PromotionRules[] = []) =>
  promotionEligibility(p, item, now, automatic).result;

describe('promotionEligibility', () => {
  it('applies a live promotion, with the amount off the item’s price', () => {
    expect(promotionEligibility(promo(), service, now, [])).toEqual({
      result: 'APPLIES',
      discountCents: 2_000,
      conflict: null,
    });
  });

  it('names one reason, in order: not live, not started, expired', () => {
    expect(check(promo({ status: 'DRAFT' }))).toBe('NOT_ACTIVE');
    expect(check(promo({ status: 'INACTIVE' }))).toBe('NOT_ACTIVE');
    expect(check(promo({ startsAt: day('2026-12-01') }))).toBe('NOT_STARTED');
    expect(check(promo({ endsAt: day('2026-11-01') }))).toBe('EXPIRED');
    // A draft that has also expired is reported as not live first.
    expect(check(promo({ status: 'DRAFT', endsAt: day('2026-11-01') }))).toBe('NOT_ACTIVE');
  });

  it('says which kind of target is wrong: category, service or package', () => {
    const cats = promo({ appliesTo: 'CATEGORIES', targets: [target({ categoryId: 'c2' })] });
    expect(check(cats)).toBe('WRONG_CATEGORY');
    expect(check(promo({ appliesTo: 'CATEGORIES', targets: [target({ categoryId: 'c1' })] }))).toBe(
      'APPLIES',
    );
    const svc = promo({ appliesTo: 'SERVICES', targets: [target({ serviceId: 's1' })] });
    expect(check(svc)).toBe('APPLIES');
    expect(check(svc, pkg)).toBe('WRONG_SERVICE');
    const pk = promo({ appliesTo: 'PACKAGES', targets: [target({ packageId: 'k1' })] });
    expect(check(pk, pkg)).toBe('APPLIES');
    expect(check(pk)).toBe('WRONG_PACKAGE');
    expect(coverageMiss(promo(), { ...service, categoryId: null })).toBeNull();
  });

  it('does not stack with a live promotion that already applies by itself, unless both stack', () => {
    const auto = promo({ id: 'a', name: 'Fake automatic' });
    expect(promotionEligibility(promo(), service, now, [auto])).toEqual({
      result: 'DOES_NOT_STACK',
      discountCents: null,
      conflict: { id: 'a', name: 'Fake automatic' },
    });
    expect(
      check(promo({ allowStacking: true }), service, [promo({ id: 'a', allowStacking: true })]),
    ).toBe('APPLIES');
    // One that is not live, or covers something else, is no conflict.
    expect(check(promo(), service, [promo({ id: 'a', endsAt: day('2026-11-01') })])).toBe(
      'APPLIES',
    );
    expect(
      check(promo(), service, [
        promo({ id: 'a', appliesTo: 'SERVICES', targets: [target({ serviceId: 's9' })] }),
      ]),
    ).toBe('APPLIES');
  });

  it('never takes more than the price, and leaves a quoted price unknown (R3)', () => {
    const fixed = promo({ discountType: 'FIXED', discountPercent: null, discountCents: 30_000 });
    expect(discountOff(fixed, 20_000)).toBe(20_000);
    expect(discountOff(promo({ discountPercent: 100 }), 20_000)).toBe(20_000);
    expect(discountOff(promo({ discountPercent: 12.5 }), 999)).toBe(125);
    expect(promotionEligibility(promo(), { ...service, priceCents: null }, now, [])).toEqual({
      result: 'APPLIES',
      discountCents: null,
      conflict: null,
    });
  });
});
