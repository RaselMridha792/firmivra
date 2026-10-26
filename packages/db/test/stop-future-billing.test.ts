// Octavia's SH10 / PY-F13 (R1, Oct 26; migration r1_stop_future_billing): Stop Future Billing on a
// client's service, a flag with its stop date, set together or not at all. Existing services keep
// billing. A firm never changes another firm's service. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let engagementA = '';
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const save = (data: Record<string, unknown>) =>
  A().engagement.update({ where: { id: engagementA }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1sfb');
  engagementA = await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId: f.firmA, kind: 'PAYROLL', name: 'Payroll' },
    });
    const engagement = await tx.engagement.create({
      data: { businessId: f.firmA, clientId: f.clientA, serviceId: service.id, title: 'Payroll' },
    });
    return engagement.id;
  });
});

describe('Stop Future Billing', () => {
  it('is off with no date for a service, as before', async () => {
    await expect(A().engagement.findUnique({ where: { id: engagementA } })).resolves.toMatchObject({
      stopFutureBilling: false,
      billingStopsOn: null,
    });
  });

  it('takes the flag and its stop date together, or neither', async () => {
    expect(await failure(save({ stopFutureBilling: true }))).toMatch(/check constraint/i);
    expect(await failure(save({ billingStopsOn: new Date('2026-11-01') }))).toMatch(
      /check constraint/i,
    );
    await expect(
      save({ stopFutureBilling: true, billingStopsOn: new Date('2026-11-01') }),
    ).resolves.toMatchObject({ stopFutureBilling: true });
    await expect(save({ stopFutureBilling: false, billingStopsOn: null })).resolves.toMatchObject({
      stopFutureBilling: false,
      billingStopsOn: null,
    });
  });
});

describe('isolation', () => {
  it("firm B cannot see or stop firm A's billing", async () => {
    expect(await B().engagement.findMany({ where: { id: engagementA } })).toEqual([]);
    const { count } = await B().engagement.updateMany({
      where: { id: engagementA },
      data: { stopFutureBilling: true, billingStopsOn: new Date('2026-11-01') },
    });
    expect(count).toBe(0);
  });
});
