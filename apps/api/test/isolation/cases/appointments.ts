// Appointments, meeting types and blocked time, firm side and portal side.
import { randomUUID } from 'node:crypto';
import type { CaseModule, SeedContext } from '../world.js';

const later = (days: number) => new Date(Date.now() + days * 86_400_000);
/** 15:00 UTC in some days: on the 15-minute grid. */
const at3pm = (days: number) => new Date(later(days).setUTCHours(15, 0, 0, 0)).toISOString();

export const records: CaseModule['records'] = {
  /** Review 2 (Save as Draft): firm P's Owner's draft of the Schedule Appointment form. */
  appointmentDraft: {
    async create({ tx, businessId, owner }) {
      const row = await tx.appointmentDraft.create({
        data: { businessId, createdByUserId: owner.id, data: { method: 'VIDEO' } },
      });
      return row.id;
    },
  },
  /** Another of the Owner's drafts, which the schedule case books (and so deletes). */
  appointmentDraftToBook: {
    async create({ tx, businessId, owner }) {
      const row = await tx.appointmentDraft.create({
        data: { businessId, createdByUserId: owner.id, data: { method: 'IN_PERSON' } },
      });
      return row.id;
    },
  },
  appointmentType: {
    async create({ tx, businessId }) {
      const row = await tx.appointmentType.create({
        data: {
          businessId,
          name: `Fake meeting ${randomUUID().slice(0, 8)}`,
          durationMinutes: 30,
          clientBookable: true,
          // Every meeting method (A1), video first: the cases book and edit in each of them.
          meetingMethods: ['VIDEO', 'IN_PERSON', 'PHONE'],
        },
      });
      return row.id;
    },
  },
  /** Client X's meeting with the staff member next week. */
  appointment: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const startsAt = later(7);
      const row = await tx.appointment.create({
        data: {
          businessId,
          clientId: await get('client'),
          staffUserId: await get('staffUser'),
          typeId: await get('appointmentType'),
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          locationKind: 'VIDEO',
        },
      });
      return row.id;
    },
  },
  /** A1: another client of the firm, who attends client X's group appointment (no login). */
  attendeeClient: {
    async create({ tx, businessId }) {
      const row = await tx.client.create({ data: { businessId, displayName: 'Fake Attendee' } });
      return row.id;
    },
  },
  /**
   * A3: client X's appointment on the waitlist (the firm's waitlist on), with its live entry, so
   * joining again is 409 ALREADY_WAITING; and the entry, WAITING (accept, decline, approve and
   * reject are 409 on it).
   */
  waitlistAppointment: {
    clientPrivate: true,
    async create(ctx) {
      return waitlisted(ctx, 11);
    },
  },
  waitlistEntry: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const appointmentId = await get('waitlistAppointment');
      const row = await tx.appointmentWaitlistEntry.findFirstOrThrow({
        where: { businessId, appointmentId },
        select: { id: true },
      });
      return row.id;
    },
  },
  /** A3: another entry of client X, which the leave case ends. */
  waitlistEntryToLeave: {
    clientPrivate: true,
    async create(ctx) {
      const appointmentId = await waitlisted(ctx, 12);
      const row = await ctx.tx.appointmentWaitlistEntry.findFirstOrThrow({
        where: { businessId: ctx.businessId, appointmentId },
        select: { id: true },
      });
      return row.id;
    },
  },
  firmOffice: {
    async create({ tx, businessId }) {
      const row = await tx.firmOffice.create({
        data: { businessId, name: `Fake office ${randomUUID().slice(0, 8)}` },
      });
      return row.id;
    },
  },
  firmRoom: {
    async create({ tx, businessId, get }) {
      const row = await tx.firmRoom.create({
        data: { businessId, officeId: await get('firmOffice'), name: 'Fake room' },
      });
      return row.id;
    },
  },
  blockedTime: {
    async create({ tx, businessId }) {
      const startsAt = later(3);
      const row = await tx.blockedTime.create({
        data: { businessId, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) },
      });
      return row.id;
    },
  },
};

/** A3: client X's appointment in `days` days, waiting for an earlier time (the waitlist on). */
async function waitlisted({ tx, businessId, get }: SeedContext, days: number): Promise<string> {
  await tx.appointmentSettings.upsert({
    where: { businessId },
    create: { businessId, waitlistEnabled: true },
    update: { waitlistEnabled: true },
  });
  const clientId = await get('client');
  const startsAt = later(days);
  const row = await tx.appointment.create({
    data: {
      businessId,
      clientId,
      staffUserId: await get('staffUser'),
      typeId: await get('appointmentType'),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      locationKind: 'VIDEO',
    },
  });
  await tx.appointmentWaitlistEntry.create({
    data: { businessId, appointmentId: row.id, clientId },
  });
  return row.id;
}

