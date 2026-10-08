// End-to-end: the public application form, POST /firm-applications (R4 step 2). The EIN is kept
// as its last 4 and a keyed hash in their columns, never in `data`; limits per IP and per email;
// the honeypot; the throttled "received" email, sent after the commit; the audit row without the
// body; and a missing EIN_HASH_KEY failing closed. The NotifyService is replaced by a recorder
// that checks, from another connection, that the application was committed before each send.
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { FirmApplicationRecord, SubmitFirmApplicationResponse } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';
import {
  EIN_HASH_KEY,
  type EinHashKey,
  loadEinHashKey,
} from '../../src/firm-applications/ein-hash.js';
import { StoredApplication } from '../../src/firm-applications/firm-applications.service.js';
import { SUBMIT_LIMITS } from '../../src/firm-applications/submit.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const KEY = randomBytes(32).toString('hex');
const tag = `r4sub${randomUUID().slice(0, 8)}`;
let env: Env;
let app: INestApplication;
let origin: string;
const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
/** What the database owner sees (platform scope), from its own connection. */
const asOwner = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(owner, { kind: 'platform' }, fn);

/** Each message, with how many applications from its address were committed when it went. */
const sent: { message: NotifyMessage; committed: number }[] = [];
let sendFails = false;

/** A viewer of its own (requests from one test never count against another's). */
const newIp = () =>
  `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
/** A synthetic EIN, unique to this run (test EINs start with 00). */
const newEin = () => `00-${String(randomInt(10_000_000)).padStart(7, '0')}`;
const emailOf = (n: number | string) => `casey${n}@${tag}.example.test`;

const form = (
  n: number | string,
  over: { ein?: string; email?: string; fullName?: string; honeypot?: string } = {},
) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Applicant ${tag} ${n}`,
    dbaName: '',
    entityType: 'LLC',
    ...(over.ein ? { ein: over.ein } : {}),
    phone: '(404) 555-0101',
    website: `sample-${n}.example.test`,
    address: { line1: '1 Example Way', city: 'Atlanta', state: 'ga', postalCode: '30301' },
    services: ['TAX_PREPARATION', 'BOOKKEEPING', 'TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: over.fullName ?? `Casey Example ${n}`,
    email: over.email ?? emailOf(n),
    phone: '+1 404 555 0102',
    // An international number: application phones take R3's international Phone.
    alternatePhone: '+44 20 7946 0958',
  },
  account: { requestedPlan: 'STARTER', teamSize: 3, clientVolume: 'UNDER_100' },
  credentials: [{ type: 'PTIN', number: 'P00000001' }],
  agreement: { acceptedTerms: true, certifiedAccurate: true },
  ...(over.honeypot !== undefined ? { honeypot: over.honeypot } : {}),
});

async function makeApp(einKey: EinHashKey): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(EIN_HASH_KEY)
    .useValue(einKey)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: async (message: NotifyMessage) => {
        const committed = await asOwner((tx) =>
          tx.firmApplication.count({ where: { contactEmail: message.to } }),
        );
        sent.push({ message, committed });
        // A provider's error may name the address, which must never reach the log.
        if (sendFails) throw new Error(`No mailbox ${message.to}`);
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  return nest;
}

const submit = (body: object, ip = newIp(), on = app) =>
  request(on.getHttpServer())
    .post('/api/v1/firm-applications')
    .set('origin', origin)
    .set('x-forwarded-for', `${ip}, 10.0.0.5`)
    .send(body);

const stored = (email: string) =>
  asOwner((tx) =>
    tx.firmApplication.findMany({ where: { contactEmail: email }, orderBy: { createdAt: 'asc' } }),
  );

