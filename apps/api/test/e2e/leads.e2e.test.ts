// End-to-end: R11 step 4, the firm's Begin Online leads (contract in packages/types/src/leads).
// The firm lists and reviews the leads visitors sent (never a draft), with SSNs as last 4 only;
// converting makes the client and an ACTIVE engagement, carries the intake and its files over and
// invites the visitor to the portal; declining keeps the reason in the firm. Firm B sees nothing.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  ANNUAL_TAX_FORM,
  LeadDetail as DetailShape,
  LeadListItem as ItemShape,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

// Strict copies: a leaked column fails the parse.
const Item = z.strictObject({
  ...ItemShape.shape,
  service: z.strictObject(ItemShape.shape.service.shape),
});
const Detail = z.strictObject({
  ...DetailShape.shape,
  service: z.strictObject(DetailShape.shape.service.shape),
});
const List = z.strictObject({ items: z.array(Item), nextCursor: z.string().nullable() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r11l-${key}-${run}@r11.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r11l-a-${run}`,
  service: '',
  serviceB: '',
  staffClient: '',
  otherClient: '',
  leads: {} as Record<string, string>,
  uploads: {} as Record<string, string>,
};

const bytes = Buffer.from('synthetic pdf bytes');
const sha = createHash('sha256').update(bytes).digest('hex');

/** S3 in memory: every lead upload's key holds the same synthetic bytes. */
class MemoryStorage implements DocumentStorage {
  presignUpload() {
    return Promise.resolve({ url: 'memory:', headers: {} });
  }
  head(key: string) {
    return Promise.resolve(
      key.includes('missing')
        ? null
        : { sizeBytes: bytes.length, sha256: sha, contentEncoding: null },
    );
  }
  read() {
    return Promise.resolve(bytes);
  }
  remove() {
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
}

let app: INestApplication;
const outbox: NotifyMessage[] = [];
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
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/leads${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};

async function inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, fn);
  } finally {
    await owner.$disconnect();
  }
}

/** A lead as Begin Online leaves it: a draft with its intake, answers and files, then `status`. */
async function seedLead(
  tx: TxClient,
  key: string,
  status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'DECLINED',
  formId: string,
  businessId = ids.firmA,
  serviceId = ids.service,
) {
  const B = { businessId };
  const lead = await tx.lead.create({
    data: {
      ...B,
      serviceId,
      firstName: `Lead${key}`,
      lastName: 'Sample',
      email: `lead-${key}-${run}@example.test`,
      phone: '+15550100100',
      taxYear: 2025,
    },
  });
  const intake = await tx.intake.create({
    data: { ...B, formId, leadId: lead.id, status: 'IN_PROGRESS' },
  });
  await tx.intakeSubmission.create({
    data: {
      ...B,
      intakeId: intake.id,
      version: 1,
      answers: {
        firstName: `Lead${key}`,
        ssn: { last4: '6789', sealed: 'c3ludGhldGlj' },
      },
    },
  });
  for (const [slot, scan] of [
    ['clean', 'CLEAN'],
    ['pending', 'PENDING'],
  ] as const) {
    const upload = await tx.leadUpload.create({
      data: {
        ...B,
        leadId: lead.id,
        slot: `${slot}Slot`,
        fileName: `${slot}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: sha,
        s3Key: `tenant/${businessId}/begin-online/${randomUUID()}`,
      },
    });
    if (scan === 'CLEAN') {
      await tx.leadUpload.update({
        where: { id: upload.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
    }
    ids.uploads[`${key}.${slot}`] = upload.id;
  }
  if (status !== 'DRAFT') {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status,
        submittedAt: new Date(),
        ...(status === 'DECLINED' ? { declineReason: 'Seeded' } : {}),
      },
    });
  }
  ids.leads[key] = lead.id;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r11l-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  const form = async (tx: TxClient, businessId: string, serviceId: string) =>
    (
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId,
          version: 1,
          title: ANNUAL_TAX_FORM.title,
          definition: ANNUAL_TAX_FORM,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      })
    ).id;
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.service = (
      await tx.service.create({
        data: { ...A, kind: 'ANNUAL_TAX', name: `Annual Tax ${run}`, beginOnline: true },
      })
    ).id;
    const formId = await form(tx, ids.firmA, ids.service);
    ids.staffClient = (
      await tx.client.create({
        data: { ...A, displayName: 'Staff own', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.otherClient = (
      await tx.client.create({
        data: { ...A, displayName: 'Taken', email: `lead-taken-${run}@example.test` },
      })
    ).id;
    await seedLead(tx, 'new', 'SUBMITTED', formId);
    await seedLead(tx, 'review', 'IN_REVIEW', formId);
    await seedLead(tx, 'declined', 'DECLINED', formId);
    await seedLead(tx, 'draft', 'DRAFT', formId);
    await seedLead(tx, 'taken', 'SUBMITTED', formId);
    await seedLead(tx, 'staff', 'SUBMITTED', formId);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: `Tax B ${run}` },
      })
    ).id;
    const formId = await form(tx, ids.firmB, ids.serviceB);
    await seedLead(tx, 'b', 'SUBMITTED', formId, ids.firmB, ids.serviceB);
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(new MemoryStorage())
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('inbox', () => {
  it('lists the leads visitors sent, never a draft; filters by status and search; counts', async () => {
    const all = List.parse(expectOk(await firm('get', '', people.ownerA)).body).items;
    const mine = all.map((l) => l.id);
    expect(mine).toContain(ids.leads['new']);
    expect(mine).toContain(ids.leads['declined']);
    expect(mine).not.toContain(ids.leads['draft']);
    expect(mine).not.toContain(ids.leads['b']);

    const declined = List.parse(
      expectOk(await firm('get', '?status=DECLINED', people.ownerA)).body,
    ).items;
    expect(declined.map((l) => l.id)).toEqual([ids.leads['declined']]);
    expect(codeOf(await firm('get', '?status=DRAFT', people.ownerA))).toBe('VALIDATION_FAILED');

    const found = List.parse(expectOk(await firm('get', '?search=leadreview', people.ownerA)).body);
    expect(found.items.map((l) => l.id)).toEqual([ids.leads['review']]);

    const page = List.parse(expectOk(await firm('get', '?limit=2', people.staffA)).body);
    expect(page.items).toHaveLength(2);
    const next = List.parse(
      expectOk(await firm('get', `?limit=2&cursor=${page.nextCursor}`, people.staffA)).body,
    );
    expect(next.items.map((l) => l.id)).not.toContain(page.items[0]!.id);

    const counts = expectOk(await firm('get', '/count', people.ownerA)).body as object;
    expect(counts).toEqual({ submitted: 3, inReview: 1 });
  });

  it("another firm sees none of them, and a draft's detail is 404", async () => {
    const b = List.parse(expectOk(await firm('get', '', people.ownerB, undefined, ids.firmB)).body);
    expect(b.items.map((l) => l.id)).toEqual([ids.leads['b']]);
    const res = await firm('get', `/${ids.leads['new']}`, people.ownerB, undefined, ids.firmB);
    expect(res.status).toBe(404);
    expect((await firm('get', `/${ids.leads['draft']}`, people.ownerA)).status).toBe(404);
    expect(codeOf(await firm('get', '/not-a-uuid', people.ownerA))).toBe('VALIDATION_FAILED');
  });
});

