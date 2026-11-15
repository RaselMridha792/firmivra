// Appointments Review 2, approved addition A2 (R56; the lead's approval under Rasel's db
// delegation, Nov 15; migration r56_appointment_equipment): equipment, one row per physical item,
// booked with an appointment. Two live appointments never hold one item at the same time, as for
// rooms. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let officeA = '';
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const hour = (h: number) => new Date(Date.UTC(2034, 2, 6, h, 0));

const item = (name = `Fake projector ${randomUUID().slice(0, 6)}`, data: object = {}) =>
  A().firmEquipment.create({ data: { businessId: f.firmA, name, ...data } });
/** An appointment of a new client of its own, so only the item can clash. */
const book = async (from: number, to: number, staff: 'A' | 'A2' = 'A') => {
  const client = await A().client.create({
    data: { businessId: f.firmA, displayName: `Fake client ${randomUUID().slice(0, 6)}` },
  });
  return A().appointment.create({
    data: {
      businessId: f.firmA,
      staffUserId: staff === 'A' ? f.memberA : f.member2A,
      clientId: client.id,
      locationKind: 'VIDEO',
      startsAt: hour(from),
      endsAt: hour(to),
    },
  });
};
const cancel = (id: string) =>
  A().appointment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
const hold = (appointmentId: string, equipmentId: string) =>
  A().appointmentEquipment.create({
    data: { businessId: f.firmA, appointmentId, equipmentId },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56eq');
  officeA = (
    await A().firmOffice.create({
      data: { businessId: f.firmA, name: `Fake office ${randomUUID().slice(0, 6)}` },
    })
  ).id;
});

describe('equipment', () => {
  it('has a name with words, unique among the live items ignoring case, and an optional office', async () => {
    const name = `Fake pad ${randomUUID().slice(0, 6)}`;
    const first = await item(name, { officeId: officeA, description: 'Fake: for e-signing' });
    expect(first).toMatchObject({ officeId: officeA, archivedAt: null });
    expect(await failure(item(name.toUpperCase()))).toMatch(/firm_equipment_live_name|Unique/i);
    // Archived, its name is free again.
    await A().firmEquipment.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    expect((await item(name.toUpperCase())).officeId).toBeNull();
    for (const bad of ['   ', 'x'.repeat(101)]) {
      expect(await failure(item(bad))).toMatch(/firm_equipment_name/);
    }
    expect(await failure(item(undefined, { description: 'x'.repeat(501) }))).toMatch(
      /firm_equipment_description/,
    );
  });

  it('two live appointments never hold one item at once; a cancel frees it; a move is checked again', async () => {
    const e = await item();
    const ten = await book(10, 11);
    const held = await hold(ten.id, e.id);
    // The time is the appointment's, whatever was sent.
    expect([held.startsAt, held.endsAt, held.live]).toEqual([hour(10), hour(11), true]);
    const overlap = await book(10, 12, 'A2');
    expect(await failure(hold(overlap.id, e.id))).toMatch(
      /appointment_equipment_no_double_booking/,
    );
    await cancel(overlap.id);
    // Back to back is fine.
    const eleven = await book(11, 12, 'A2');
    await hold(eleven.id, e.id);
    // Cancelled, the item is free at that time again.
    await cancel(ten.id);
    const freed = await A().appointmentEquipment.findFirst({ where: { appointmentId: ten.id } });
    expect(freed?.live).toBe(false);
    const again = await book(10, 11);
    await hold(again.id, e.id);
    // Moving an appointment onto the item's other booking is refused, and nothing moves.
    expect(
      await failure(
        A().appointment.update({
          where: { id: eleven.id },
          data: { startsAt: hour(10), endsAt: hour(11) },
        }),
      ),
    ).toMatch(/appointment_equipment_no_double_booking/);
    const kept = await A().appointment.findUniqueOrThrow({ where: { id: eleven.id } });
    expect(kept.startsAt).toEqual(hour(11));
    // A move to a free time takes the item with it.
    await A().appointment.update({
      where: { id: eleven.id },
      data: { startsAt: hour(14), endsAt: hour(15) },
    });
    const moved = await A().appointmentEquipment.findFirst({ where: { appointmentId: eleven.id } });
    expect([moved?.startsAt, moved?.endsAt]).toEqual([hour(14), hour(15)]);
  });

  it("can't be deleted while booked; released, it can", async () => {
    const e = await item();
    const a = await book(16, 17);
    await hold(a.id, e.id);
    expect(await failure(A().firmEquipment.delete({ where: { id: e.id } }))).toMatch(
      /Foreign key|foreign key/i,
    );
    await A().appointmentEquipment.delete({
      where: {
        businessId_appointmentId_equipmentId: {
          businessId: f.firmA,
          appointmentId: a.id,
          equipmentId: e.id,
        },
      },
    });
    await A().firmEquipment.delete({ where: { id: e.id } });
    expect(await A().firmEquipment.count({ where: { id: e.id } })).toBe(0);
  });

  it("is each firm's own: another firm reads none, and no firm books another's item", async () => {
    const e = await item();
    expect(await B().firmEquipment.findMany({ where: { id: e.id } })).toEqual([]);
    const theirs = await B().firmEquipment.create({
      data: { businessId: f.firmB, name: `Fake B item ${randomUUID().slice(0, 6)}` },
    });
    const a = await book(18, 19);
    expect(await failure(hold(a.id, theirs.id))).toMatch(/Foreign key|foreign key/i);
    expect(
      await failure(B().firmEquipment.create({ data: { businessId: f.firmA, name: 'Fake' } })),
    ).toMatch(/row-level security/);
  });
});
