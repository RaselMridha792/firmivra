// Tax Returns Review Two F03 and F06 (R56, Nov 20; migration r56_task_appointment_tax_return): a task
// and an appointment can name the exact tax return they are about, one of the firm's own (composite
// same-firm key), with or without the return's service. Deleting the return only clears the link.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const urls = inject('dbUrls');
const { owner, db } = connect(urls);
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
let nextHour = 0;
const slot = () => {
  const startsAt = new Date(Date.UTC(2033, 0, 1) + nextHour++ * 7_200_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};
/** A return of the firm's client, with no service (as one made by Create New Return). */
const taxReturn = (businessId: string, clientId: string, taxYear = 2025) =>
  runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const r = await tx.taxReturn.create({
      data: { businessId, clientId, taxYear, filingType: 'INDIVIDUAL' },
      select: { id: true },
    });
    return r.id;
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56tar');
});

describe('a task names its return', () => {
  it('links one of the firm’s returns that has no service, and tells two returns apart', async () => {
    const [r2024, r2025] = [
      await taxReturn(f.firmA, f.clientA, 2024),
      await taxReturn(f.firmA, f.clientA, 2025),
    ];
    const task = await A().task.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        title: 'Fix the 2025 return (fake)',
        taxReturnId: r2025,
      },
      select: { id: true, taxReturnId: true, engagementId: true },
    });
    expect(task).toMatchObject({ taxReturnId: r2025, engagementId: null });
    expect(task.taxReturnId).not.toBe(r2024);
  });

  it("refuses another firm's return", async () => {
    const theirs = await taxReturn(f.firmB, f.clientB);
    expect(
      await failure(
        A().task.create({
          data: { businessId: f.firmA, clientId: f.clientA, title: 'x', taxReturnId: theirs },
        }),
      ),
    ).toMatch(/foreign key|23503/i);
    expect(
      await failure(
        A().task.create({
          data: { businessId: f.firmA, clientId: f.clientA, title: 'x', taxReturnId: randomUUID() },
        }),
      ),
    ).toMatch(/foreign key|23503/i);
  });
});

describe('an appointment names its return', () => {
  it('links one of the firm’s returns, and refuses another firm’s', async () => {
    const mine = await taxReturn(f.firmA, f.clientA, 2023);
    const a = await A().appointment.create({
      data: {
        businessId: f.firmA,
        staffUserId: f.memberA,
        clientId: f.clientA,
        locationKind: 'VIDEO',
        taxReturnId: mine,
        ...slot(),
      },
      select: { taxReturnId: true },
    });
    expect(a.taxReturnId).toBe(mine);
    const theirs = await taxReturn(f.firmB, f.clientB, 2023);
    expect(
      await failure(
        A().appointment.create({
          data: {
            businessId: f.firmA,
            staffUserId: f.memberA,
            clientId: f.clientA,
            locationKind: 'VIDEO',
            taxReturnId: theirs,
            ...slot(),
          },
        }),
      ),
    ).toMatch(/foreign key|23503/i);
  });
});

describe('deleting a return', () => {
  it('only clears the links; the task and the appointment stay', async () => {
    const gone = await taxReturn(f.firmA, f.clientA, 2022);
    const task = await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Kept (fake)', taxReturnId: gone },
      select: { id: true },
    });
    const appt = await A().appointment.create({
      data: {
        businessId: f.firmA,
        staffUserId: f.memberA,
        clientId: f.clientA,
        locationKind: 'VIDEO',
        taxReturnId: gone,
        ...slot(),
      },
      select: { id: true },
    });
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.taxReturn.delete({ where: { id: gone } }),
    );
    await expect(
      A().task.findUniqueOrThrow({ where: { id: task.id }, select: { taxReturnId: true } }),
    ).resolves.toEqual({ taxReturnId: null });
    await expect(
      A().appointment.findUniqueOrThrow({ where: { id: appt.id }, select: { taxReturnId: true } }),
    ).resolves.toEqual({ taxReturnId: null });
  });
});
