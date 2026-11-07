// D4's card rule (packages/types/src/dashboard/cards.ts), as the API and Settings apply it: a
// service, a metric, a status and a label that fit together, and a label that never disguises
// what the card counts. Synthetic values only.
import { dashboardCardProblem, DEFAULT_DASHBOARD_CARDS } from '@firmivra/types';
import { describe, expect, it } from 'vitest';

const card = (over: Partial<Parameters<typeof dashboardCardProblem>[0]>) =>
  dashboardCardProblem({
    serviceKind: 'BOOKKEEPING',
    metric: 'ENGAGEMENTS_IN_STATUS',
    statusKey: 'engagement:ACTIVE',
    label: 'Active Bookkeeping',
    ...over,
  });

describe('dashboardCardProblem', () => {
  it('takes the cards that fit, the defaults among them', () => {
    expect(card({})).toBeNull();
    expect(card({ metric: 'ACTIVE_ENGAGEMENTS', statusKey: null })).toBeNull();
    expect(
      card({ metric: 'COMPLETED_IN_PERIOD', statusKey: 'engagement:COMPLETED', label: 'Done' }),
    ).toBeNull();
    for (const serviceKind of [null, 'ANNUAL_TAX', 'QUARTERLY_TAX'] as const) {
      expect(
        card({ serviceKind, statusKey: 'tax:READY_TO_FILE', label: 'Ready to File Returns' }),
      ).toBeNull();
    }
    for (const d of DEFAULT_DASHBOARD_CARDS) {
      expect(card({ serviceKind: null, ...d })).toBeNull();
    }
  });

  it('names what is missing or does not fit', () => {
    expect(card({ serviceKind: null, metric: 'ACTIVE_ENGAGEMENTS', statusKey: null })).toBe(
      'SERVICE_REQUIRED',
    );
    expect(card({ serviceKind: null })).toBe('SERVICE_REQUIRED');
    expect(card({ metric: 'ACTIVE_ENGAGEMENTS' })).toBe('STATUS_NOT_ALLOWED');
    expect(card({ statusKey: null })).toBe('STATUS_REQUIRED');
    // Completed in the period: only what the lists can show by date.
    expect(card({ metric: 'COMPLETED_IN_PERIOD', statusKey: 'engagement:ACTIVE' })).toBe(
      'STATUS_NOT_ALLOWED',
    );
    expect(
      card({ metric: 'COMPLETED_IN_PERIOD', statusKey: 'tax:TRANSMITTED', serviceKind: null }),
    ).toBe('STATUS_NOT_ALLOWED');
    // A tax status goes with a tax service or none: Tax Planning is not one.
    expect(
      card({ serviceKind: 'TAX_PLANNING', statusKey: 'tax:ACCEPTED', label: 'Accepted' }),
    ).toBe('STATUS_NOT_FOR_SERVICE');
  });

  it('refuses a label that names tax returns on another count, or hides a tax count', () => {
    for (const label of ['Accepted Returns', 'Tax Clients', 'E-file Queue', 'Filed']) {
      expect(card({ label }), label).toBe('LABEL_MISMATCH');
    }
    expect(
      card({ serviceKind: null, statusKey: 'tax:IN_PROGRESS', label: 'Active Bookkeeping' }),
    ).toBe('LABEL_MISMATCH');
    // Words that only contain a tax word are fine ("Syntax", "Taxonomy" are not "tax").
    expect(card({ label: 'Syntax Review' })).toBeNull();
  });
});
