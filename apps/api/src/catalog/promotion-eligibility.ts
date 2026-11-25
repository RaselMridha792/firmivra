import type { PromotionCheckResult } from '@firmivra/types';

/** A promotion as its rules see it (the row, with its targets). */
export interface PromotionRules {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  startsAt: Date | null;
  endsAt: Date | null;
  appliesTo: 'ALL' | 'CATEGORIES' | 'SERVICES' | 'PACKAGES';
  targets: { categoryId: string | null; serviceId: string | null; packageId: string | null }[];
  allowStacking: boolean;
  discountType: 'PERCENT' | 'FIXED';
  /** 0 to 100. */
  discountPercent: number | null;
  discountCents: number | null;
}

/** What a promotion is tried on: one of the firm's services or packages, at its current price. */
export interface PromotionItem {
  kind: 'SERVICE' | 'PACKAGE';
  id: string;
  categoryId: string | null;
  /** Null while it is quoted. */
  priceCents: number | null;
}

/** Why the promotion does not cover the item, or null when it does. ALL covers everything. */
export function coverageMiss(
  p: Pick<PromotionRules, 'appliesTo' | 'targets'>,
  item: PromotionItem,
): 'WRONG_CATEGORY' | 'WRONG_SERVICE' | 'WRONG_PACKAGE' | null {
  switch (p.appliesTo) {
    case 'ALL':
      return null;
    case 'CATEGORIES':
      return item.categoryId !== null && p.targets.some((t) => t.categoryId === item.categoryId)
        ? null
        : 'WRONG_CATEGORY';
    case 'SERVICES':
      return item.kind === 'SERVICE' && p.targets.some((t) => t.serviceId === item.id)
        ? null
        : 'WRONG_SERVICE';
    case 'PACKAGES':
      return item.kind === 'PACKAGE' && p.targets.some((t) => t.packageId === item.id)
        ? null
        : 'WRONG_PACKAGE';
  }
}

const live = (p: Pick<PromotionRules, 'status' | 'startsAt' | 'endsAt'>, now: Date) =>
  p.status === 'ACTIVE' && (!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt > now);

/** The amount off a price: a percentage rounded to the cent, a fixed amount never past $0 (R3). */
export function discountOff(p: PromotionRules, priceCents: number | null): number | null {
  if (priceCents === null) return null;
  return p.discountType === 'PERCENT'
    ? Math.round((priceCents * (p.discountPercent ?? 0)) / 100)
    : Math.min(p.discountCents ?? 0, priceCents);
}

/**
 * Services & Pricing Review Two R9/R13 (decided Nov 19): one rule for whether a promotion applies
 * to a service or package at a moment. "Check a Code" uses it now, and redemption at payment will
 * use it too. Decided in order, so the answer is the first that fails: live (not a draft or
 * ended), started, not expired, covers the item, and stacks with every promotion that already
 * applies to the item by itself (`automatic`: live, without a code). Who the client is
 * (eligibility) is not part of it: there is no client in a check.
 */
export function promotionEligibility(
  p: PromotionRules,
  item: PromotionItem,
  now: Date,
  automatic: PromotionRules[],
): {
  result: PromotionCheckResult;
  discountCents: number | null;
  conflict: { id: string; name: string } | null;
} {
  const no = (result: PromotionCheckResult, conflict: { id: string; name: string } | null = null) =>
    ({ result, discountCents: null, conflict }) as const;
  if (p.status !== 'ACTIVE') return no('NOT_ACTIVE');
  if (p.startsAt && p.startsAt > now) return no('NOT_STARTED');
  if (p.endsAt && p.endsAt <= now) return no('EXPIRED');
  const miss = coverageMiss(p, item);
  if (miss) return no(miss);
  const clash = automatic.find(
    (o) =>
      o.id !== p.id &&
      live(o, now) &&
      coverageMiss(o, item) === null &&
      !(o.allowStacking && p.allowStacking),
  );
  if (clash) return no('DOES_NOT_STACK', { id: clash.id, name: clash.name });
  return { result: 'APPLIES', discountCents: discountOff(p, item.priceCents), conflict: null };
}
