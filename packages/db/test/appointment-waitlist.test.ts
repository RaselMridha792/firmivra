// R55 Appointments A3 (migration r55_appointment_waitlist, approved by the lead under Rasel's
// delegation, Nov 15): the appointment waitlist. The firm's switch (off by default) and its one
// mode; an entry is the appointment's own client waiting for an earlier time: one live entry per
// appointment, an offer of an earlier time with all its facts, the status moving forward only.
// Runs as the app role under RLS. Synthetic data only.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
let nextDay = 0;
/** A scheduled appointment of firm A's client, on a day of its own far ahead. */
const appointment = async () => {
  const startsAt = new Date(Date.UTC(2033, 0, 1) + nextDay++ * 86_400_000 * 3);
  const row = await A().appointment.create({
    data: {
      businessId: f.firmA,
      staffUserId: f.memberA,
      clientId: f.clientA,
      locationKind: 'VIDEO',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
    },
  });
  return { id: row.id, startsAt };
};
const join = (appointmentId: string, clientId = f.clientA) =>
  A().appointmentWaitlistEntry.create({
    data: { businessId: f.firmA, appointmentId, clientId },
  });
/** An offer one day before `startsAt`, for a day. */
const offer = (startsAt: Date, hours = -24) => {
  const at = new Date(startsAt.getTime() + hours * 3_600_000);
  const now = new Date();
  return {
    status: 'OFFERED' as const,
    offeredStartsAt: at,
    offeredEndsAt: new Date(at.getTime() + 3_600_000),
    offeredAt: now,
    offerExpiresAt: new Date(now.getTime() + 86_400_000),
  };
};
const update = (id: string, data: object) =>
  A().appointmentWaitlistEntry.update({ where: { id }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r55aw');
});

describe('the appointment waitlist', () => {
  it('is off by default, with staff approval as its mode', async () => {
    const settings = await A().appointmentSettings.create({ data: { businessId: f.firmA } });
    expect(settings).toMatchObject({ waitlistEnabled: false, waitlistMode: 'STAFF_APPROVAL' });
    const appt = await appointment();
    expect(await failure(join(appt.id))).toMatch(/waitlist is off/);
    await A().appointmentSettings.update({
      where: { businessId: f.firmA },
      data: { waitlistEnabled: true },
    });
    await expect(join(appt.id)).resolves.toMatchObject({ status: 'WAITING' });
  });

  it("only the appointment's own client waits, once, while it is scheduled", async () => {
    const appt = await appointment();
    const other = await owner.$transaction(async () =>
      A().client.create({ data: { businessId: f.firmA, displayName: 'Fake Other' } }),
    );
    expect(await failure(join(appt.id, other.id))).toMatch(/only the client/);
    const first = await join(appt.id);
    expect(await failure(join(appt.id))).toMatch(/appointment_waitlist_entries_live|unique/i);
    // Left: a new entry may start.
    await update(first.id, { status: 'LEFT' });
    await expect(join(appt.id)).resolves.toMatchObject({ status: 'WAITING' });
    expect(
      await failure(
        A().appointmentWaitlistEntry.create({
          data: {
            businessId: f.firmA,
            appointmentId: appt.id,
            clientId: f.clientA,
            status: 'OFFERED',
          },
        }),
      ),
    ).toMatch(/starts WAITING/);
    const ended = await appointment();
    await A().appointment.update({
      where: { id: ended.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    expect(await failure(join(ended.id))).toMatch(/only the client/);
  });

  it('an offer is an earlier time, with all its facts', async () => {
    const appt = await appointment();
    const entry = await join(appt.id);
    const { offeredAt: _at, ...partial } = offer(appt.startsAt);
    expect(await failure(update(entry.id, partial))).toMatch(/appointment_waitlist_entries_shape/);
    expect(await failure(update(entry.id, offer(appt.startsAt, 24)))).toMatch(/earlier time/);
    await expect(update(entry.id, offer(appt.startsAt))).resolves.toMatchObject({
      status: 'OFFERED',
    });
    // Taken by someone else: back to WAITING, the offer cleared.
    await expect(
      update(entry.id, {
        status: 'WAITING',
        offeredStartsAt: null,
        offeredEndsAt: null,
        offeredAt: null,
        offerExpiresAt: null,
      }),
    ).resolves.toMatchObject({ status: 'WAITING' });
  });

  it('moves forward only: offered, requested, then moved; an ended entry stays', async () => {
    const appt = await appointment();
    const entry = await join(appt.id);
    // WAITING cannot jump to REQUESTED or MOVED.
    expect(await failure(update(entry.id, { ...offer(appt.startsAt), status: 'MOVED' }))).toMatch(
      /cannot become|shape/,
    );
    await update(entry.id, offer(appt.startsAt));
    expect(await failure(update(entry.id, { status: 'REQUESTED' }))).toMatch(/shape/);
    await update(entry.id, { status: 'REQUESTED', requestedAt: new Date() });
    expect(await failure(update(entry.id, { status: 'MOVED' }))).toMatch(/shape/);
    const moved = await update(entry.id, {
      status: 'MOVED',
      decidedAt: new Date(),
      decidedByUserId: f.memberA,
    });
    expect(moved).toMatchObject({ status: 'MOVED', decidedByUserId: f.memberA });
    expect(await failure(update(entry.id, { status: 'WAITING' }))).toMatch(/cannot become/);
    expect(await failure(update(entry.id, { offerExpiresAt: new Date('2040-01-01') }))).toMatch(
      /ended entry/,
    );
    expect(await failure(update(entry.id, { clientId: f.clientB }))).toMatch(/never change/);
  });

  it("another firm sees none and can't add one to firm A's appointment", async () => {
    const appt = await appointment();
    const entry = await join(appt.id);
    expect(await B().appointmentWaitlistEntry.findUnique({ where: { id: entry.id } })).toBeNull();
    expect(
      (
        await B().appointmentWaitlistEntry.updateMany({
          where: { id: entry.id },
          data: { status: 'LEFT' },
        })
      ).count,
    ).toBe(0);
    expect(
      await failure(
        B().appointmentWaitlistEntry.create({
          data: { businessId: f.firmA, appointmentId: appt.id, clientId: f.clientA },
        }),
      ),
    ).toMatch(/row-level security|violates|only the client|waitlist is off/i);
  });
});