let adminToken: string;
const record = async (id: string) =>
  FirmApplicationRecord.parse(
    (
      await request(app.getHttpServer())
        .get(`/api/v1/admin/firm-applications/${id}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200)
    ).body,
  );

/** The service's warnings (the spy also sees other loggers'). */
const spyOnWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
const ours = (warn: ReturnType<typeof spyOnWarn>) =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('Firm application'));

beforeAll(async () => {
  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  origin = new URL(env.APP_BASE_URL).origin;
  app = await makeApp(loadEinHashKey({ EIN_HASH_KEY: KEY }));
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email: fx.users.admin.email })
    .expect(200);
  adminToken = (res.body as { token: string }).token;
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

beforeEach(() => {
  sent.length = 0;
  sendFails = false;
});

describe('POST /firm-applications', () => {
  it('stores the form without the EIN, its last 4 and keyed hash in their columns, and mails after the commit', async () => {
    const ein = newEin();
    const res = await submit(form(1, { ein })).expect(200);
    expect(SubmitFirmApplicationResponse.parse(res.body)).toEqual({ received: true });

    const [row] = await stored(emailOf(1));
    const digits = ein.replace('-', '');
    expect(row).toMatchObject({
      status: 'PENDING_REVIEW',
      legalName: `Sample Applicant ${tag} 1`,
      dbaName: null,
      contactName: 'Casey Example 1',
      contactEmail: emailOf(1),
      contactPhone: '+14045550102',
      einLast4: digits.slice(-4),
    });
    expect(Buffer.from(row!.einHash!)).toEqual(
      createHmac('sha256', Buffer.from(KEY, 'hex')).update(digits).digest(),
    );
    // No key starting with "ein" anywhere in the stored form (R0's #80 refuses one).
    expect(JSON.stringify(row!.data)).not.toMatch(/"ein/i);
    expect(JSON.stringify(row!.data)).not.toContain(digits);
    expect(StoredApplication.parse(row!.data)).toMatchObject({
      business: {
        services: ['TAX_PREPARATION', 'BOOKKEEPING'],
        website: 'https://sample-1.example.test',
      },
      primaryAdmin: { alternatePhone: '+442079460958', title: null, preferredContact: 'EMAIL' },
      credentials: [{ type: 'PTIN', number: 'P00000001', issuedBy: null }],
    });

    const a = await record(row!.id);
    expect(a).toMatchObject({ status: 'PENDING_REVIEW', formReadable: true });
    expect(a.business?.einLast4).toBe(digits.slice(-4));
    expect(a.history.map((h) => h.type)).toEqual(['SUBMITTED']);

    // One "received" email, after the application was committed (seen from another connection).
    expect(sent).toEqual([
      {
        message: {
          template: 'firm-application.received',
          to: emailOf(1),
          businessId: null,
          data: { name: 'Casey Example 1', legalName: `Sample Applicant ${tag} 1` },
        },
        committed: 1,
      },
    ]);

    // The audit row: a platform event without the body (no firm, no actor, no metadata).
    const audited = await asOwner((tx) =>
      tx.auditLog.findMany({ where: { entityId: row!.id, action: 'firm_application.submitted' } }),
    );
    expect(audited).toEqual([
      expect.objectContaining({
        businessId: null,
        actorUserId: null,
        entityType: 'firm_application',
        metadata: null,
      }),
    ]);
  });

  it('checks DUPLICATE_EIN by the keyed hash: WARN for the same EIN, PASS otherwise, SKIPPED without one', async () => {
    const ein = newEin();
    await submit(form('dup1', { ein })).expect(200);
    // The same EIN, written differently.
    await submit(form('dup2', { ein: ` ${ein.replace('-', ' ')} ` })).expect(200);
    await submit(form('other', { ein: newEin() })).expect(200);
    await submit(form('none')).expect(200);
    const check = async (n: string) => {
      const [row] = await stored(emailOf(n));
      return (await record(row!.id)).checks.find((c) => c.key === 'DUPLICATE_EIN');
    };
    expect(await check('dup2')).toEqual({
      key: 'DUPLICATE_EIN',
      result: 'WARN',
      note: `Same EIN as Sample Applicant ${tag} dup1 (pending review)`,
    });
    expect((await check('dup1'))?.result).toBe('WARN');
    expect(await check('other')).toMatchObject({ result: 'PASS' });
    expect(await check('none')).toMatchObject({ result: 'SKIPPED', note: 'No EIN given' });
  });

  it('answers a filled honeypot exactly like a real submit, but stores and sends nothing', async () => {
    const warn = spyOnWarn();
    try {
      const real = await submit(form('real'));
      const trap = await submit(
        form('trap', { ein: newEin(), honeypot: 'http://spam.example.test' }),
      );
      expect([trap.status, trap.body]).toEqual([real.status, real.body]);
      expect(await stored(emailOf('trap'))).toEqual([]);
      expect(sent.map((s) => s.message.to)).toEqual([emailOf('real')]);
      // One warning, without the form or the trap's value.
      expect(ours(warn)).toEqual(['Firm application submit dropped: the honeypot was filled']);
    } finally {
      warn.mockRestore();
    }
  });

  it('limits submits per IP and per email with the same 429', async () => {
    const limits = { ...SUBMIT_LIMITS };
    SUBMIT_LIMITS.perIpPerHour = 2;
    SUBMIT_LIMITS.perEmailPerDay = 2;
    try {
      const ip = newIp();
      const fromIp = [];
      for (const n of ['ip1', 'ip2', 'ip3']) fromIp.push((await submit(form(n), ip)).status);
      expect(fromIp).toEqual([200, 200, 429]);
      // A filled honeypot counts like any submit, so the trap can't be told apart.
      const trapIp = newIp();
      await submit(form('trap1', { honeypot: 'x' }), trapIp).expect(200);
      await submit(form('trap2', { honeypot: 'x' }), trapIp).expect(200);
      await submit(form('trap3', { honeypot: 'x' }), trapIp).expect(429);

      const email = emailOf('limited');
      const forEmail = [];
      for (let i = 0; i < 3; i++) forEmail.push(await submit(form(`e${i}`, { email })));
      expect(forEmail.map((r) => r.status)).toEqual([200, 200, 429]);
      expect(forEmail[2]!.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      expect(await stored(email)).toHaveLength(2);
      expect(await stored(emailOf('ip3'))).toEqual([]);
    } finally {
      Object.assign(SUBMIT_LIMITS, limits);
    }
  });

  it('sends at most one "received" email per address in 24 hours, and still stores each application', async () => {
    const email = emailOf('twice');
    await submit(form('twice-a', { email })).expect(200);
    await submit(form('twice-b', { email })).expect(200);
    expect(await stored(email)).toHaveLength(2);
    expect(sent.map((s) => s.message.to)).toEqual([email]);
  });

  it('still answers success when the email cannot be sent; the warning holds the id only', async () => {
    sendFails = true;
    const warn = spyOnWarn();
    try {
      await submit(form('unsent')).expect(200, { received: true });
      const [row] = await stored(emailOf('unsent'));
      expect(row).toBeDefined();
      expect(ours(warn)).toEqual([
        `Firm application ${row!.id}: the firm-application.received email could not be sent`,
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['a 121-character administrator name', { fullName: 'C'.repeat(121) }],
    ['a control character in the administrator name', { fullName: 'Casey\u0007Example' }],
    ['a short EIN', { ein: '00-123' }],
  ])('answers 400 for %s and stores nothing', async (_, over) => {
    const res = await submit(form('bad', over)).expect(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await stored(emailOf('bad'))).toEqual([]);
  });

  it('answers 400 for an unknown field or an unticked agreement', async () => {
    await submit({ ...form('bad2'), businessId: randomUUID() }).expect(400);
    await submit({
      ...form('bad2'),
      agreement: { acceptedTerms: false, certifiedAccurate: true },
    }).expect(400);
    expect(await stored(emailOf('bad2'))).toEqual([]);
  });

  it('takes JSON only from the firm site itself, like every public POST', async () => {
    for (const from of ['https://attacker.example', new URL(env.ADMIN_BASE_URL).origin]) {
      const res = await submit(form('cross')).set('origin', from);
      expect([res.status, res.body]).toMatchObject([
        403,
        { error: { code: 'ORIGIN_NOT_ALLOWED' } },
      ]);
    }
    expect(await stored(emailOf('cross'))).toEqual([]);
  });
});

describe('POST /firm-applications without EIN_HASH_KEY', () => {
  let keyless: INestApplication;
  beforeAll(async () => {
    keyless = await makeApp(loadEinHashKey({}));
  });
  afterAll(async () => {
    await keyless.close();
  });

  it('fails closed: 503, a warning naming the setting, nothing stored or sent; the rest works', async () => {
    const warn = spyOnWarn();
    try {
      for (const over of [{ ein: newEin() }, {}, { honeypot: 'x' }]) {
        const res = await submit(form('keyless', over), newIp(), keyless).expect(503);
        expect(res.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
      }
      expect(ours(warn)).toEqual(
        Array(3).fill('Firm application submit refused: EIN_HASH_KEY is not set'),
      );
    } finally {
      warn.mockRestore();
    }
    expect(await stored(emailOf('keyless'))).toEqual([]);
    expect(sent).toEqual([]);
    await request(keyless.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
