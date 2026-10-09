// End-to-end: R20 steps 4 and 5, internal notes and private notes (contract in
// packages/types/src/messages). Internal notes stay on the firm side (Staff: their clients; the
// author, Owner and Admins change one). A private note and its reminder belong to one portal login:
// no staff role, no other login and no scope without that actor ever sees it. No text in audit.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { InternalNote as NoteShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Note = z.strictObject({
  ...NoteShape.shape,
  author: z.strictObject(NoteShape.shape.author.shape),
});
const Mine = z.strictObject({
  note: z
    .strictObject({
      body: z.string(),
      savedAt: z.string(),
      reminder: z.strictObject({ remindAt: z.string(), sentAt: z.string().nullable() }).nullable(),
    })
    .nullable(),
});
type Note = z.infer<typeof Note>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r20n-${key}-${run}@r20.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  primary: person('primary'),
  spouse: person('spouse'),
  other: person('other'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r20n-a-${run}`,
  slugB: `r20n-b-${run}`,
  one: '',
  two: '',
  old: '',
  engagementTwo: '',
};

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

async function firm(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function portal(
  method: 'get' | 'put' | 'delete' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const addNote = async (body: object, who = people.ownerA, clientId = ids.one) =>
  Note.parse(expectOk(await firm('post', `/clients/${clientId}/notes`, who, body), 201).body);
const mine = async (who: { email: string }) =>
  Mine.parse(expectOk(await portal('get', '/notes', who)).body).note;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
/** The app's own database login, as the API connects: row-level security applies. */
const asApp = async <T>(actorUserId: string | undefined, fn: (tx: TxClient) => Promise<T>) => {
  const appDb = createPrismaClient(fx.appUrl);
  try {
    return await runInScope(appDb, { kind: 'business', businessId: ids.firmA, actorUserId }, fn);
  } finally {
    await appDb.$disconnect();
  }
};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['primary', 'spouse', 'other', 'clientB'].includes(key) ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R20 ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.one = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    ids.old = (
      await tx.client.create({ data: { ...A, displayName: 'Old', archivedAt: new Date() } })
    ).id;
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.spouse, ids.one, 'SPOUSE'],
      [people.other, ids.two, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    }
    const service = await tx.service.create({
      data: { ...A, kind: 'OTHER', name: `Other ${run}` },
    });
    ids.engagementTwo = (
      await tx.engagement.create({
        data: { ...A, clientId: ids.two, serviceId: service.id, title: 'Two' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const clientB = await tx.client.create({ data: { ...B, displayName: 'B one' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: clientB.id,
        email: people.clientB.email,
        status: 'ACTIVE',
      },
    });
  });
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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('internal notes', () => {
  it('the firm adds, filters, edits and deletes; Staff change only their own', async () => {
    const owners = await addNote({ body: `Owner note ${run}` });
    expect(owners).toMatchObject({
      clientId: ids.one,
      engagementId: null,
      author: { userId: people.ownerA.id, name: 'Fake R20 ownerA' },
      canEdit: true,
    });
    const staffs = await addNote({ body: 'Staff note' }, people.staffA);
    const tagged = await addNote(
      { body: 'Two service', engagementId: ids.engagementTwo },
      people.ownerA,
      ids.two,
    );
    expect(tagged.engagementId).toBe(ids.engagementTwo);

    const seen = z
      .strictObject({ items: z.array(Note) })
      .parse(expectOk(await firm('get', `/clients/${ids.one}/notes`, people.staffA)).body).items;
    expect(seen.map((n) => [n.id, n.canEdit])).toEqual([
      [staffs.id, true],
      [owners.id, false],
    ]);
    const filtered = expectOk(
      await firm(
        'get',
        `/clients/${ids.two}/notes?engagementId=${ids.engagementTwo}`,
        people.ownerA,
      ),
    ).body as { items: Note[] };
    expect(filtered.items.map((n) => n.id)).toEqual([tagged.id]);

    const denied = await firm('patch', `/notes/${owners.id}`, people.staffA, { body: 'x' });
    expect([denied.status, codeOf(denied)]).toEqual([403, 'FORBIDDEN']);
    expect((await firm('delete', `/notes/${owners.id}`, people.staffA, {})).status).toBe(403);
    const edited = Note.parse(
      expectOk(await firm('patch', `/notes/${staffs.id}`, people.staffA, { body: 'Edited' })).body,
    );
    expect(edited.body).toBe('Edited');
    // The Owner changes anyone's.
    expectOk(await firm('patch', `/notes/${staffs.id}`, people.ownerA, { body: 'By owner' }));
    expectOk(await firm('delete', `/notes/${staffs.id}`, people.ownerA, {}));
    expect((await firm('patch', `/notes/${staffs.id}`, people.ownerA, { body: 'x' })).status).toBe(
      404,
    );
  });

  it("refuses another client's engagement, unassigned Staff and another firm", async () => {
    const wrong = await firm('post', `/clients/${ids.one}/notes`, people.ownerA, {
      body: 'x',
      engagementId: ids.engagementTwo,
    });
    expect(wrong.status).toBe(404);
    const note = await addNote({ body: 'Private to the firm' });
    for (const [method, path, body] of [
      ['get', `/clients/${ids.one}/notes`, undefined],
      ['post', `/clients/${ids.one}/notes`, { body: 'x' }],
      ['patch', `/notes/${note.id}`, { body: 'x' }],
      ['delete', `/notes/${note.id}`, {}],
    ] as const) {
      const res = await firm(method, path, people.staffA2, body);
      expect([path, res.status]).toEqual([path, 404]);
      const b = await firm(method, path, people.ownerB, body, ids.firmB);
      expect([path, b.status]).toEqual([path, 404]);
    }
  });

  it('never reaches the portal, and the audit log has no text', async () => {
    const text = `Internal only ${run}`;
    await addNote({ body: text });
    const thread = await firm('post', `/clients/${ids.one}/message-threads`, people.ownerA, {
      subject: 'Hello',
      body: 'Hi',
    });
    const threadId = (thread.body as { id: string }).id;
    for (const path of ['/notes', '/messages', `/messages/${threadId}`]) {
      const res = expectOk(await portal('get', path, people.primary));
      expect(JSON.stringify(res.body)).not.toContain(text);
    }
    expect((await portal('get', '/internal-notes', people.primary)).status).toBe(404);
    const rows = await asApp(undefined, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityType: 'note' } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(run);
  });
});

describe('private notes', () => {
  it('saves versions; the reminder is set, kept, moved and removed', async () => {
    expect(await mine(people.primary)).toBeNull();
    const at = future(10);
    const first = Mine.parse(
      expectOk(
        await portal('put', '/notes', people.primary, {
          body: `Gather 1099s ${run}`,
          remindAt: at,
        }),
      ).body,
    ).note;
    expect(first).toMatchObject({
      body: `Gather 1099s ${run}`,
      reminder: { remindAt: at, sentAt: null },
    });

    const kept = Mine.parse(
      expectOk(await portal('put', '/notes', people.primary, { body: 'Second version' })).body,
    ).note;
    expect(kept).toMatchObject({ body: 'Second version', reminder: { remindAt: at } });

    const later = future(20);
    const moved = Mine.parse(
      expectOk(await portal('put', '/notes/reminder', people.primary, { remindAt: later })).body,
    ).note;
    expect(moved?.reminder?.remindAt).toBe(later);
    const removed = Mine.parse(
      expectOk(await portal('delete', '/notes/reminder', people.primary, {})).body,
    ).note;
    expect(removed).toMatchObject({ body: 'Second version', reminder: null });

    const cleared = Mine.parse(
      expectOk(
        await portal('put', '/notes', people.primary, { body: 'Third', remindAt: future(5) }),
      ).body,
    ).note;
    expect(cleared?.reminder).not.toBeNull();
    const none = Mine.parse(
      expectOk(await portal('put', '/notes', people.primary, { body: 'Fourth', remindAt: null }))
        .body,
    ).note;
    expect(none?.reminder).toBeNull();
    // At most one reminder waits, whatever the history.
    const waiting = await asApp(people.primary.id, (tx) =>
      tx.clientNoteReminder.count({ where: { businessId: ids.firmA, userId: people.primary.id } }),
    );
    expect(waiting).toBe(0);
  });

  it('refuses a reminder before the first save or in the past', async () => {
    const early = await portal('put', '/notes/reminder', people.other, { remindAt: future(3) });
    expect(early.status).toBe(404);
    const past = await portal('put', '/notes', people.other, {
      body: 'x',
      remindAt: '2020-01-01T00:00:00Z',
    });
    expect([past.status, codeOf(past)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('only its own login sees it: not the spouse, not staff, not the database without the actor', async () => {
    const text = `Spouse must not see ${run}`;
    expectOk(await portal('put', '/notes', people.primary, { body: text }));
    expect(await mine(people.spouse)).toBeNull();
    expect((await mine(people.other))?.body ?? null).not.toBe(text);
    for (const who of [people.ownerA, people.staffA]) {
      for (const path of [`/clients/${ids.one}/notes`, `/clients/${ids.one}/message-threads`]) {
        const res = await firm('get', path, who);
        expect(JSON.stringify(res.body)).not.toContain(text);
      }
    }
    const visible = (actor?: string) =>
      asApp(actor, (tx) =>
        tx.clientPrivateNote.count({ where: { businessId: ids.firmA, userId: people.primary.id } }),
      );
    expect(await visible(undefined)).toBe(0);
    expect(await visible(people.spouse.id)).toBe(0);
    expect(await visible(people.ownerA.id)).toBe(0);
    expect(await visible(people.primary.id)).toBeGreaterThan(0);
    const audit = await asApp(undefined, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityType: 'client_private_note' } }),
    );
    expect(audit.length).toBeGreaterThan(0);
    for (const row of audit) expect(row.entityId).toBeNull();
    expect(JSON.stringify(audit)).not.toContain(run);
  });

  it("a client of firm A has no note at firm B's portal", async () => {
    const res = await portal('get', '/notes', people.primary, undefined, ids.slugB);
    expect([401, 404]).toContain(res.status);
  });
});
