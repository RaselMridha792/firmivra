import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { runInScope } from '@firmivra/db';
import { SqlRecords } from '../../src/firm-common/sql-records.js';
import { ScopedNotificationTargets } from '../../src/notification-center/notification-targets.service.js';
import type { FirmActor } from '../../src/firm-common/actor.js';
import { installDraftSchema } from '../helpers/draft-schema.js';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { appointmentSchema } from '../fixtures/appointment-schema.js';
import { externalLinksSchema } from '../fixtures/external-links-schema.js';
import { notificationSchema } from '../fixtures/notification-schema.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>, appointmentId: string, linkId: string;
const ctx = (
  person: keyof typeof fx.users,
  role: FirmActor['role'],
  client = false,
): FirmActor => ({
  businessId: person === 'ownerB' ? fx.firmB.id : fx.firmA.id,
  userId: fx.users[person].id,
  role,
  kind: client ? 'client' : 'staff',
});
const visible = (actor: FirmActor, type: 'appointment' | 'externalLink', id: string) =>
  fx.app.get(ScopedNotificationTargets).visible(actor, { entityType: type, entityId: id });
beforeAll(async () => {
  fx = await firmFixtures('notification-targets');
  await installDraftSchema(fx.owner, [
    ...appointmentSchema,
    ...externalLinksSchema,
    ...notificationSchema,
  ]);
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
    const records = new SqlRecords(tx, fx.firmA.id);
    const provider = await tx.membership.findFirstOrThrow({
      where: { userId: fx.users.ownerA.id },
    });
    const client = await tx.clientAccount.findFirstOrThrow({
      where: { userId: fx.users.clientA.id },
    });
    const type = await records.insert<{ id: string }>('appointment_types', {
      name: 'Synthetic',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      allowedMethods: ['PHONE'],
      clientBookingEnabled: true,
      active: true,
    });
    appointmentId = (
      await records.insert<{ id: string }>('appointments', {
        clientId: client.clientId,
        clientName: 'Synthetic',
        providerMembershipId: provider.id,
        providerName: 'Synthetic',
        typeId: type.id,
        typeName: 'Synthetic',
        startsAt: '2030-01-01T12:00:00Z',
        endsAt: '2030-01-01T12:30:00Z',
        occupiedStartsAt: '2030-01-01T12:00:00Z',
        occupiedEndsAt: '2030-01-01T12:30:00Z',
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timezone: 'UTC',
        method: 'PHONE',
        status: 'BOOKED',
        version: 1,
        createdByUserId: fx.users.ownerA.id,
        requestKey: randomUUID(),
        requestFingerprint: 'synthetic',
      })
    ).id;
    linkId = (
      await records.insert<{ id: string }>('external_links', {
        section: 'IRS_TAX',
        title: 'Synthetic IRS',
        description: 'Synthetic resource',
        url: 'https://www.irs.gov/',
        source: 'IRS',
        sortOrder: 0,
        active: true,
        audience: 'ALL',
      })
    ).id;
    await tx.$executeRaw`INSERT INTO notifications(id,business_id,recipient_user_id,category,title,message,target_entity_type,target_entity_id,event_key) VALUES (${randomUUID()}::uuid,${fx.firmA.id}::uuid,${fx.users.clientA.id}::uuid,'APPOINTMENT','Appointment update','Sign in to review','appointment',${appointmentId}::uuid,'synthetic-target')`;
  });
});
afterAll(async () => await fx?.close());
it('returns authorized typed targets in the real portal controller', async () => {
  const token = await fx.token('clientA');
  const response = await request(fx.app.getHttpServer())
    .get(`/api/v1/portal/${fx.firmA.slug}/notifications`)
    .auth(token, { type: 'bearer' })
    .expect(200);
  expect(response.body.items[0].target).toEqual({
    entityType: 'appointment',
    entityId: appointmentId,
  });
});
it('rechecks appointment client, provider, firm and module permissions', async () => {
  expect(await visible(ctx('ownerA', 'OWNER'), 'appointment', appointmentId)).toBe(true);
  expect(await visible(ctx('clientA', 'CLIENT', true), 'appointment', appointmentId)).toBe(true);
  expect(await visible(ctx('otherClientA', 'CLIENT', true), 'appointment', appointmentId)).toBe(
    false,
  );
  expect(await visible(ctx('staffA', 'STAFF'), 'appointment', appointmentId)).toBe(false);
  expect(await visible(ctx('ownerB', 'OWNER'), 'appointment', appointmentId)).toBe(false);
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    tx.businessSettings.update({
      where: { businessId: fx.firmA.id },
      data: { enabledModules: [] },
    }),
  );
  expect(await visible(ctx('ownerA', 'OWNER'), 'appointment', appointmentId)).toBe(false);
});
it('blocks Individual clients, unsafe/inactive resources, and unresolved owner modules', async () => {
  expect(await visible(ctx('clientA', 'CLIENT', true), 'externalLink', linkId)).toBe(true);
  expect(await visible(ctx('otherClientA', 'CLIENT', true), 'externalLink', linkId)).toBe(false);
  expect(await visible(ctx('staffA', 'STAFF'), 'externalLink', linkId)).toBe(false);
  expect(await visible(ctx('ownerB', 'OWNER'), 'externalLink', linkId)).toBe(false);
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    new SqlRecords(tx, fx.firmA.id).patch('external_links', linkId, {
      url: 'https://www.irs.gov.evil.test/',
    }),
  );
  expect(await visible(ctx('clientA', 'CLIENT', true), 'externalLink', linkId)).toBe(false);
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    new SqlRecords(tx, fx.firmA.id).patch('external_links', linkId, {
      url: 'https://www.irs.gov/',
      active: false,
    }),
  );
  expect(await visible(ctx('clientA', 'CLIENT', true), 'externalLink', linkId)).toBe(false);
  expect(await visible(ctx('ownerA', 'OWNER'), 'externalLink', linkId)).toBe(true);
  expect(
    await fx.app
      .get(ScopedNotificationTargets)
      .visible(ctx('ownerA', 'OWNER'), { entityType: 'document', entityId: randomUUID() }),
  ).toBe(false);
});
