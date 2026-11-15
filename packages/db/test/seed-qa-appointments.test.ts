// QA seed part 4 (R1, Nov 14; Dashboard Review 2 A1 to A4): Test Firm B's upcoming appointments.
// Twelve SCHEDULED appointments with the firm's active Owner over the next 2 to 16 days, none
// overlapping, each already marked reminded so the reminder job never mails them, for one client
// whose email is the SES simulator's. Runs twice without a second row; another firm sees none of
// it. Seeds the test database as the owner role.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import {
  QA_APPOINTMENTS_EMAIL,
  qaAppointmentsId,
  seedQaAppointments,
} from '../prisma/seed-qa-appointments.js';
import { connect } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let firmB = '';
let other = '';
const now = new Date();

const firm = (slug: string) =>
  runInScope(owner, { kind: 'platform' }, async (tx) => {
    const found = await tx.business.findUnique({ where: { slug }, select: { id: true } });
    return (
      found ??
      (await tx.business.create({
        data: { slug, name: `${slug} (test)`, status: 'ACTIVE' },
        select: { id: true },
      }))
    ).id;
  });

beforeAll(async () => {
  firmB = await firm('test-firm-b');
  other = await firm('lvp');
  const stamp = randomUUID();
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: stamp,
        cognitoSub: stamp,
        pool: 'STAFF',
        email: `o-${stamp}@qa4.test`,
        name: 'QA4 Owner (fake)',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: firmB }, async (tx) => {
    if (
      !(await tx.membership.findFirst({
        where: { businessId: firmB, role: 'OWNER', status: 'ACTIVE' },
      }))
    ) {
      await tx.membership.create({
        data: { businessId: firmB, userId: stamp, role: 'OWNER', status: 'ACTIVE' },
      });
    }
  });
});

describe('QA seed part 4: Test Firm B appointments', () => {
  it('seeds twelve upcoming appointments once, none ever picked by the reminder job', async () => {
    // A test database kept from an earlier day rolls its rows first.
    expect(['seeded', 'rolled', 'already']).toContain(await seedQaAppointments(owner, now));
    expect(await seedQaAppointments(owner, now)).toBe('already');
    const B = db.forBusiness(firmB);
    const ids = Array.from({ length: 12 }, (_, i) => qaAppointmentsId(i + 1));
    const rows = await B.appointment.findMany({
      where: { id: { in: ids } },
      orderBy: { startsAt: 'asc' },
      select: {
        startsAt: true,
        endsAt: true,
        status: true,
        reminderSentAt: true,
        staffUserId: true,
        client: { select: { email: true } },
      },
    });
    expect(rows).toHaveLength(12);
    const owners = await B.membership.findMany({
      where: { businessId: firmB, role: 'OWNER', status: 'ACTIVE' },
      select: { userId: true },
    });
    for (const [i, r] of rows.entries()) {
      expect(r.status).toBe('SCHEDULED');
      expect(r.startsAt.getTime()).toBeGreaterThan(now.getTime() + 24 * 3_600_000);
      expect(r.reminderSentAt).not.toBeNull();
      expect(r.client.email).toBe(QA_APPOINTMENTS_EMAIL);
      expect(owners.map((o) => o.userId)).toContain(r.staffUserId);
      // One after the other: none overlaps the next.
      const next = rows[i + 1];
      if (next) expect(next.startsAt.getTime()).toBeGreaterThanOrEqual(r.endsAt.getTime());
    }
    // The reminder job's own selection finds none of them.
    expect(
      await B.appointment.count({
        where: { id: { in: ids }, status: 'SCHEDULED', reminderSentAt: null },
      }),
    ).toBe(0);
  });

  it('rolls: once one has gone past, a re-run puts them back on the plan from today, ours only', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => qaAppointmentsId(i + 1));
    const set = (where: object, data: object) =>
      runInScope(owner, { kind: 'business', businessId: firmB }, (tx) =>
        tx.appointment.updateMany({ where: { businessId: firmB, ...where }, data }),
      );
    // Thirty days on: every row is in the past (two hours apart: no double booking). Moving them
    // clears their reminders, as a reschedule does.
    const past = new Date(now.getTime() - 30 * 24 * 3_600_000);
    for (const [i, one] of ids.entries()) {
      const at = past.getTime() + i * 2 * 3_600_000;
      await set({ id: one }, { startsAt: new Date(at), endsAt: new Date(at + 3_600_000) });
    }
    // Firm B's own appointment, not one of ours: it never moves.
    const seeded = await db.forBusiness(firmB).appointment.findFirstOrThrow({
      where: { id: ids[0] },
      select: { clientId: true, staffUserId: true },
    });
    const theirs = randomUUID();
    const theirsAt = new Date(now.getTime() - 60 * 24 * 3_600_000);
    await runInScope(owner, { kind: 'business', businessId: firmB }, (tx) =>
      tx.appointment.create({
        data: {
          id: theirs,
          businessId: firmB,
          clientId: seeded.clientId,
          staffUserId: seeded.staffUserId,
          startsAt: theirsAt,
          endsAt: new Date(theirsAt.getTime() + 3_600_000),
          locationKind: 'PHONE',
        },
      }),
    );

    expect(await seedQaAppointments(owner, now)).toBe('rolled');
    expect(await seedQaAppointments(owner, now)).toBe('already');
    const B = db.forBusiness(firmB);
    const rows = await B.appointment.findMany({
      where: { id: { in: ids } },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true, endsAt: true, status: true, reminderSentAt: true },
    });
    expect(rows).toHaveLength(12);
    for (const [i, r] of rows.entries()) {
      expect(r.status).toBe('SCHEDULED');
      expect(r.startsAt.getTime()).toBeGreaterThan(now.getTime() + 24 * 3_600_000);
      expect(r.startsAt.getTime()).toBeLessThan(now.getTime() + 17 * 24 * 3_600_000);
      // Marked reminded again: the reminder job never mails them.
      expect(r.reminderSentAt).not.toBeNull();
      const next = rows[i + 1];
      if (next) expect(next.startsAt.getTime()).toBeGreaterThanOrEqual(r.endsAt.getTime());
    }
    const kept = await B.appointment.findFirstOrThrow({
      where: { id: theirs },
      select: { startsAt: true },
    });
    expect(kept.startsAt.getTime()).toBe(theirsAt.getTime());
  });

  it("is Test Firm B's own: another firm sees none of it", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => qaAppointmentsId(i));
    expect(await db.forBusiness(other).appointment.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await db.forBusiness(other).client.count({ where: { id: qaAppointmentsId(0) } })).toBe(
      0,
    );
  });
});
