// The Super Admin small batch (R1, Nov 7; migration r1_sa_small_batch): an invoice is archived,
// never deleted (IP-F10), and another firm never archives it; the integration rollup keeps
// connected firms by plan as whole, non-negative counts (SA-INT-R3). Runs as the app role (invoices,
// under RLS) and in platform scope (the rollup).
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let invoiceId = '';

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1ssb');
  invoiceId = (
    await db.forBusiness(f.firmA).invoice.create({
      data: { businessId: f.firmA, clientId: f.clientA, number: `SSB-${randomUUID().slice(0, 8)}` },
      select: { id: true },
    })
  ).id;
});

describe('an archived invoice (IP-F10)', () => {
  it('is archived, never deleted', async () => {
    const A = db.forBusiness(f.firmA);
    await expect(
      A.invoice.update({
        where: { id: invoiceId },
        data: { archivedAt: new Date() },
        select: { archivedAt: true },
      }),
    ).resolves.toEqual({ archivedAt: expect.any(Date) });
    expect(await failure(A.invoice.delete({ where: { id: invoiceId } }))).toMatch(
      /permission denied/i,
    );
  });

  it("another firm never archives or sees a firm's invoice", async () => {
    const B = db.forBusiness(f.firmB);
    const { count } = await B.invoice.updateMany({
      where: { id: invoiceId },
      data: { archivedAt: null },
    });
    expect(count).toBe(0);
    expect(await B.invoice.findMany({ where: { id: invoiceId } })).toEqual([]);
  });
});

describe('connected firms by plan (SA-INT-R3)', () => {
  const row = (connectedFirmsByPlan?: unknown) =>
    runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformIntegrationUsageDaily.create({
        data: {
          day: new Date('2026-11-07T00:00:00Z'),
          scope: 'CATALOG',
          subjectKey: `ssb-${randomUUID()}`,
          ...(connectedFirmsByPlan === undefined
            ? {}
            : { connectedFirmsByPlan: connectedFirmsByPlan as never }),
        },
      }),
    );

  it('starts empty and holds whole, non-negative counts by plan code', async () => {
    await expect(row()).resolves.toMatchObject({ connectedFirmsByPlan: {} });
    await expect(row({ TEAM_PRO: 3, SOLO: 0 })).resolves.toMatchObject({
      connectedFirmsByPlan: { TEAM_PRO: 3, SOLO: 0 },
    });
    for (const bad of [[1, 2], { TEAM_PRO: -1 }, { TEAM_PRO: 1.5 }, { TEAM_PRO: '3' }]) {
      expect(await failure(row(bad)), JSON.stringify(bad)).toMatch(
        /platform_integration_usage_daily_by_plan/,
      );
    }
  });
});
