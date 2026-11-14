// R55 Appointments A1 (migration r55_appointment_attendees, approved by the lead under Rasel's
// delegation, Nov 15): group appointments. Another client attends an appointment of the same firm;
// never the appointment's own client, at most 20, added or removed only while it is SCHEDULED; an
// appointment's deletion takes its attendees. Runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
let nextHour = 0;
const slot = () => {
  const startsAt = new Date(Date.UTC(2032, 0, 1) + nextHour++ * 7_200_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};
/** A scheduled appointment of firm A's client with member A. */
const appointment = async () =>
  (
    await A().appointment.create({
      data: {
        businessId: f.firmA,
        staffUserId: f.memberA,
        clientId: f.clientA,
        locationKind: 'VIDEO',
        ...slot(),
      },
    })
  ).id;
/** Another client of firm A. */
const client = async () =>
  runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const c = await tx.client.create({
      data: { businessId: f.firmA, displayName: `Fake Attendee ${randomUUID().slice(0, 6)}` },
    });
    return c.id;
  });
const attend = (appointmentId: string, clientId: string) =>
  A().appointmentAttendee.create({
    data: { businessId: f.firmA, appointmentId, clientId, addedByUserId: f.memberA },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r55aa');
});

describe('appointment attendees', () => {
  it('another client of the firm attends, once, never the appointment own client', async () => {
    const appt = await appointment();
    const other = await client();
    await expect(attend(appt, other)).resolves.toMatchObject({ clientId: other });
    expect(await failure(attend(appt, other))).toMatch(/unique|appointment_id_client_id/i);
    expect(await failure(attend(appt, f.clientA))).toMatch(/primary attendee/);
    // An attendee is added or removed, never changed.
    const row = await A().appointmentAttendee.findFirstOrThrow({ where: { appointmentId: appt } });
    expect(
      await failure(
        A().appointmentAttendee.update({
          where: { id: row.id },
          data: { clientId: await client() },
        }),
      ),
    ).toMatch(/never changed/);
  });

  it('takes at most 20', async () => {
    const appt = await appointment();
    for (let n = 0; n < 20; n++) await attend(appt, await client());
    expect(await failure(attend(appt, await client()))).toMatch(/at most 20/);
    expect(await A().appointmentAttendee.count({ where: { appointmentId: appt } })).toBe(20);
  });

  it('changes only while the appointment is scheduled; an ended one keeps its attendees', async () => {
    const appt = await appointment();
    const kept = await client();
    const row = await attend(appt, kept);
    await A().appointment.update({
      where: { id: appt },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect(await failure(attend(appt, await client()))).toMatch(/only a scheduled appointment/);
    expect(await failure(A().appointmentAttendee.delete({ where: { id: row.id } }))).toMatch(
      /keeps its attendees/,
    );
    expect(await A().appointmentAttendee.count({ where: { appointmentId: appt } })).toBe(1);
    // While scheduled, an attendee can be removed.
    const open = await appointment();
    const removable = await attend(open, await client());
    await A().appointmentAttendee.delete({ where: { id: removable.id } });
    expect(await A().appointmentAttendee.count({ where: { appointmentId: open } })).toBe(0);
  });

  it("the appointment's own deletion takes its attendees, even once it ended", async () => {
    const appt = await appointment();
    await attend(appt, await client());
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
      await tx.appointment.update({ where: { id: appt }, data: { status: 'COMPLETED' } });
      await tx.appointment.delete({ where: { id: appt } });
    });
    expect(await A().appointmentAttendee.count({ where: { appointmentId: appt } })).toBe(0);
  });

  it("refuses another firm's client or appointment, and another firm sees none", async () => {
    const appt = await appointment();
    expect(await failure(attend(appt, f.clientB))).toMatch(/foreign key|violates/i);
    const mine = await attend(appt, await client());
    expect(await B().appointmentAttendee.findUnique({ where: { id: mine.id } })).toBeNull();
    expect((await B().appointmentAttendee.deleteMany({ where: { id: mine.id } })).count).toBe(0);
    expect(
      await failure(
        B().appointmentAttendee.create({
          data: { businessId: f.firmA, appointmentId: appt, clientId: f.clientA },
        }),
      ),
      // Refused before the RLS check by the rules: firm A's appointment is invisible in firm B.
    ).toMatch(/row-level security|violates|only a scheduled appointment/i);
  });
});