describe('review', () => {
  it('shows the answers with the SSN as last 4 only, and the files', async () => {
    const res = expectOk(await firm('get', `/${ids.leads['new']}`, people.staffA));
    expect(JSON.stringify(res.body)).not.toContain('sealed');
    const lead = Detail.parse(res.body);
    expect(lead.intake?.answers['ssn']).toEqual({ last4: '6789' });
    expect(lead.intake?.formVersion).toBe(1);
    expect(lead.intake?.uploads.map((u) => u.slot).sort()).toEqual(['cleanSlot', 'pendingSlot']);
    expect(lead).toMatchObject({ status: 'SUBMITTED', taxYear: 2025, client: null });
  });

  it('starts a review once, naming who took it', async () => {
    const lead = Detail.parse(
      expectOk(await firm('post', `/${ids.leads['new']}/review`, people.staffA, {})).body,
    );
    expect(lead.status).toBe('IN_REVIEW');
    expect(lead.reviewedBy?.userId).toBe(people.staffA.id);
    expect(codeOf(await firm('post', `/${ids.leads['new']}/review`, people.ownerA, {}))).toBe(
      'INVALID_STATUS',
    );
  });
});

describe('decline', () => {
  it('needs a reason, keeps it out of the audit log, and is final', async () => {
    const lead = ids.leads['review'];
    expect(codeOf(await firm('post', `/${lead}/decline`, people.ownerA, { reason: ' ' }))).toBe(
      'VALIDATION_FAILED',
    );
    const reason = `Not a fit ${run}`;
    const declined = Detail.parse(
      expectOk(await firm('post', `/${lead}/decline`, people.ownerA, { reason })).body,
    );
    expect(declined).toMatchObject({ status: 'DECLINED', declineReason: reason });
    expect(codeOf(await firm('post', `/${lead}/decline`, people.ownerA, { reason: 'Again' }))).toBe(
      'INVALID_STATUS',
    );
    const audit = await inFirm(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: lead } }),
    );
    expect(audit.map((a) => a.action)).toContain('lead.declined');
    expect(JSON.stringify(audit)).not.toContain(reason);
  });
});
