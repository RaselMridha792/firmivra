import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { runInScope, type Database, Prisma } from '@firmivra/db';
import { FirmAppointment, ListFirmAvailableSlotsResponse } from '@firmivra/types';
import { DATABASE } from '../../src/database/database.module.js';
import { SqlRecords } from '../../src/firm-common/sql-records.js';
import { hasPostgresCode } from '../../src/firm-common/postgres-errors.js';
import { AppointmentJobs } from '../../src/appointments/appointment-jobs.service.js';
import {
  AppointmentNotifier,
  type AppointmentNotice,
} from '../../src/appointments/appointment.ports.js';
import type { AppointmentRow } from '../../src/appointments/appointments.service.js';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { installDraftSchema } from '../helpers/draft-schema.js';
import { appointmentSchema } from '../fixtures/appointment-schema.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>,
  owner: string,
  staff: string,
  client: string,
  other: string,
  foreign: string,
  foreignClient: string,
  portalWinner: string,
  providerId: string,
  staffId: string,
  foreignProvider: string,
  clientId: string,
  foreignClientId: string,
  typeId: string,
  blockId: string,
  portalId: string,
  firmId: string;
const notifier = { enqueue: vi.fn(async (_notice: AppointmentNotice) => {}) };
const api = () => request(fx.app.getHttpServer());
const day = new Date(Date.now() + 86400000);
day.setUTCHours(0, 0, 0, 0);
const time = (hour: number, minute = 0) =>
  new Date(day.getTime() + (hour * 60 + minute) * 60000).toISOString();
const from = time(0),
  to = new Date(day.getTime() + 86400000).toISOString();
