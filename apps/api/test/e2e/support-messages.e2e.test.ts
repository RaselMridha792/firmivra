// End-to-end: Help & Support's in-app message (R55; Octavia's dashboard review of Oct 25, D2). A
// member of the firm writes to the Firmivra team: a Portal ticket in the Super Admin queue with
// the member as creator and contact. One key sends one message; a client is refused; one firm's
// ticket is never another's; the audit row names the ticket, never the text. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { SupportMessageSent } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const tokens = new Map<string, string>();
async function send(who: { email: string }, body: object) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return request(app.getHttpServer())
    .post('/api/v1/business/support/messages')
    .set('authorization', `Bearer ${token}`)
    .send(body);
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const asPlatform = async <T>(work: Parameters<typeof runInScope<T>>[2]) => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(db, { kind: 'platform' }, work);
  } finally {
    await db.$disconnect();
  }
};
const message = () => ({
  requestId: randomUUID(),
  subject: 'Fake question about invoices',
  message: 'How do I resend an invoice? (fake)',
  page: '/invoices',
});

describe('POST /business/support/messages', () => {
  it('raises a Portal ticket in the queue, from Staff too, with the page and an audit row', async () => {
    const body = message();
    const res = await send(fx.users.staffA, body);
    expect(res.status).toBe(201);
    const sent = SupportMessageSent.parse(res.body);
    const ticket = await asPlatform((tx) =>
      tx.supportTicket.findFirstOrThrow({ where: { idempotencyKey: body.requestId } }),
    );
    expect(ticket).toMatchObject({
      number: sent.number,
      businessId: fx.firmA.id,
      contactUserId: fx.users.staffA.id,
      createdByUserId: fx.users.staffA.id,
      source: 'PORTAL',
      subject: 'Support message: Fake question about invoices',
      description: 'How do I resend an invoice? (fake)\n\nPage: /invoices',
    });
    const audit = await asPlatform((tx) =>
      tx.auditLog.findMany({ where: { action: 'support.message_sent', entityId: ticket.id } }),
    );
    expect(audit.map((a) => [a.businessId, a.actorUserId, a.metadata])).toEqual([
      [fx.firmA.id, fx.users.staffA.id, { number: sent.number }],
    ]);
  });

  it('sends one message for one key, and refuses a key another request used', async () => {
    const body = message();
    const first = SupportMessageSent.parse((await send(fx.users.ownerA, body)).body);
    const again = await send(fx.users.ownerA, { ...body, message: 'Changed (fake)' });
    expect([again.status, SupportMessageSent.parse(again.body)]).toEqual([201, first]);
    const tickets = await asPlatform((tx) =>
      tx.supportTicket.count({ where: { idempotencyKey: body.requestId } }),
    );
    expect(tickets).toBe(1);
    // Firm B reusing firm A's key never reads firm A's ticket.
    const other = await send(fx.users.ownerB, body);
    expect(other.status).not.toBe(201);
    expect(JSON.stringify(other.body)).not.toContain(String(first.number));
  });

  it('checks the input and refuses a client', async () => {
    for (const bad of [
      { ...message(), subject: ' ' },
      { ...message(), message: '' },
      { ...message(), page: '/clients?search=secret' },
      { ...message(), requestId: 'not-a-uuid' },
      { ...message(), businessId: fx.firmB.id },
    ]) {
      expect(code(await send(fx.users.ownerA, bad))).toBe('VALIDATION_FAILED');
    }
    expect((await send(fx.users.clientA, message())).status).toBe(403);
  });
});
