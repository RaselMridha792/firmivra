import type { Engagement } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { advisoryEngagements } from './advisory-engagements';

const engagement = (id: string, serviceId: string, status: Engagement['status']) =>
  ({
    id,
    status,
    title: 'Fake engagement',
    taxYear: null,
    service: { id: serviceId, name: 'Growth Strategy' },
  }) as unknown as Engagement;

describe('advisoryEngagements', () => {
  it("maps advisory services to the client's engagements: the documents API takes engagement ids", () => {
    const got = advisoryEngagements(
      [
        engagement('e-active', 'svc-growth', 'ACTIVE'),
        engagement('e-done', 'svc-growth', 'COMPLETED'),
        engagement('e-tax', 'svc-tax', 'ACTIVE'),
      ],
      [{ serviceId: 'svc-growth' }],
    );
    expect([...got.ids]).toEqual(['e-active', 'e-done']);
    expect(got.open.map((o) => o.serviceId)).toEqual(['e-active']);
    expect(got.all).toHaveLength(2);
  });

  it('offers nothing to file to when no advisory service is active', () => {
    const got = advisoryEngagements(
      [engagement('e-done', 'svc-growth', 'COMPLETED')],
      [{ serviceId: 'svc-growth' }],
    );
    expect(got.open).toEqual([]);
  });
});