/** The body ids of Schedule Appointment; the form's contact is a client here. */
const scheduleIds = {
  'contact.id': 'client',
  typeId: 'appointmentType',
  serviceId: 'service',
  officeId: 'firmOffice',
  roomId: 'firmRoom',
  // Review 2 (A2): an item for any office (cases/appointment-resources.ts).
  equipmentIds: 'firmEquipment',
  staffUserIds: 'staffUser',
  // A1: the other clients of a group appointment.
  attendeeClientIds: 'attendeeClient',
};

const inOneHour = () => ({
  startsAt: at3pm(22),
  endsAt: new Date(new Date(at3pm(22)).getTime() + 30 * 60_000).toISOString(),
});

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/appointments/:id/send-reminder': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/:id/notes': {
    params: { id: 'appointment' },
    body: { text: 'Fake note' },
  },
  'POST /api/v1/business/appointments/:id/duplicate': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/reminders/send': {
    params: {},
    bodyIds: { appointmentIds: 'appointment' },
  },
  // P4-1: the form's contact is a lead here (the check resolves it by the lead pages' rule); the
  // client contact is swapped on Schedule Appointment and the drafts.
  'POST /api/v1/business/appointments/conflicts': {
    params: {},
    bodyIds: {
      staffUserIds: 'staffUser',
      'contact.id': 'lead',
      roomId: 'firmRoom',
      equipmentIds: 'firmEquipment',
      excludeAppointmentId: 'appointment',
      // Review 2 (B11): the type being booked, for its buffers.
      typeId: 'appointmentType',
      // A1: the other attendees, each checked for another appointment then.
      attendeeClientIds: 'attendeeClient',
    },
    body: { ...inOneHour(), contact: { kind: 'LEAD', id: '' } },
  },
  'GET /api/v1/business/availability/:userId/rules': { params: { userId: 'staffUser' } },
  'PUT /api/v1/business/availability/:userId/rules': {
    params: { userId: 'staffUser' },
    body: { dateOverrides: [] },
  },
  'GET /api/v1/business/appointment-types/:id/config': { params: { id: 'appointmentType' } },
  // Review 2 (row 3): the type's public booking link and button code.
  'GET /api/v1/business/appointment-types/:id/public-link': { params: { id: 'appointmentType' } },
  'PUT /api/v1/business/appointment-types/:id/config': {
    params: { id: 'appointmentType' },
    bodyIds: { serviceId: 'service' },
    body: { description: 'Fake description', methods: ['PHONE', 'VIDEO'] },
  },
  'GET /api/v1/business/appointments/:id/record': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/:id/confirm': { params: { id: 'appointment' } },
  // Found with the right records, but a made-up version is stale (409 SAVE_CONFLICT).
  'PATCH /api/v1/business/appointments/:id/details': {
    params: { id: 'appointment' },
    bodyIds: scheduleIds,
    body: {
      version: '2020-01-01T00:00:00.000Z',
      contact: { kind: 'CLIENT', id: '' },
      method: 'IN_PERSON',
    },
    expect: 409,
  },
  // Outside the staff member's (absent) working hours, which an Owner overrides with a reason.
  'POST /api/v1/business/appointments/schedule': {
    params: {},
    // C12 (Tax Planning Review 2): a discussion of the client's plan.
    // Review 2 (row 9): the intake form Send Intake Form Before Appointment chose.
    bodyIds: {
      ...scheduleIds,
      taxPlanId: 'taxPlan',
      draftId: 'appointmentDraftToBook',
      'related.intakeFormId': 'intakeTemplate',
    },
    body: () => ({
      idempotencyKey: randomUUID(),
      contact: { kind: 'CLIENT', id: '' },
      startsAt: at3pm(21),
      endsAt: new Date(new Date(at3pm(21)).getTime() + 30 * 60_000).toISOString(),
      method: 'IN_PERSON',
      overrideConflicts: { reason: 'Fake override' },
      // Review 2 (row 9): filled from bodyIds (a swap sets only a field the body already has).
      related: { intakeFormId: '' },
    }),
  },
  // Review 2 (Save as Draft): the member's own drafts; every record a draft names is checked.
  'POST /api/v1/business/appointment-drafts': {
    params: {},
    bodyIds: scheduleIds,
    body: { contact: { kind: 'CLIENT', id: '' }, method: 'IN_PERSON' },
  },
  'GET /api/v1/business/appointment-drafts/:id': { params: { id: 'appointmentDraft' } },
  'PUT /api/v1/business/appointment-drafts/:id': {
    params: { id: 'appointmentDraft' },
    bodyIds: scheduleIds,
    body: { contact: { kind: 'CLIENT', id: '' }, method: 'IN_PERSON' },
  },
  'DELETE /api/v1/business/appointment-drafts/:id': { params: { id: 'appointmentDraft' } },
  'GET /api/v1/business/appointments/:id': { params: { id: 'appointment' } },
  'PATCH /api/v1/business/appointments/:id': {
    params: { id: 'appointment' },
    body: { locationKind: 'PHONE', locationDetails: 'Fake phone details' },
  },
  'POST /api/v1/business/appointments/:id/cancel': { params: { id: 'appointment' } },
  // Found, but next week's meeting hasn't started.
  'POST /api/v1/business/appointments/:id/complete': { params: { id: 'appointment' }, expect: 409 },
  'POST /api/v1/business/appointments/:id/no-show': { params: { id: 'appointment' }, expect: 409 },
  'POST /api/v1/business/appointments': {
    params: {},
    bodyIds: {
      clientId: 'client',
      staffUserId: 'staffUser',
      typeId: 'appointmentType',
      engagementId: 'engagement',
    },
    body: { startsAt: at3pm(12), locationKind: 'PHONE' },
  },
  'POST /api/v1/business/appointments/:id/reschedule': {
    params: { id: 'appointment' },
    bodyIds: { staffUserId: 'staffUser' },
    body: { startsAt: later(9).toISOString() },
  },
  'POST /api/v1/business/blocked-times': {
    params: {},
    bodyIds: { userId: 'staffUser' },
    body: { startsAt: later(5).toISOString(), endsAt: later(5.1).toISOString() },
  },
  'POST /api/v1/business/blocked-times/free-slots': {
    params: {},
    bodyIds: { userId: 'staffUser' },
    body: { startsAt: later(6).toISOString(), endsAt: later(6.1).toISOString() },
  },
  'PATCH /api/v1/business/appointment-types/:id': {
    params: { id: 'appointmentType' },
    body: { name: 'Fake renamed type', methods: ['IN_PERSON', 'VIDEO'] },
  },
  'POST /api/v1/business/appointment-types/:id/archive': { params: { id: 'appointmentType' } },
  'POST /api/v1/business/appointment-types/:id/restore': { params: { id: 'appointmentType' } },
  'DELETE /api/v1/business/blocked-times/:id': { params: { id: 'blockedTime' } },
  'PUT /api/v1/business/availability/:userId/meeting-link': {
    params: { userId: 'staffUser' },
    body: { meetingUrl: 'https://meet.example.com/fake-room' },
  },
  // Found, but no one has working hours, so no slot is free.
  // S12: `packageId`, booked from a package's page; another firm's package is 404 like an unknown
  // one, and the firm's own package of another type books as usual without being named.
  'POST /api/v1/portal/:firmSlug/me/appointments': {
    params: {},
    bodyIds: { typeId: 'appointmentType', packageId: 'catalogPackage' },
    body: { startsAt: at3pm(12), locationKind: 'PHONE' },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/cancel': { params: { id: 'appointment' } },
  // A3: the waitlist. Found, but already waiting (409 ALREADY_WAITING).
  'POST /api/v1/portal/:firmSlug/me/appointment-waitlist': {
    params: {},
    bodyIds: { appointmentId: 'waitlistAppointment' },
    expect: 409,
  },
  // Found, but WAITING: no offer to take or turn down (409 WAITLIST_ENTRY_CLOSED).
  'POST /api/v1/portal/:firmSlug/me/appointment-waitlist/:id/accept': {
    params: { id: 'waitlistEntry' },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/appointment-waitlist/:id/decline': {
    params: { id: 'waitlistEntry' },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/appointment-waitlist/:id/leave': {
    params: { id: 'waitlistEntryToLeave' },
  },
  // Found, but not requested: nothing for staff to decide (409 WAITLIST_ENTRY_CLOSED).
  'POST /api/v1/business/appointment-waitlist/:id/approve': {
    params: { id: 'waitlistEntry' },
    expect: 409,
  },
  'POST /api/v1/business/appointment-waitlist/:id/reject': {
    params: { id: 'waitlistEntry' },
    expect: 409,
  },
  // Review 2 (row 8): the client confirms an appointment the firm booked.
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/confirm': { params: { id: 'appointment' } },
  // Found, but the staff member has no working hours, so no slot is free.
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/reschedule': {
    params: { id: 'appointment' },
    body: { startsAt: later(9).toISOString() },
    expect: 409,
  },
};

export const moduleOff: CaseModule['moduleOff'] = {};

export const excluded: CaseModule['excluded'] = {
  // Review 2 (row 3). Firm Q's slug never reaches firm P's type: test/e2e/booking-link.e2e.test.ts.
  'GET /api/v1/portal/:firmSlug/booking-types/:id':
    "Public: what a visitor may see of one of the slug's firm's appointment types (name, length, methods, whether it takes bookings); another firm's type is 404",
};
