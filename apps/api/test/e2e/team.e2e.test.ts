// End-to-end: T03 team (docs/api/team.yaml). Owner and Admin list; Owners change roles of
// active members; Admins manage Staff only; nobody changes themselves; resend goes through R2's
// InvitesService. One firm never sees or changes another's team.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { TeamMember as MemberShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// The contract drops unknown keys; the tests refuse them, so a leaked field fails.
const TeamMember = z.strictObject({
  ...MemberShape.shape,
  user: z.strictObject(MemberShape.shape.user.shape),
});
type TeamMember = z.infer<typeof TeamMember>;
const ListTeam = z.strictObject({ items: z.array(TeamMember) });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `t03-${key}-${run}@t03.test` });
const people = {
  ownerA: person('owner-a'),
  ownerA2: person('owner-a2'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  formerA: person('former-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  staffB: person('staff-b'),
  ownerPending: person('owner-pending'),
  ownerR1: person('owner-r1'),
  ownerR2: person('owner-r2'),
};
const invitedStaff = { email: `t03-invited-staff-${run}@t03.test`, name: 'Ivy Invited' };
const invitedAdmin = { email: `t03-invited-admin-${run}@t03.test`, name: 'Ada Invited' };
const firms = {} as Record<'a' | 'b' | 'pending' | 'race', { id: string; slug: string }>;
const ids: Record<string, string> = {};

let app: INestApplication;
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'patch' | 'post';
async function call(
  method: Method,
  path: string,
  who: { email: string } | undefined,
  businessId: string,
  body?: object,
): Promise<Response> {
  const token = who ? await tokenFor(who.email) : undefined;
  let req = request(app.getHttpServer())[method](`/api/v1${path}`).set('x-business-id', businessId);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const team = (
  method: Method,
  path: string,
  who: { email: string },
  firm = firms.a,
  body?: object,
) => call(method, `/business/team${path}`, who, firm.id, body);

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function list(who = people.ownerA, firm = firms.a): Promise<TeamMember[]> {
  const res = await team('get', '', who, firm);
  expect(res.status).toBe(200);
  return ListTeam.parse(res.body).items;
}

async function asOwner<T>(businessId: string, fn: Parameters<typeof runInScope<T>>[2]) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, fn);
  } finally {
    await owner.$disconnect();
  }
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'clientA' ? 'CLIENT' : 'STAFF';
      const name = `Fake ${key}`;
      await tx.user.create({ data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name } });
    }
    for (const [key, status] of [
      ['a', 'ACTIVE'],
      ['b', 'ACTIVE'],
      ['pending', 'PENDING_SETUP'],
      ['race', 'ACTIVE'],
    ] as const) {
      const slug = `t03-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status },
        select: { id: true, slug: true },
      });
    }
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER', 'ACTIVE'],
    [firms.a.id, people.ownerA2.id, 'OWNER', 'ACTIVE'],
    [firms.a.id, people.adminA.id, 'ADMIN', 'ACTIVE'],
    [firms.a.id, people.staffA.id, 'STAFF', 'ACTIVE'],
    [firms.a.id, people.staffA2.id, 'STAFF', 'ACTIVE'],
    [firms.a.id, people.formerA.id, 'STAFF', 'DEACTIVATED'],
    [firms.b.id, people.ownerB.id, 'OWNER', 'ACTIVE'],
    [firms.b.id, people.staffB.id, 'STAFF', 'ACTIVE'],
    [firms.pending.id, people.ownerPending.id, 'OWNER', 'ACTIVE'],
    [firms.race.id, people.ownerR1.id, 'OWNER', 'ACTIVE'],
    [firms.race.id, people.ownerR2.id, 'OWNER', 'ACTIVE'],
  ] as const;
  for (const [businessId, userId, role, status] of members) {
    const row = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status }, select: { id: true } }),
    );
    ids[userId] = row.id;
  }
  await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a.id,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    }),
  );
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  // Listening, so supertest shares one server; requests sent together never close it.
  await nest.listen(0, '127.0.0.1');
  app = nest;

  // Two invited members, through R2's invite route.
  for (const [who, role] of [
    [invitedStaff, 'STAFF'],
    [invitedAdmin, 'ADMIN'],
  ] as const) {
    const res = await call('post', '/auth/invites', people.ownerA, firms.a.id, { ...who, role });
    expect(res.status).toBe(201);
    ids[who.email] = (res.body as { membershipId: string }).membershipId;
  }
});

afterAll(async () => {
  await app.close();
});

describe('GET /business/team', () => {
  it('Owner and Admin list everyone in order; staff and clients 403; other firms 404', async () => {
    const items = await list();
    expect(items.map((m) => m.role)).toEqual([
      'OWNER',
      'OWNER',
      'ADMIN',
      'ADMIN',
      'STAFF',
      'STAFF',
      'STAFF',
      'STAFF',
    ]);
    expect(items.filter((m) => m.isYou).map((m) => m.user.email)).toEqual([people.ownerA.email]);
    const ivy = items.find((m) => m.id === ids[invitedStaff.email]);
    expect(ivy).toMatchObject({ status: 'INVITED', user: { email: invitedStaff.email } });
    expect(ivy?.invite?.expiresAt).toBeTruthy();
    expect(items.find((m) => m.user.email === people.staffA.email)?.invite).toBeNull();
    expect((await list(people.adminA)).length).toBe(8);

    for (const who of [people.staffA, people.clientA]) {
      const res = await team('get', '', who);
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
    const outsider = await team('get', '', people.ownerB);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
    expect((await list(people.ownerB, firms.b)).map((m) => m.user.email).sort()).toEqual(
      [people.ownerB.email, people.staffB.email].sort(),
    );
  });

  it('works while the firm is Pending Setup (the wizard’s Team step)', async () => {
    const items = await list(people.ownerPending, firms.pending);
    expect(items.map((m) => m.user.email)).toEqual([people.ownerPending.email]);
  });
});

describe('PATCH /business/team/{id}', () => {
  it('Owners change the role of active members, never their own or an invited one', async () => {
    const staff = ids[people.staffA.id] as string;
    const promoted = await team('patch', `/${staff}`, people.ownerA, firms.a, { role: 'ADMIN' });
    expect([promoted.status, TeamMember.parse(promoted.body).role]).toEqual([200, 'ADMIN']);
    await team('patch', `/${staff}`, people.ownerA, firms.a, { role: 'STAFF' });

    const self = await team('patch', `/${ids[people.ownerA.id]}`, people.ownerA, firms.a, {
      role: 'ADMIN',
    });
    expect([self.status, codeOf(self)]).toEqual([409, 'CANNOT_CHANGE_SELF']);
    const invited = await team('patch', `/${ids[invitedStaff.email]}`, people.ownerA, firms.a, {
      role: 'ADMIN',
    });
    expect([invited.status, codeOf(invited)]).toEqual([409, 'NOT_ACTIVE']);

    // Two owners: one may demote the other, and back.
    const other = ids[people.ownerA2.id] as string;
    expect(
      (await team('patch', `/${other}`, people.ownerA, firms.a, { role: 'STAFF' })).status,
    ).toBe(200);
    expect(
      (await team('patch', `/${other}`, people.ownerA, firms.a, { role: 'OWNER' })).status,
    ).toBe(200);

    const audits = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'membership.role_changed' },
      }),
    );
    expect(audits.map((a) => a.metadata)).toContainEqual({ from: 'STAFF', to: 'ADMIN' });
    expect(JSON.stringify(audits)).not.toContain(people.staffA.email);
  });

  it('refuses Admins (403, even with a bad body), bad input (400), unknown or other firm ids (404)', async () => {
    const staff = ids[people.staffA.id] as string;
    for (const body of [{ role: 'ADMIN' }, { role: 'VIEWER' }]) {
      const res = await team('patch', `/${staff}`, people.adminA, firms.a, body);
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
    for (const body of [{ role: 'VIEWER' }, {}, { role: 'STAFF', businessId: firms.b.id }]) {
      const res = await team('patch', `/${staff}`, people.ownerA, firms.a, body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(
      (await team('patch', '/not-a-uuid', people.ownerA, firms.a, { role: 'STAFF' })).status,
    ).toBe(400);
    for (const id of [randomUUID(), ids[people.staffB.id]]) {
      const res = await team('patch', `/${id}`, people.ownerA, firms.a, { role: 'ADMIN' });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
  });
});

describe('POST /business/team/{id}/deactivate', () => {
  it('Admins deactivate Staff only; nobody deactivates themselves; repeating is harmless', async () => {
    const owner2 = ids[people.ownerA2.id] as string;
    const byAdmin = await team('post', `/${owner2}/deactivate`, people.adminA);
    expect([byAdmin.status, codeOf(byAdmin)]).toEqual([403, 'FORBIDDEN']);
    const self = await team('post', `/${ids[people.ownerA.id]}/deactivate`, people.ownerA);
    expect([self.status, codeOf(self)]).toEqual([409, 'CANNOT_CHANGE_SELF']);

    const staff2 = ids[people.staffA2.id] as string;
    const done = await team('post', `/${staff2}/deactivate`, people.adminA);
    expect([done.status, TeamMember.parse(done.body).status]).toEqual([200, 'DEACTIVATED']);
    expect((await team('post', `/${staff2}/deactivate`, people.adminA)).status).toBe(200);
    // Their access to this firm ends at once.
    const after = await call('get', '/business', people.staffA2, firms.a.id);
    expect(after.status).toBe(404);

    const audits = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'membership.deactivated', entityId: staff2 },
      }),
    );
    expect(audits).toHaveLength(1);
  });

  it('deactivating an invited member cancels the invite; other firms get 404', async () => {
    const admin = ids[invitedAdmin.email] as string;
    const res = await team('post', `/${admin}/deactivate`, people.ownerA);
    expect(TeamMember.parse(res.body)).toMatchObject({ status: 'DEACTIVATED', invite: null });
    const open = await asOwner(firms.a.id, (tx) =>
      tx.invite.count({ where: { membershipId: admin, acceptedAt: null, revokedAt: null } }),
    );
    expect(open).toBe(0);
    const outsider = await team(
      'post',
      `/${ids[people.staffA.id]}/deactivate`,
      people.ownerB,
      firms.b,
    );
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('POST /business/team/{id}/resend-invite', () => {
  it('sends a new link to an invited member; 409 for anyone else; Admins only for Staff', async () => {
    const ivy = ids[invitedStaff.email] as string;
    const before = (await list()).find((m) => m.id === ivy)?.invite?.sentAt;
    const res = await team('post', `/${ivy}/resend-invite`, people.adminA);
    expect(res.status).toBe(200);
    const after = TeamMember.parse(res.body).invite?.sentAt;
    expect(after && before && after > before).toBe(true);

    for (const id of [ids[people.staffA.id], ids[people.formerA.id]]) {
      const again = await team('post', `/${id}/resend-invite`, people.ownerA);
      expect([again.status, codeOf(again)]).toEqual([409, 'NOT_INVITED']);
    }
    const owner2 = ids[people.ownerA2.id] as string;
    const byAdmin = await team('post', `/${owner2}/resend-invite`, people.adminA);
    expect([byAdmin.status, codeOf(byAdmin)]).toEqual([403, 'FORBIDDEN']);
    expect((await team('post', `/${randomUUID()}/resend-invite`, people.ownerA)).status).toBe(404);
  });
});

describe('two owners at the same moment', () => {
  it('demoting each other: one wins, the firm always keeps an active owner', async () => {
    const [r1, r2] = await Promise.all([
      team('patch', `/${ids[people.ownerR2.id]}`, people.ownerR1, firms.race, { role: 'ADMIN' }),
      team('patch', `/${ids[people.ownerR1.id]}`, people.ownerR2, firms.race, { role: 'ADMIN' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const owners = await asOwner(firms.race.id, (tx) =>
      tx.membership.count({
        where: { businessId: firms.race.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    );
    expect(owners).toBe(1);
  });
});
