// Appointments, meeting types and blocked time, firm side and portal side.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const later = (days: number) => new Date(Date.now() + days * 86_400_000);
/** 15:00 UTC in some days: on the 15-minute grid. */
const at3pm = (days: number) => new Date(later(days).setUTCHours(15, 0, 0, 0)).toISOString();

export const records: CaseModule['records'] = {
  appointmentType: {
    async create({ tx, businessId }) {
      const row = await tx.appointmentType.create({
        data: {
          businessId,
          name: `Fake meeting ${randomUUID().slice(0, 8)}`,
          durationMinutes: 30,
          clientBookable: true,
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

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/appointments/:id': { params: { id: 'appointment' } },
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
    body: { startsAt: at3pm(12) },
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
  'PATCH /api/v1/business/appointment-types/:id': {
    params: { id: 'appointmentType' },
    body: { name: 'Fake renamed type' },
  },
  'POST /api/v1/business/appointment-types/:id/archive': { params: { id: 'appointmentType' } },
  'POST /api/v1/business/appointment-types/:id/restore': { params: { id: 'appointmentType' } },
  'DELETE /api/v1/business/blocked-times/:id': { params: { id: 'blockedTime' } },
  // Found, but no one has working hours, so no slot is free.
  'POST /api/v1/portal/:firmSlug/me/appointments': {
    params: {},
    bodyIds: { typeId: 'appointmentType' },
    body: { startsAt: at3pm(12) },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/cancel': { params: { id: 'appointment' } },
  // Found, but the staff member has no working hours, so no slot is free.
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/reschedule': {
    params: { id: 'appointment' },
    body: { startsAt: later(9).toISOString() },
    expect: 409,
  },
};
