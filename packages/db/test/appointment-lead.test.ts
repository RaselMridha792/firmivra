// P4-1 (R55, Nov 17; Leads Review Two 26 and 17): an appointment for a lead. Migration
// r55_appointment_lead: an appointment has a client, a lead or both (a converted lead's); a
// lead-only one has no engagement or tax plan and is not double booked; its lead never changes, and
// its client is set once, when the lead converts, then fixed; a lead with appointments is not
// deleted. Runs as the app role (RLS on), seeding as the owner. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', staff: randomUUID(), service: '', engagement: '', client: '' };
let nextDay = 0;
/** A fresh day far in the future for each booking, so tests never collide. */
const freshDay = () => new Date(Date.UTC(2031, 0, 1 + nextDay++));
const at = (day: Date, hhmm: string) => new Date(`${day.toISOString().slice(0, 10)}T${hhmm}:00Z`);
const A = () => db.forBusiness(ids.firmA);

const newLead = async () =>
  (
    await A().lead.create({
      data: {
        businessId: ids.firmA,
        serviceId: ids.service,
        firstName: 'Lena',
        lastName: `Lead ${run}`,
        email: `lead-${randomUUID()}@appt.test`,
      },
    })
  ).id;
const book = (
  day: Date,
  data: { leadId?: string; clientId?: string; engagementId?: string },
  from = '15:00',
  to = '15:30',
) =>
  A().appointment.create({
    data: {
      businessId: ids.firmA,
      staffUserId: ids.staff,
      startsAt: at(day, from),
      endsAt: at(day, to),
      locationKind: 'PHONE',
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: ids.staff,
        cognitoSub: ids.staff,
        pool: 'STAFF',
        email: `${ids.staff}@appt.test`,
        name: 'Fake',
      },
    });
    ids.firmA = (await tx.business.create({ data: { slug: `apl-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `apl-b-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.staff, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.service = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
    ids.client = (
      await tx.client.create({ data: { businessId: ids.firmA, displayName: 'Converted (fake)' } })
    ).id;
    ids.engagement = (
      await tx.engagement.create({
        data: {
          businessId: ids.firmA,
          clientId: ids.client,
          serviceId: ids.service,
          title: 'Fake engagement',
        },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('an appointment for a lead (P4-1)', () => {
  it('books a lead without a client; needs a client or a lead; a lead-only one has no engagement', async () => {
    const lead = await newLead();
    const a = await book(freshDay(), { leadId: lead });
    expect(a).toMatchObject({ leadId: lead, clientId: null });
    await expect(book(freshDay(), {})).rejects.toThrow(/appointments_client_or_lead/);
    await expect(book(freshDay(), { leadId: lead, engagementId: ids.engagement })).rejects.toThrow(
      /appointments_client_or_lead/,
    );
  });

  it('never double books a lead; a cancelled one frees the time', async () => {
    const lead = await newLead();
    const day = freshDay();
    const a = await book(day, { leadId: lead });
    await expect(book(day, { leadId: lead }, '15:15', '15:45')).rejects.toThrow(
      /no_double_booking_lead|no_double_booking_staff|exclusion constraint|conflicting key/i,
    );
    await A().appointment.update({
      where: { id: a.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await expect(book(day, { leadId: lead }, '15:15', '15:45')).resolves.toBeDefined();
  });

  it('takes the client once, at conversion; then the client, and always the lead, stay', async () => {
    const lead = await newLead();
    const other = await newLead();
    const a = await book(freshDay(), { leadId: lead });
    // The lead converts: the appointment becomes the client's and keeps where it came from.
    const converted = await A().appointment.update({
      where: { id: a.id },
      data: { clientId: ids.client },
    });
    expect(converted).toMatchObject({ clientId: ids.client, leadId: lead });
    // Never to another client, back to none, or to another lead.
    const client2 = (
      await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.client.create({ data: { businessId: ids.firmA, displayName: 'Other (fake)' } }),
      )
    ).id;
    for (const data of [{ clientId: client2 }, { clientId: null }, { leadId: other }]) {
      await expect(A().appointment.update({ where: { id: a.id }, data })).rejects.toThrow(
        /client of an appointment cannot change, nor its lead|appointments_client_or_lead/,
      );
    }
    // A client's own appointment never takes a lead.
    const own = await book(freshDay(), { clientId: ids.client });
    await expect(
      A().appointment.update({ where: { id: own.id }, data: { leadId: lead } }),
    ).rejects.toThrow(/client of an appointment cannot change, nor its lead/);
  });

  it('keeps a lead that has appointments, and another firm sees none of them', async () => {
    const lead = await newLead();
    const a = await book(freshDay(), { leadId: lead });
    await expect(
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.lead.delete({ where: { id: lead } }),
      ),
    ).rejects.toThrow(/foreign key|appointments_business_id_lead_id_fkey|Foreign key constraint/i);
    expect(await db.forBusiness(ids.firmB).appointment.count({ where: { id: a.id } })).toBe(0);
    expect(await db.forBusiness(ids.firmB).appointment.count({ where: { leadId: lead } })).toBe(0);
  });
});
