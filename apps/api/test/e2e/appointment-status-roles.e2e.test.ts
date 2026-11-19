// Appointments Review 2 (P10): who may change an appointment's status, for each of the nine firm
// roles, as the default role grid gives it. Confirm, Cancel, Complete and No-show are POSTs on the
// Appointments module (the "create" capability) and follow the Staff calendar rule:
// - Owner and Admin: every appointment;
// - Manager, Staff, Tax Preparer, Client Support and Business Consultant: their own appointments
//   and their assigned clients' (another member's appointment with an unassigned client is 404);
// - Bookkeeper and Read Only: refused (403), nothing changes.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FIRM_ROLES, type MembershipRole } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const people = Object.fromEntries(
  FIRM_ROLES.map((role) => [
    role,
    { id: randomUUID(), email: `p10-${role.toLowerCase()}-${run}@p10.test` },
  ]),
) as Record<MembershipRole, { id: string; email: string }>;
const firm = { id: '', slug: '' };

let app: INestApplication;
let appOrigin = '';
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

const ACTIONS = ['confirm', 'cancel', 'complete', 'no-show'] as const;
type Action = (typeof ACTIONS)[number];
/** Every firm-wide role reaches every appointment. */
const EVERY = ['OWNER', 'ADMIN'] as const satisfies readonly MembershipRole[];
/** No Appointments "create" in the default grid. */
const REFUSED = ['BOOKKEEPER', 'READ_ONLY'] as const satisfies readonly MembershipRole[];

const HOUR = 3_600_000;
/** Each role's own appointments, and another member's (Owner's) with an unassigned client. */
const own = {} as Record<MembershipRole, Record<Action, string>>;
const others = {} as Record<MembershipRole, Record<Action, string>>;

const act = async (role: MembershipRole, action: Action, id: string) => {
  const { token } = await app.get(TokenService).signLocal(people[role].id, 'STAFF');
  return request(app.getHttpServer())
    .post(`/api/v1/business/appointments/${id}/${action}`)
    .set('x-business-id', firm.id)
    .set('authorization', `Bearer ${token}`)
    .set('origin', appOrigin)
    .send({});
};
const statusOf = async (id: string) =>
  runInScope(db, { kind: 'business', businessId: firm.id }, (tx) =>
    tx.appointment.findUniqueOrThrow({
      where: { id },
      select: { status: true, confirmedAt: true },
    }),
  );

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { ...p, cognitoSub: p.id, pool: 'STAFF', name: 'Fake P10 person' },
      });
    }
    const slug = `p10-${run}`;
    Object.assign(
      firm,
      await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
  });
  await runInScope(db, { kind: 'business', businessId: firm.id }, async (tx) => {
    for (const role of FIRM_ROLES) {
      await tx.membership.create({
        data: { businessId: firm.id, userId: people[role].id, role, status: 'ACTIVE' },
      });
    }
    const unassigned = await tx.client.create({
      data: { businessId: firm.id, displayName: 'Unassigned (fake)' },
      select: { id: true },
    });
    // Two days ahead for Confirm and Cancel; started an hour ago for Complete and No-show. Each
    // appointment an hour apart, so no member or client is booked twice.
    let slot = 0;
    const make = async (staffUserId: string, clientId: string, action: Action) => {
      slot += 1;
      const base =
        action === 'confirm' || action === 'cancel'
          ? Date.now() + 48 * HOUR + slot * HOUR
          : Date.now() - 200 * HOUR + slot * HOUR;
      const a = await tx.appointment.create({
        data: {
          businessId: firm.id,
          clientId,
          staffUserId,
          startsAt: new Date(base),
          endsAt: new Date(base + HOUR / 2),
          locationKind: 'PHONE',
        },
        select: { id: true },
      });
      return a.id;
    };
    for (const role of FIRM_ROLES) {
      const mine = await tx.client.create({
        data: {
          businessId: firm.id,
          displayName: `${role} client (fake)`,
          assignedUserId: people[role].id,
        },
        select: { id: true },
      });
      own[role] = {} as Record<Action, string>;
      others[role] = {} as Record<Action, string>;
      for (const action of ACTIONS) {
        own[role][action] = await make(people[role].id, mine.id, action);
        others[role][action] = await make(people.OWNER.id, unassigned.id, action);
      }
    }
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  appOrigin = new URL(env.APP_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const AFTER: Record<Action, string> = {
  confirm: 'SCHEDULED',
  cancel: 'CANCELLED',
  complete: 'COMPLETED',
  'no-show': 'NO_SHOW',
};

describe('Review 2 (P10): status changes for each of the nine roles', () => {
  for (const role of FIRM_ROLES) {
    const refused = (REFUSED as readonly string[]).includes(role);
    const everywhere = (EVERY as readonly string[]).includes(role);
    it(`${role}: own appointments ${refused ? '403' : 'changed'}; another member's with an unassigned client ${refused ? '403' : everywhere ? 'changed' : '404'}`, async () => {
      for (const action of ACTIONS) {
        const mine = await act(role, action, own[role][action]);
        expect([action, mine.status], JSON.stringify(mine.body)).toEqual([
          action,
          refused ? 403 : 200,
        ]);
        const after = await statusOf(own[role][action]);
        if (refused) expect(after).toEqual({ status: 'SCHEDULED', confirmedAt: null });
        else {
          expect(after.status).toBe(AFTER[action]);
          if (action === 'confirm') expect(after.confirmedAt).not.toBeNull();
        }

        const theirs = await act(role, action, others[role][action]);
        expect([action, theirs.status], JSON.stringify(theirs.body)).toEqual([
          action,
          refused ? 403 : everywhere ? 200 : 404,
        ]);
        const left = await statusOf(others[role][action]);
        if (everywhere) expect(left.status).toBe(AFTER[action]);
        else expect(left).toEqual({ status: 'SCHEDULED', confirmedAt: null });
      }
    });
  }
});
