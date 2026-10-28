// SH9 (Octavia's Oct 25 review: PY-F12; BK-D07): a client's plan is a Services & Pricing
// service, sent by its id (`engagements.catalog_service_id`).
import { describe, expect, it } from 'vitest';
import { AddBookkeepingClientRequest, PayrollPlanRequest } from '../../src/index.js';

const SERVICE = '0199b6a0-0000-7000-8000-000000000003';
const CLIENT = '0199b6a0-0000-7000-8000-000000000004';

describe('PayrollPlanRequest', () => {
  it('takes a catalog service id, or null to clear the plan', () => {
    expect(PayrollPlanRequest.parse({ catalogServiceId: SERVICE })).toEqual({
      catalogServiceId: SERVICE,
    });
    expect(PayrollPlanRequest.parse({ catalogServiceId: null })).toEqual({
      catalogServiceId: null,
    });
  });

  it('still takes the older plan name', () => {
    expect(PayrollPlanRequest.parse({ plan: 'Fake plan' })).toEqual({ plan: 'Fake plan' });
  });

  it('refuses an empty body, an id that is not a uuid and unknown fields', () => {
    expect(PayrollPlanRequest.safeParse({}).success).toBe(false);
    expect(PayrollPlanRequest.safeParse({ catalogServiceId: 'plan-1' }).success).toBe(false);
    expect(PayrollPlanRequest.safeParse({ catalogServiceId: SERVICE, price: 1 }).success).toBe(
      false,
    );
  });
});

describe('AddBookkeepingClientRequest', () => {
  it('takes an optional catalog service id for the plan', () => {
    expect(
      AddBookkeepingClientRequest.parse({ clientId: CLIENT, catalogServiceId: SERVICE }),
    ).toMatchObject({ catalogServiceId: SERVICE });
    expect(AddBookkeepingClientRequest.parse({ clientId: CLIENT })).not.toHaveProperty(
      'catalogServiceId',
    );
    expect(
      AddBookkeepingClientRequest.safeParse({ clientId: CLIENT, catalogServiceId: '' }).success,
    ).toBe(false);
  });
});
