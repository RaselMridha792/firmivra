// End-to-end: a new firm's owner link from Firmivra (R4 through R2's InvitesService, fromPlatform).
// The invite row is written in platform scope, so the database marks it sent_by_platform and keeps
// the token-free copy in platform_owner_invites; the membership stays in the firm's scope. A firm's
// own invites are unchanged. The activation mailer is replaced by a recorder.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  createPrismaClient,
  type Database,
  runInScope,
  type Scope,
  type TxClient,
} from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { ACTIVATION_MAILER, type ActivationEmail } from '../../src/auth/activation-mailer.js';
import { InvitesService } from '../../src/auth/invites.service.js';
import { DATABASE, OUTSIDE_CALL_LIMITS } from '../../src/database/database.module.js';

const fx = inject('fixtures');
let app: INestApplication;
let invites: InvitesService;
const mails: ActivationEmail[] = [];
const tag = `r16oip${randomUUID().slice(0, 8)}`;
let firmId = '';

async function as<T>(scope: Scope, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, fn);
  } finally {
    await owner.$disconnect();
  }
}
const copies = (membershipId: string) =>
  as({ kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
    tx.platformOwnerInvite.findMany({ where: { membershipId }, orderBy: { sentAt: 'asc' } }),
  );
const invitesOf = (membershipId: string) =>
  as({ kind: 'business', businessId: firmId }, (tx) =>
    tx.invite.findMany({ where: { membershipId }, orderBy: { createdAt: 'asc' } }),
  );

beforeAll(async () => {
  firmId = (
    await as({ kind: 'platform' }, (tx) =>
      tx.business.create({ data: { name: `Sample ${tag}`, slug: tag }, select: { id: true } }),
    )
  ).id;
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(ACTIVATION_MAILER)
    .useValue({
      send: (m: ActivationEmail) => {
        mails.push(m);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  invites = app.get(InvitesService, { strict: false });
});

afterAll(async () => {
  await app.close();
});

describe('Owner links from the platform', () => {
  it('writes the link in platform scope with a copy for the Super Admin; resend and activation follow', async () => {
    const email = `owner@${tag}.example.test`;
    const first = await invites.createInvite({
      businessId: firmId,
      email,
      name: 'Riley Sample',
      role: 'OWNER',
      invitedBy: null,
      fromPlatform: true,
    });
    const [row] = await invitesOf(first.membershipId);
    expect(row).toMatchObject({ id: first.id, sentByPlatform: true, invitedByUserId: null });
    expect(await copies(first.membershipId)).toEqual([
      expect.objectContaining({ inviteId: first.id, businessId: firmId, revokedAt: null }),
    ]);
    const membership = await as({ kind: 'business', businessId: firmId }, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { id: first.membershipId } }),
    );
    expect(membership).toMatchObject({ role: 'OWNER', status: 'INVITED' });

    const second = await invites.resendInvite({
      businessId: firmId,
      membershipId: first.membershipId,
      invitedBy: null,
      fromPlatform: true,
    });
    const after = await copies(first.membershipId);
    expect(after.map((c) => [c.inviteId, c.revokedAt === null])).toEqual([
      [first.id, false],
      [second.id, true],
    ]);

    // The newest link activates; its copy shows it accepted.
    const token = new URL(mails.at(-1)?.link ?? '').hash.replace('#token=', '');
    await request(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .set('x-forwarded-for', '203.0.113.77, 10.0.0.5')
      .send({ token, password: 'Owner-password-2026' })
      .expect(200);
    expect((await copies(first.membershipId)).at(-1)?.acceptedAt).not.toBeNull();
  });

  it("leaves a firm's own invites as they were: no mark, no copy", async () => {
    const made = await invites.createInvite({
      businessId: firmId,
      email: `admin@${tag}.example.test`,
      name: 'Avery Sample',
      role: 'ADMIN',
      invitedBy: null,
    });
    expect((await invitesOf(made.membershipId))[0]?.sentByPlatform).toBe(false);
    expect(await copies(made.membershipId)).toEqual([]);
  });

  it('sends only owner links from the platform, and never with an inviting member', async () => {
    const base = { businessId: firmId, name: 'Quinn Sample', fromPlatform: true } as const;
    await expect(
      invites.createInvite({
        ...base,
        email: `staff@${tag}.example.test`,
        role: 'STAFF',
        invitedBy: null,
      }),
    ).rejects.toThrow(/Only an owner link/);
    // Refused before any login was made for the address.
    expect(
      await as({ kind: 'platform' }, (tx) =>
        tx.user.count({ where: { email: `staff@${tag}.example.test` } }),
      ),
    ).toBe(0);
    await expect(
      invites.createInvite({
        ...base,
        email: `other@${tag}.example.test`,
        role: 'STAFF',
        invitedBy: { userId: fx.users.ownerA.id, role: 'OWNER' },
      }),
    ).rejects.toThrow(/no inviting member/);
  });

  it('gives the platform step the 15 s limits: it can wait on an invite transaction', async () => {
    const database = app.get<Database>(DATABASE, { strict: false });
    const spy = vi.spyOn(database, 'withScope');
    try {
      await invites.createInvite({
        businessId: firmId,
        email: `limits@${tag}.example.test`,
        name: 'Lee Sample',
        role: 'OWNER',
        invitedBy: null,
        fromPlatform: true,
      });
      const platform = spy.mock.calls.filter(([scope]) => scope.kind === 'platform');
      expect(platform.map(([, , limits]) => limits)).toEqual([OUTSIDE_CALL_LIMITS]);
    } finally {
      spy.mockRestore();
    }
  });

  it("never resends another firm's membership: 404, and no link or copy", async () => {
    const firmB = await as({ kind: 'business', businessId: fx.firmB.id }, (tx) =>
      tx.membership.findFirstOrThrow({ where: { userId: fx.users.ownerB.id } }),
    );
    const res = invites.resendInvite({
      businessId: firmId,
      membershipId: firmB.id,
      invitedBy: null,
      fromPlatform: true,
    });
    await expect(res).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(await copies(firmB.id)).toEqual([]);
    expect(
      await as({ kind: 'business', businessId: fx.firmB.id }, (tx) =>
        tx.invite.count({ where: { membershipId: firmB.id } }),
      ),
    ).toBe(0);
  });

  it("refuses a platform resend of a membership that isn't an owner's", async () => {
    const made = await invites.createInvite({
      businessId: firmId,
      email: `resend-admin@${tag}.example.test`,
      name: 'Sam Sample',
      role: 'ADMIN',
      invitedBy: null,
    });
    await expect(
      invites.resendInvite({
        businessId: firmId,
        membershipId: made.membershipId,
        invitedBy: null,
        fromPlatform: true,
      }),
    ).rejects.toThrow(/Only an owner link/);
    expect(await invitesOf(made.membershipId)).toHaveLength(1);
  });
});
