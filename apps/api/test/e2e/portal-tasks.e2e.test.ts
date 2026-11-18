// End-to-end: Client Portal Review One T16 (Tasks Review T16 with T12), the client's tasks in the
// portal's Requests area (contract packages/types/src/tasks/portal.ts): only the tasks the firm
// marks visible, only their approved fields and checklist, only the attachments approved one by
// one, never internal notes; another client sees none of them, an AUTHORIZED login sees no files,
// and the per-client Tasks & Requests switch closes the routes (403 MODULE_OFF). Synthetic data.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { MyTask, MyTaskList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT') => ({
  id: randomUUID(),
  email: `r56t-${key}-${run}@r56.test`,
  pool,
});
const people = {
  owner: person('owner', 'STAFF'),
  primary: person('primary', 'CLIENT'),
  authorized: person('authorized', 'CLIENT'),
  other: person('other', 'CLIENT'),
};
type Who = (typeof people)[keyof typeof people];
const firm = { id: '', slug: `r56t-${run}` };
const ids = {} as Record<string, string>;
const tokens = new Map<string, string>();
let app: INestApplication;
const INTERNAL_NOTE = 'Fake internal note: never for the client';

async function asOwner<T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId: firm.id }, work);
  } finally {
    await owner.$disconnect();
  }
}
async function tokenFor(who: Who) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200);
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return token;
}
async function portal(path: string, who: Who) {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firm.slug}/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = <T>(res: Response, schema: { parse: (v: unknown) => T }): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
};
const list = async (who: Who) => ok(await portal('/tasks', who), MyTaskList).items;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const [key, p] of Object.entries(people)) {
        await tx.user.create({
          data: { id: p.id, cognitoSub: p.id, pool: p.pool, email: p.email, name: `Fake ${key}` },
        });
      }
      firm.id = (
        await tx.business.create({
          data: { slug: firm.slug, name: `Fake Firm ${run}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    });
  } finally {
    await owner.$disconnect();
  }
  await asOwner(async (tx) => {
    const businessId = firm.id;
    await tx.membership.create({
      data: { businessId, userId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}`, status: 'ACTIVE' },
    });
    for (const key of ['c1', 'c2'] as const) {
      const c = await tx.client.create({
        data: { businessId, displayName: `Sample ${key} (fake)`, email: `${key}-${run}@c.test` },
      });
      ids[key] = c.id;
      ids[`e${key}`] = (
        await tx.engagement.create({
          data: { businessId, clientId: c.id, serviceId: service.id, title: `Return ${key}` },
        })
      ).id;
    }
    for (const [who, clientId, portalRole] of [
      [people.primary, ids.c1, 'PRIMARY'],
      [people.authorized, ids.c1, 'AUTHORIZED'],
      [people.other, ids.c2, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: who.id,
          clientId: clientId!,
          email: who.email,
          portalRole,
          status: 'ACTIVE',
        },
      });
    }
    const doc = async (key: string, direction: 'FIRM_TO_CLIENT' | 'INTERNAL', name: string) => {
      const tag = randomUUID();
      ids[key] = (
        await tx.document.create({
          data: {
            businessId,
            clientId: ids.c1!,
            engagementId: ids.ec1!,
            direction,
            fileName: name,
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: tag.replace(/-/g, '').padEnd(64, '0'),
            s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
          },
        })
      ).id;
    };
    await doc('docApproved', 'FIRM_TO_CLIENT', 'Approved checklist (fake).pdf');
    await doc('docUnapproved', 'FIRM_TO_CLIENT', 'Staff worksheet (fake).pdf');
    await doc('docInternal', 'INTERNAL', 'Internal memo (fake).pdf');
    const task = async (
      key: string,
      data: Partial<{
        clientId: string;
        clientVisible: boolean;
        status: 'OPEN' | 'DONE' | 'CANCELLED';
        progress: 'NOT_STARTED' | 'WAITING';
        dueOn: Date;
        completedAt: Date;
        archivedAt: Date;
      }>,
    ) => {
      ids[key] = (
        await tx.task.create({
          data: {
            businessId,
            clientId: ids.c1!,
            title: `Fake ${key} task`,
            details: `Fake instructions for ${key}`,
            internalNotes: INTERNAL_NOTE,
            priority: 'HIGH',
            assignedUserId: people.owner.id,
            ...data,
          },
        })
      ).id;
    };
    await task('visible', {
      clientVisible: true,
      progress: 'WAITING',
      dueOn: new Date('2026-12-01T00:00:00Z'),
    });
    await task('done', { clientVisible: true, status: 'DONE', completedAt: new Date() });
    await task('internal', {});
    await task('cancelled', { clientVisible: true, status: 'CANCELLED' });
    await task('archived', { clientVisible: true, archivedAt: new Date() });
    await task('theirs', { clientVisible: true, clientId: ids.c2 });
    let position = 0;
    for (const [label, done] of [
      ['Sign the engagement letter', true],
      ['Upload last year’s return', false],
    ] as const)
      await tx.taskChecklistItem.create({
        data: {
          businessId,
          taskId: ids.visible!,
          label,
          position: position++,
          completedAt: done ? new Date() : null,
        },
      });
    for (const [key, approved] of [
      ['docApproved', true],
      ['docUnapproved', false],
      // The database refuses an internal document as client-visible, so it can only sit there.
      ['docInternal', false],
    ] as const)
      await tx.taskAttachment.create({
        data: {
          businessId,
          taskId: ids.visible!,
          documentId: ids[key]!,
          clientVisible: approved,
        },
      });
  });

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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the client’s tasks in the portal (T16)', () => {
  it('lists only the visible tasks, open first; never internal, cancelled, archived or another client’s', async () => {
    const mine = await list(people.primary);
    expect(mine.map((t) => t.id)).toEqual([ids.visible, ids.done]);
    expect(mine[0]).toEqual({
      id: ids.visible,
      title: 'Fake visible task',
      status: 'WAITING_ON_YOU',
      dueOn: '2026-12-01',
      dueTime: null,
      checklist: { done: 1, total: 2 },
    });
    expect(mine[1]?.status).toBe('COMPLETED');
    expect((await list(people.other)).map((t) => t.id)).toEqual([ids.theirs]);
  });

  it('shows only the approved fields, the checklist and the approved, non-internal files', async () => {
    const res = await portal(`/tasks/${ids.visible}`, people.primary);
    const t = ok(res, MyTask);
    expect(t.details).toBe('Fake instructions for visible');
    expect(t.checklistItems.map((i) => [i.label, i.done])).toEqual([
      ['Sign the engagement letter', true],
      ['Upload last year’s return', false],
    ]);
    expect(t.attachments).toEqual([
      { documentId: ids.docApproved, fileName: 'Approved checklist (fake).pdf' },
    ]);
    // Nothing staff-only leaves the API, under any name.
    const raw = JSON.stringify(res.body);
    for (const leak of [
      INTERNAL_NOTE,
      'internalNotes',
      'HIGH',
      people.owner.id,
      'Staff worksheet',
      'Internal memo',
    ])
      expect(raw).not.toContain(leak);
  });

  it('gives an AUTHORIZED login the task but none of the firm’s files', async () => {
    const t = ok(await portal(`/tasks/${ids.visible}`, people.authorized), MyTask);
    expect(t.checklist.total).toBe(2);
    expect(t.attachments).toEqual([]);
  });

  it('answers 404 for a task that is not visible, not the client’s, cancelled or archived', async () => {
    for (const key of ['internal', 'theirs', 'cancelled', 'archived']) {
      const res = await portal(`/tasks/${ids[key]}`, people.primary);
      expect([key, res.status, codeOf(res)]).toEqual([key, 404, 'NOT_FOUND']);
    }
  });

  it('closes both routes when the client’s Tasks & Requests switch is off (403 MODULE_OFF)', async () => {
    await asOwner((tx) =>
      tx.portalModuleVisibility.create({
        data: { businessId: firm.id, clientId: ids.c1!, module: 'TASKS_REQUESTS', visible: false },
      }),
    );
    for (const path of ['/tasks', `/tasks/${ids.visible}`]) {
      const res = await portal(path, people.primary);
      expect([path, res.status, codeOf(res)]).toEqual([path, 403, 'MODULE_OFF']);
    }
    // Another client of the firm is not affected.
    expect((await list(people.other)).length).toBe(1);
  });
});