const hours = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  startMinute: 480,
  endMinute: 1080,
}));
const portal = () => `/api/v1/portal/${fx.firmA.slug}`;
const range = `from=${from}&to=${to}`;
beforeAll(async () => {
  fx = await firmFixtures('appointments', (builder) =>
    builder.overrideProvider(AppointmentNotifier).useValue(notifier),
  );
  await installDraftSchema(fx.owner, appointmentSchema);
  [owner, staff, client, other, foreign, foreignClient] = await Promise.all([
    fx.token('ownerA'),
    fx.token('staffA'),
    fx.token('clientA'),
    fx.token('otherClientA'),
    fx.token('ownerB'),
    fx.token('clientB'),
  ]);
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
    await tx.businessSettings.update({
      where: { businessId: fx.firmA.id },
      data: { timezone: 'UTC' },
    });
    providerId = (await tx.membership.findFirstOrThrow({ where: { userId: fx.users.ownerA.id } }))
      .id;
    staffId = (await tx.membership.findFirstOrThrow({ where: { userId: fx.users.staffA.id } })).id;
    clientId = (await tx.clientAccount.findFirstOrThrow({ where: { userId: fx.users.clientA.id } }))
      .clientId!;
    await tx.client.update({
      where: { id: clientId },
      data: { assignedUserId: fx.users.staffA.id },
    });
  });
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmB.id }, async (tx) => {
    foreignProvider = (
      await tx.membership.findFirstOrThrow({ where: { userId: fx.users.ownerB.id } })
    ).id;
    foreignClientId = (
      await tx.clientAccount.findFirstOrThrow({ where: { userId: fx.users.clientB.id } })
    ).clientId!;
  });
});
afterAll(async () => await fx?.close());
describe('canonical appointment API', () => {
  it('manages types, including explicit 5-minute phone-only introductory calls', async () => {
    const body = {
      name: 'Synthetic consultation',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      allowedMethods: ['PHONE', 'VIDEO'],
      clientBookingEnabled: true,
      active: true,
    };
    typeId = (
      await api()
        .post('/api/v1/business/appointment-types')
        .auth(owner, { type: 'bearer' })
        .send(body)
        .expect(201)
    ).body.id;
    await api()
      .patch(`/api/v1/business/appointment-types/${typeId}`)
      .auth(owner, { type: 'bearer' })
      .send({ name: 'Synthetic consultation updated' })
      .expect(200);
    await api()
      .post('/api/v1/business/appointment-types')
      .auth(owner, { type: 'bearer' })
      .send({ ...body, name: 'Bad intro', isIntroCall: true, durationMinutes: 5 })
      .expect(400);
    const intro = await api()
      .post('/api/v1/business/appointment-types')
      .auth(owner, { type: 'bearer' })
      .send({
        ...body,
        name: 'Intro',
        isIntroCall: true,
        durationMinutes: 5,
        allowedMethods: ['PHONE'],
      })
      .expect(201);
    expect(intro.body.isIntroCall).toBe(true);
    await api()
      .get('/api/v1/business/appointment-types')
      .auth(staff, { type: 'bearer' })
      .expect(200);
    await api().get(`${portal()}/appointment-types`).auth(client, { type: 'bearer' }).expect(200);
    await api()
      .post('/api/v1/business/appointment-types')
      .auth(staff, { type: 'bearer' })
      .send(body)
      .expect(403);
  });
  it('manages staff working hours and blocks without accepting another firm provider', async () => {
    await api()
      .put(`/api/v1/business/working-hours/${providerId}`)
      .auth(owner, { type: 'bearer' })
      .send({ items: hours })
      .expect(200);
    await api()
      .get(`/api/v1/business/working-hours/${providerId}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await api()
      .put(`/api/v1/business/working-hours/${staffId}`)
      .auth(staff, { type: 'bearer' })
      .send({ items: hours })
      .expect(200);
    await api()
      .put(`/api/v1/business/working-hours/${providerId}`)
      .auth(staff, { type: 'bearer' })
      .send({ items: hours })
      .expect(403);
    await api()
      .put(`/api/v1/business/working-hours/${foreignProvider}`)
      .auth(owner, { type: 'bearer' })
      .send({ items: hours })
      .expect(404);
    await api()
      .put(`/api/v1/business/working-hours/${providerId}`)
      .auth(owner, { type: 'bearer' })
      .send({ items: [{ weekday: 1, startMinute: 600, endMinute: 500 }] })
      .expect(400);
    const body = {
      providerMembershipId: providerId,
      startsAt: time(12),
      endsAt: time(13),
      reason: 'Synthetic unavailable',
    };
    blockId = (
      await api()
        .post('/api/v1/business/blocked-time')
        .auth(owner, { type: 'bearer' })
        .send(body)
        .expect(201)
    ).body.id;
    await api()
      .get(`/api/v1/business/blocked-time?providerMembershipId=${providerId}&${range}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await api()
      .delete(`/api/v1/business/blocked-time/${blockId}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    blockId = (
      await api()
        .post('/api/v1/business/blocked-time')
        .auth(owner, { type: 'bearer' })
        .send(body)
        .expect(201)
    ).body.id;
  });
  it('shows provider names and actual available slots to firm and portal users', async () => {
    for (const [base, token] of [
      ['/api/v1/business', owner],
      [portal(), client],
    ] as const) {
      const providers = await api()
        .get(`${base}/appointment-providers?typeId=${typeId}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(providers.body.items.some((row: { id: string }) => row.id === providerId)).toBe(true);
      const result = await api()
        .get(
          `${base}/appointments/availability?providerMembershipId=${providerId}&typeId=${typeId}&${range}`,
        )
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(ListFirmAvailableSlotsResponse.safeParse(result.body).success).toBe(true);
      expect(result.body.slots.some((row: { startsAt: string }) => row.startsAt === time(9))).toBe(
        true,
      );
      expect(result.body.slots.some((row: { startsAt: string }) => row.startsAt === time(12))).toBe(
        false,
      );
    }
  });
  it('allows exactly one of two concurrent portal bookings of the same slot', async () => {
    const body = { typeId, providerMembershipId: providerId, startsAt: time(9), method: 'PHONE' };
    const results = await Promise.all([
      api()
        .post(`${portal()}/appointments`)
        .set('Idempotency-Key', randomUUID())
        .auth(client, { type: 'bearer' })
        .send(body),
      api()
        .post(`${portal()}/appointments`)
        .set('Idempotency-Key', randomUUID())
        .auth(other, { type: 'bearer' })
        .send(body),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 409]);
    const index = results.findIndex((row) => row.status === 201);
    portalId = results[index]!.body.id;
    portalWinner = index === 0 ? client : other;
    expect(FirmAppointment.safeParse(results[index]!.body).success).toBe(true);
    await api()
      .post(`${portal()}/appointments`)
      .set('Idempotency-Key', randomUUID())
      .auth(client, { type: 'bearer' })
      .send({ ...body, startsAt: time(14), clientId: foreignClientId })
      .expect(400);
    await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', randomUUID())
      .auth(owner, { type: 'bearer' })
      .send({ ...body, startsAt: time(10), clientId: foreignClientId })
      .expect(404);
    firmId = (
      await api()
        .post('/api/v1/business/appointments')
        .set('Idempotency-Key', randomUUID())
        .auth(owner, { type: 'bearer' })
        .send({ ...body, startsAt: time(10), clientId })
        .expect(201)
    ).body.id;
  });
  it('lists/details canonical records, updates client-visible details and preserves duration on reschedule', async () => {
    await api()
      .get(`/api/v1/business/appointments?${range}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await api()
      .get(`${portal()}/appointments?${range}`)
      .auth(portalWinner, { type: 'bearer' })
      .expect(200);
    await api()
      .get(`/api/v1/business/appointments/${firmId}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await api()
      .get(`${portal()}/appointments/${portalId}`)
      .auth(portalWinner, { type: 'bearer' })
      .expect(200);
    await api()
      .get(`${portal()}/appointments/${portalId}`)
      .auth(portalWinner === client ? other : client, { type: 'bearer' })
      .expect(404);
    await api()
      .patch(`/api/v1/business/appointments/${firmId}`)
      .auth(owner, { type: 'bearer' })
      .send({
        expectedVersion: 1,
        instructions: 'Sign in for the appointment.',
        meetingUrl: 'https://meeting.example.test/synthetic',
      })
      .expect(200);
    await api()
      .patch(`/api/v1/business/appointments/${firmId}`)
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: 2, meetingUrl: 'https://user:pass@meeting.example.test' })
      .expect(400);
    await api()
      .post(`/api/v1/business/appointments/${firmId}/reschedule`)
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: 1, startsAt: time(11) })
      .expect(409);
    await api()
      .patch(`/api/v1/business/appointment-types/${typeId}`)
      .auth(owner, { type: 'bearer' })
      .send({ durationMinutes: 60 })
      .expect(200);
    const changed = await api()
      .post(`/api/v1/business/appointments/${firmId}/reschedule`)
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: 2, startsAt: time(11) })
      .expect(200);
    expect(changed.body.id).toBe(firmId);
    expect(
      new Date(changed.body.endsAt).getTime() - new Date(changed.body.startsAt).getTime(),
    ).toBe(30 * 60000);
    await api()
      .get(`/api/v1/business/appointments/${firmId}/history`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    await api()
      .put(`/api/v1/business/working-hours/${providerId}`)
      .auth(owner, { type: 'bearer' })
      .send({ items: [] })
      .expect(409);
    await api()
      .post('/api/v1/business/blocked-time')
      .auth(owner, { type: 'bearer' })
      .send({
        providerMembershipId: providerId,
        startsAt: time(11),
        endsAt: time(12),
        reason: null,
      })
      .expect(409);
  });
  it('reschedules and cancels the same portal record, retaining append-only history', async () => {
    const changed = await api()
      .post(`${portal()}/appointments/${portalId}/reschedule`)
      .auth(portalWinner, { type: 'bearer' })
      .send({ expectedVersion: 1, startsAt: time(13) })
      .expect(200);
    expect(changed.body.id).toBe(portalId);
    await api()
      .get(`${portal()}/appointments/${portalId}/history`)
      .auth(portalWinner, { type: 'bearer' })
      .expect(200);
    const cancelled = await api()
      .post(`${portal()}/appointments/${portalId}/cancel`)
      .auth(portalWinner, { type: 'bearer' })
      .send({ expectedVersion: 2, reason: 'Synthetic cancellation' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const again = await api()
      .post(`${portal()}/appointments/${portalId}/cancel`)
      .auth(portalWinner, { type: 'bearer' })
      .send({ expectedVersion: 2 })
      .expect(200);
    expect(again.body.version).toBe(cancelled.body.version);
    const history = await api()
      .get(`${portal()}/appointments/${portalId}/history`)
      .auth(portalWinner, { type: 'bearer' })
      .expect(200);
    expect(history.body.items.map((row: { action: string }) => row.action).sort()).toEqual([
      'BOOKED',
      'CANCELLED',
      'RESCHEDULED',
    ]);
    await api()
      .post(`/api/v1/business/appointments/${firmId}/cancel`)
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: 3 })
      .expect(200);
  });
  it('deduplicates concurrent booking retries and rejects key/payload changes', async () => {
    const key = randomUUID();
    const body = {
      typeId,
      providerMembershipId: providerId,
      startsAt: time(15),
      method: 'PHONE',
      clientId,
    };
    await api()
      .post('/api/v1/business/appointments')
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(400);
    await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', 'short')
      .auth(owner, { type: 'bearer' })
      .send(body)
      .expect(400);
    const attempt = () =>
      api()
        .post('/api/v1/business/appointments')
        .set('Idempotency-Key', key)
        .auth(owner, { type: 'bearer' })
        .send(body);
    const responses = await Promise.all([attempt(), attempt()]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(FirmAppointment.safeParse(responses[0].body).success).toBe(true);
    expect(responses[0].body.requestKey).toBeUndefined();
    const changed = await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', key)
      .auth(owner, { type: 'bearer' })
      .send({ ...body, startsAt: time(16) })
      .expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const history = await api()
      .get('/api/v1/business/appointments/' + responses[0].body.id + '/history')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toHaveLength(1);
    await api()
      .post('/api/v1/business/appointments/' + responses[0].body.id + '/cancel')
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(200);
    const retried = await attempt().expect(201);
    expect(retried.body.id).toBe(responses[0].body.id);
    expect(retried.body.status).toBe('CANCELLED');
    // A different actor owns a separate key space, even for an identical header value.
    await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', key)
      .auth(staff, { type: 'bearer' })
      .send({ ...body, providerMembershipId: staffId, startsAt: time(15) })
      .expect(201);
  });
  it('limits staff booking and views to their own calendar and assigned clients', async () => {
    const booked = await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', randomUUID())
      .auth(staff, { type: 'bearer' })
      .send({
        typeId,
        providerMembershipId: staffId,
        startsAt: time(14),
        method: 'PHONE',
        clientId,
      })
      .expect(201);
    await api()
      .get(`/api/v1/business/appointments/${booked.body.id}`)
      .auth(staff, { type: 'bearer' })
      .expect(200);
    await api()
      .get(`/api/v1/business/appointments/${portalId}`)
      .auth(staff, { type: 'bearer' })
      .expect(404);
    const anotherId = await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      async (tx) =>
        (await tx.clientAccount.findFirstOrThrow({ where: { userId: fx.users.otherClientA.id } }))
          .clientId!,
    );
    await api()
      .post('/api/v1/business/appointments')
      .set('Idempotency-Key', randomUUID())
      .auth(staff, { type: 'bearer' })
      .send({
        typeId,
        providerMembershipId: staffId,
        startsAt: time(16),
        method: 'PHONE',
        clientId: anotherId,
      })
      .expect(404);
  });
  it('enforces RLS and exclusion even for an app-role writer that omits API locks', async () => {
    const db = fx.app.get<Database>(DATABASE);
    const rows = await db.withScope(
      { kind: 'business', businessId: fx.firmB.id },
      (tx) => tx.$queryRaw`SELECT id FROM appointments WHERE business_id=${fx.firmA.id}::uuid`,
    );
    expect(rows).toEqual([]);
    const overlappingWrite = db.withScope(
      { kind: 'business', businessId: fx.firmA.id },
      async (tx) => {
        const records = new SqlRecords(tx, fx.firmA.id),
          [row] = await records.many<AppointmentRow>(
            'appointments',
            Prisma.sql`AND status='BOOKED'`,
          );
        if (!row) throw new Error('Fixture needs an active booking');
        const { businessId: _businessId, id: _id, ...copy } = row;
        return records.insert('appointments', { ...copy, requestKey: randomUUID() });
      },
    );
    await expect(overlappingWrite).rejects.toSatisfy((error: unknown) =>
      hasPostgresCode(error, '23P01'),
    );
    const appRole = await db.withScope(
      { kind: 'business', businessId: fx.firmA.id },
      (tx) =>
        tx.$queryRaw<
          { allowed: boolean }[]
        >`SELECT has_table_privilege(current_user,'appointment_histories','UPDATE') AS allowed`,
    );
    expect(appRole[0]?.allowed).toBe(false);
  });
  it('dispatches durable notices once, suppresses stale versions and retries sending failures safely', async () => {
    const jobs = fx.app.get(AppointmentJobs);
    const results = await Promise.all([
      jobs.runDue(fx.firmA.id, 100),
      jobs.runDue(fx.firmA.id, 100),
    ]);
    expect(results.reduce((sum, row) => sum + row.queued, 0)).toBeGreaterThan(0);
    const notices = notifier.enqueue.mock.calls.map(
      (call) =>
        call[0] as unknown as {
          eventKey: string;
          appointmentId: string;
          appointmentVersion: number;
        },
    );
    expect(new Set(notices.map((row) => row.eventKey)).size).toBe(notices.length);
    expect(
      notices
        .filter((row) => row.appointmentId === portalId)
        .every((row) => row.appointmentVersion === 3),
    ).toBe(true);
    await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      (tx) =>
        tx.$executeRaw`UPDATE appointment_reminders SET due_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE business_id=${fx.firmA.id}::uuid AND kind='REMINDER' AND status='PENDING'`,
    );
    notifier.enqueue.mockRejectedValueOnce(new Error('synthetic-private-provider-error'));
    await jobs.runDue(fx.firmA.id, 100);
    const [retry] = await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      (tx) =>
        tx.$queryRaw<
          { last_error_code: string; status: string }[]
        >`SELECT last_error_code,status FROM appointment_reminders WHERE business_id=${fx.firmA.id}::uuid AND last_error_code IS NOT NULL`,
    );
    expect(retry?.last_error_code).toBe('DELIVERY_UNAVAILABLE');
    expect(retry?.status).toBe('PENDING');
    await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      (tx) =>
        tx.$executeRaw`UPDATE appointment_reminders SET next_attempt_at=now()-interval '1 second' WHERE business_id=${fx.firmA.id}::uuid AND status='PENDING'`,
    );
    expect((await jobs.runDue(fx.firmA.id, 100)).queued).toBeGreaterThan(0);
  });
  it('lets an owner cancel an existing booking after the provider is deactivated', async () => {
    const booking = await runInScope(
      fx.owner,
      { kind: 'business', businessId: fx.firmA.id },
      async (tx) => {
        const records = new SqlRecords(tx, fx.firmA.id),
          [row] = await records.many<AppointmentRow>(
            'appointments',
            Prisma.sql`AND provider_membership_id=${staffId}::uuid AND status='BOOKED'`,
          );
        await tx.membership.update({ where: { id: staffId }, data: { status: 'DEACTIVATED' } });
        return row!;
      },
    );
    await api()
      .post(`/api/v1/business/appointments/${booking.id}/cancel`)
      .auth(owner, { type: 'bearer' })
      .send({ expectedVersion: booking.version })
      .expect(200);
  });
  it('denies every firm/portal endpoint to a caller linked only to the other firm', async () => {
    const booking = {
      typeId,
      providerMembershipId: providerId,
      startsAt: time(16),
      method: 'PHONE',
      clientId,
    };
    const cases = [
      ['get', 'appointment-types', undefined],
      ['post', 'appointment-types', {}],
      ['patch', `appointment-types/${typeId}`, { name: 'x' }],
      ['get', `working-hours/${providerId}`, undefined],
      ['put', `working-hours/${providerId}`, { items: hours }],
      ['get', `blocked-time?providerMembershipId=${providerId}&${range}`, undefined],
      ['post', 'blocked-time', {}],
      ['delete', `blocked-time/${blockId}`, undefined],
      ['get', `appointment-providers?typeId=${typeId}`, undefined],
      [
        'get',
        `appointments/availability?providerMembershipId=${providerId}&typeId=${typeId}&${range}`,
        undefined,
      ],
      ['get', `appointments?${range}`, undefined],
      ['post', 'appointments', booking],
      ['get', `appointments/${firmId}`, undefined],
      ['patch', `appointments/${firmId}`, { expectedVersion: 1, instructions: 'x' }],
      ['post', `appointments/${firmId}/reschedule`, { expectedVersion: 1, startsAt: time(16) }],
      ['post', `appointments/${firmId}/cancel`, { expectedVersion: 1 }],
      ['get', `appointments/${firmId}/history`, undefined],
    ] as const;
    for (const [method, path, body] of cases)
      await api()
        [method](`/api/v1/business/${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
    const portalCases = cases.filter(
      ([method, path]) =>
        (method === 'get' &&
          !path.startsWith('working-hours') &&
          !path.startsWith('blocked-time')) ||
        (method === 'post' && path.startsWith('appointments')),
    );
    for (const [method, path, body] of portalCases)
      await api()
        [method](`${portal()}/${path}`)
        .auth(foreignClient, { type: 'bearer' })
        .send(body)
        .expect(404);
  });
  it('refuses writes if the required database overlap invariant is missing', async () => {
    await fx.owner.$executeRawUnsafe(
      'ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap',
    );
    try {
      await api()
        .post('/api/v1/business/appointments')
        .set('Idempotency-Key', randomUUID())
        .auth(owner, { type: 'bearer' })
        .send({
          typeId,
          providerMembershipId: providerId,
          startsAt: time(16),
          method: 'PHONE',
          clientId,
        })
        .expect(503);
    } finally {
      await fx.owner.$executeRawUnsafe(
        "ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist(business_id WITH =,provider_membership_id WITH =,tstzrange(occupied_starts_at,occupied_ends_at,'[)') WITH &&) WHERE (status='BOOKED')",
      );
    }
  });
});
