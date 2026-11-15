// QA seed, part 4 (R1, Nov 14; Dashboard Review 2 A1 to A4, the lead's approval under Rasel's
// packages/db delegation until Nov 17, dev only): upcoming appointments for Test Firm B, so the
// dashboard's Upcoming Appointments has rows to open (A2), a menu to try (A3) and a list long
// enough to scroll (A4). One synthetic client and twelve SCHEDULED appointments over the next 2
// to 16 days with Firm B's active Owner, at different times so none overlap.
// Nothing is sent by itself:
// - each appointment's reminder_sent_at is the seed time, so the reminder job (it picks only those
//   with none) never mails them; a reschedule clears it, as for any appointment;
// - the client's email is the SES mailbox simulator's success address (no real inbox, never a
//   bounce), so a manual Send Reminder or a confirmation can do no harm.
// Fixed ids, created once (a re-run adds nothing). Not run when the firm or an active Owner is
// missing.
// Rolling (Dashboard Review 2 A1/A4, R55, Nov 16; the lead's approval under Rasel's packages/db
// delegation): once one of these SCHEDULED appointments has gone past, a re-run puts every one of
// them that is still SCHEDULED back on the plan from the run day (all together, so none overlaps),
// marked reminded again. A cancelled or completed one stays as QA left it. Only these fixed ids
// move; no other row of Test Firm B, and nothing of another firm.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { qaExtraId } from './seed-qa-extra.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

/** Part 4's fixed ids: qaExtraId(900 + n). */
export const qaAppointmentsId = (n: number) => qaExtraId(900 + n);
const id = qaAppointmentsId;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The simulator's success address: the message is accepted and goes nowhere. */
export const QA_APPOINTMENTS_EMAIL = 'success+qa-appointments@simulator.amazonses.com';

/** Days ahead and the hour (UTC) of each appointment, with how it is held. */
const PLAN: [days: number, hourUtc: number, kind: 'VIDEO' | 'PHONE' | 'IN_PERSON'][] = [
  [2, 14, 'VIDEO'],
  [3, 15, 'PHONE'],
  [3, 19, 'IN_PERSON'],
  [4, 16, 'VIDEO'],
  [5, 14, 'PHONE'],
  [6, 18, 'VIDEO'],
  [7, 15, 'IN_PERSON'],
  [8, 17, 'PHONE'],
  [9, 14, 'VIDEO'],
  [10, 16, 'PHONE'],
  [12, 15, 'VIDEO'],
  [16, 14, 'IN_PERSON'],
];

export type QaAppointmentsResult = 'seeded' | 'rolled' | 'already' | 'missing' | 'no-owner';

export async function seedQaAppointments(
  owner: PrismaClient,
  now = new Date(),
): Promise<QaAppointmentsResult> {
  const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: 'test-firm-b' }, select: { id: true } }),
  );
  if (!firm) return 'missing';
  const businessId = firm.id;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  /** The plan's start for row `i` (0-based), counted from the run day. */
  const startOf = (i: number) => {
    const [days, hour] = PLAN[i]!;
    return new Date(today + days * DAY + hour * HOUR);
  };
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    if (await tx.client.findUnique({ where: { id: id(0) } })) {
      const ids = PLAN.map((_, i) => id(i + 1));
      const scheduled = await tx.appointment.findMany({
        where: { businessId, id: { in: ids }, status: 'SCHEDULED' },
        select: { id: true, startsAt: true },
      });
      if (!scheduled.some((a) => a.startsAt.getTime() <= now.getTime())) return 'already';
      // No double booking (a client's or a member's SCHEDULED visits may not overlap): park them
      // apart, in 2000, before each takes its place, so no move lands on another not moved yet.
      const parked = Date.UTC(2000, 0, 1);
      for (const a of scheduled) {
        const at = parked + ids.indexOf(a.id) * 2 * HOUR;
        await tx.appointment.update({
          where: { businessId_id: { businessId, id: a.id } },
          data: { startsAt: new Date(at), endsAt: new Date(at + HOUR) },
        });
      }
      for (const a of scheduled) {
        const startsAt = startOf(ids.indexOf(a.id));
        await tx.appointment.update({
          where: { businessId_id: { businessId, id: a.id } },
          data: { startsAt, endsAt: new Date(startsAt.getTime() + HOUR) },
        });
      }
      // A move clears reminder_sent_at (the database's reschedule trigger): marked reminded again
      // apart, so the reminder job still never mails them.
      await tx.appointment.updateMany({
        where: { businessId, id: { in: scheduled.map((a) => a.id) } },
        data: { reminderSentAt: now },
      });
      return 'rolled';
    }
    const staff = await tx.membership.findFirst({
      where: { businessId, role: 'OWNER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (!staff) return 'no-owner';
    await tx.client.create({
      data: {
        id: id(0),
        businessId,
        displayName: 'QA Appointments Client (fake)',
        email: QA_APPOINTMENTS_EMAIL,
        assignedUserId: staff.userId,
      },
    });
    for (const [i, [, , kind]] of PLAN.entries()) {
      const startsAt = startOf(i);
      await tx.appointment.create({
        data: {
          id: id(i + 1),
          businessId,
          clientId: id(0),
          staffUserId: staff.userId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
          locationKind: kind,
          locationDetails:
            kind === 'VIDEO'
              ? 'https://meet.example.test/qa-appointments'
              : kind === 'IN_PERSON'
                ? 'Main office (fake)'
                : null,
          internalNotes: 'QA fixture for the dashboard review (synthetic).',
          bookedByUserId: staff.userId,
          // The reminder job leaves it alone (it sends only where this is empty).
          reminderSentAt: now,
        },
      });
    }
    return 'seeded';
  });
}
