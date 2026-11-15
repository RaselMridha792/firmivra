import type { AdvisoryWorkstream, Engagement } from '@firmivra/types';
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
const workstream = (id: string, serviceId: string, status: AdvisoryWorkstream['status']) => ({
  id,
  serviceId,
  serviceName: 'Growth Strategy',
  status,
});

describe('advisoryEngagements', () => {
  it("maps advisory services to the client's engagements: the documents API takes engagement ids", () => {
    const got = advisoryEngagements(
      [
        engagement('e-active', 'svc-growth', 'ACTIVE'),
        engagement('e-done', 'svc-growth', 'COMPLETED'),
        engagement('e-tax', 'svc-tax', 'ACTIVE'),
      ],
      [workstream('w-growth', 'svc-growth', 'IN_PROGRESS')],
    );
    expect([...got.ids]).toEqual(['e-active', 'e-done']);
    expect(got.open).toEqual([
      { serviceId: 'e-active', serviceName: 'Growth Strategy: Fake engagement' },
    ]);
    expect(got.all).toHaveLength(2);
  });

  it('A-12: a service under way with no engagement can take files; it starts on the first one', () => {
    const got = advisoryEngagements(
      [engagement('e-done', 'svc-growth', 'COMPLETED')],
      [
        workstream('w-growth', 'svc-growth', 'ACCEPTED'),
        workstream('w-web', 'svc-web', 'INTERESTED'),
        workstream('w-old', 'svc-old', 'COMPLETED'),
      ],
    );
    expect(got.open).toEqual([
      {
        serviceId: 'workstream:w-growth',
        serviceName: 'Growth Strategy',
        workstreamId: 'w-growth',
      },
    ]);
  });

  it('offers nothing to file to when no advisory service is under way or active', () => {
    const got = advisoryEngagements(
      [engagement('e-done', 'svc-growth', 'COMPLETED')],
      [workstream('w-growth', 'svc-growth', 'PROPOSED')],
    );
    expect(got.open).toEqual([]);
  });
});
