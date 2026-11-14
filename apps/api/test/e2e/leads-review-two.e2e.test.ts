// End-to-end: R55, Octavia's Leads Review Two (Nov 8), PR L1. R2 7: a lead's save answers with what
// it saved and is audited in the same transaction (one bulk change too), so an error always means
// nothing changed. R2 8: the Contact Information card's fields round-trip (date of birth is refused
// until leads keep one). R2 11: the required fields say what is missing, in her words. R2 5: a
// follow-up keeps the exact time it was given. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadDocument, LeadDocumentsAndForms, LeadProfile, LeadTask } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type FileFacts,
} from '../../src/storage/document-storage.js';
import { MemoryUploads } from '../memory-uploads.js';
import { pdf } from '../office-files.js';

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT (as begin-online.e2e's). */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new MemoryUploads(this.objects);
  presignUpload(file: FileFacts) {
    return this.uploads.presign(file);
  }
  completeUpload(key: string, uploadId: string, sizeBytes: number) {
    return this.uploads.complete(key, uploadId, sizeBytes);
  }
  abortUpload(key: string, uploadId: string) {
    return this.uploads.abort(key, uploadId);
  }
  /** As S3 with checksums: the stored bytes' SHA-256, which a download compares. */
  head(key: string) {
    const b = this.objects.get(key);
    const sha256 = b ? createHash('sha256').update(b).digest('hex') : null;
    return Promise.resolve(b ? { sizeBytes: b.length, sha256, contentEncoding: null } : null);
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: { url: string }, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length).split('?')[0]!, bytes);
  }
}
const storage = new MemoryStorage();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55r2-${key}-${run}@r55.test` });
const people = { ownerA: person('owner-a'), ownerB: person('owner-b'), staffA: person('staff-a') };
const ids = { firmA: '', firmB: '', tax: '' };
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
async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
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
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const profile = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return LeadProfile.parse(res.body);
};
let n = 0;
const newLead = async (extra: object = {}) => {
  n += 1;
  return profile(
    await call('post', '', people.ownerA, {
      firstName: 'Pat',
      lastName: `Rtwo${n}x${run}`,
      email: `pat-r${n}-${run}@example.test`,
      source: 'REFERRAL',
      serviceIds: [ids.tax],
      ...extra,
    }),
    201,
  );
};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55r2-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55r2-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: people.staffA.id, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.tax = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'unused', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Leads Review Two, L1', () => {
  it('R2 7: a status change answers with the new status, as the lead reads, audited with it', async () => {
    const lead = await newLead({ stage: 'IN_REVIEW' });
    const saved = profile(
      await call('patch', `/${lead.id}`, people.ownerA, { stage: 'IN_FOLLOW_UP' }),
    );
    expect(saved.stage).toBe('IN_FOLLOW_UP');
    expect(profile(await call('get', `/${lead.id}/profile`, people.ownerA)).stage).toBe(
      'IN_FOLLOW_UP',
    );
    const audit = await asOwnerA((tx) =>
      tx.auditLog.findMany({ where: { action: 'lead.updated', entityId: lead.id } }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([{ fields: ['stage'] }]);
    // The bulk bar's change too: its audit rows commit with it.
    const res = await call('post', '/bulk', people.ownerA, {
      action: 'STAGE',
      ids: [lead.id],
      stage: 'CONTACTED',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      await asOwnerA((tx) =>
        tx.auditLog.count({ where: { action: 'lead.bulk_stage', entityId: lead.id } }),
      ),
    ).toBe(1);
  });

  it('R2 8: address, preferred contact, best time and date of birth are saved from the card', async () => {
    const lead = await newLead();
    const saved = profile(
      await call('patch', `/${lead.id}`, people.ownerA, {
        address: '12 Fake Street, Faketown, TX 75001',
        preferredContact: ['SMS', 'EMAIL'],
        bestTimeToContact: 'Weekday mornings',
      }),
    );
    expect(saved).toMatchObject({
      address: '12 Fake Street, Faketown, TX 75001',
      bestTimeToContact: 'Weekday mornings',
    });
    expect([...saved.preferredContact].sort()).toEqual(['EMAIL', 'SMS']);
    const born = profile(
      await call('patch', `/${lead.id}`, people.ownerA, { dateOfBirth: '1990-04-02' }),
    );
    expect(born.dateOfBirth).toBe('1990-04-02');
    expect(profile(await call('get', `/${lead.id}/profile`, people.ownerA)).dateOfBirth).toBe(
      '1990-04-02',
    );
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expectError(
      await call('patch', `/${lead.id}`, people.ownerA, { dateOfBirth: tomorrow }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/${lead.id}`, people.ownerA, { dateOfBirth: '1899-12-31' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      profile(await call('patch', `/${lead.id}`, people.ownerA, { dateOfBirth: null })).dateOfBirth,
    ).toBe(null);
    // Cleared again: an empty address is none.
    expect(
      profile(await call('patch', `/${lead.id}`, people.ownerA, { address: '' })).address,
    ).toBe(null);
  });

  it('R2 11: blank and malformed required fields say what is missing, in her words', async () => {
    const blank = await call('post', '', people.ownerA, {
      firstName: '',
      lastName: ' ',
      email: '',
      source: 'REFERRAL',
      serviceIds: [ids.tax],
    });
    expectError(blank, 400, 'VALIDATION_FAILED');
    const details = (blank.body as { error: { details: { path: string; message: string }[] } })
      .error.details;
    expect(details).toEqual(
      expect.arrayContaining([
        { path: 'firstName', message: 'First name is required' },
        { path: 'lastName', message: 'Last name is required' },
        { path: 'email', message: 'Email is required' },
      ]),
    );
    const malformed = await call('post', '', people.ownerA, {
      firstName: 'Pat',
      lastName: 'Fake',
      email: 'not-an-email',
      source: 'REFERRAL',
      serviceIds: [ids.tax],
    });
    expect(
      (malformed.body as { error: { details: { path: string; message: string }[] } }).error.details,
    ).toEqual([{ path: 'email', message: 'Enter a valid email address' }]);
  });

  it('R2 5: a follow-up keeps the exact time it was saved with, through repeated saves', async () => {
    const lead = await newLead();
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCHours(14, 15, 0, 0);
    const first = profile(
      await call('put', `/${lead.id}/follow-up`, people.ownerA, {
        type: 'CALL',
        dueAt: at.toISOString(),
        notes: null,
      }),
    );
    expect(first.nextAction?.dueAt).toBe(at.toISOString());
    // The same values again (the editor's unchanged save): nothing moves.
    const again = profile(
      await call('put', `/${lead.id}/follow-up`, people.ownerA, {
        type: 'CALL',
        dueAt: first.nextAction?.dueAt,
        notes: null,
      }),
    );
    expect(again.nextAction?.dueAt).toBe(at.toISOString());
    expect(again.followUps).toHaveLength(1);
  });

  it('R2 9: other phones and emails are added, kept in order, replaced and refused twice', async () => {
    const lead = await newLead({
      otherContacts: [
        { kind: 'EMAIL', value: ' Pat.Work@Example.TEST ', label: 'Work' },
        { kind: 'PHONE', value: '(404) 555-0101', label: '' },
      ],
    });
    expect(lead.otherContacts).toEqual([
      { kind: 'EMAIL', value: 'pat.work@example.test', label: 'Work' },
      { kind: 'PHONE', value: '(404) 555-0101', label: null },
    ]);
    const replaced = profile(
      await call('patch', `/${lead.id}`, people.ownerA, {
        otherContacts: [{ kind: 'PHONE', value: '(404) 555-0102', label: 'Mobile' }],
      }),
    );
    expect(replaced.otherContacts).toEqual([
      { kind: 'PHONE', value: '(404) 555-0102', label: 'Mobile' },
    ]);
    // The same email twice, in another letter case: refused, nothing changes.
    const twice = await call('patch', `/${lead.id}`, people.ownerA, {
      otherContacts: [
        { kind: 'EMAIL', value: 'a@example.test', label: null },
        { kind: 'EMAIL', value: 'A@Example.test', label: null },
      ],
    });
    expectError(twice, 400, 'VALIDATION_FAILED');
    expect(profile(await call('get', `/${lead.id}/profile`, people.ownerA)).otherContacts).toEqual(
      replaced.otherContacts,
    );
    const audit = await asOwnerA((tx) =>
      tx.auditLog.findMany({ where: { action: 'lead.updated', entityId: lead.id } }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([{ fields: ['otherContacts'] }]);
    // Emptied.
    expect(
      profile(await call('patch', `/${lead.id}`, people.ownerA, { otherContacts: [] }))
        .otherContacts,
    ).toEqual([]);
  });

  it("firm B never reaches firm A's lead", async () => {
    const lead = await newLead();
    expectError(
      await call('patch', `/${lead.id}`, people.ownerB, { stage: 'CONTACTED' }, ids.firmB),
      404,
      'NOT_FOUND',
    );
    // Nor its other phones and emails (R2 9): neither read nor replaced.
    const own = await newLead({
      otherContacts: [{ kind: 'PHONE', value: '(404) 555-0103', label: null }],
    });
    expectError(
      await call(
        'patch',
        `/${own.id}`,
        people.ownerB,
        { otherContacts: [{ kind: 'PHONE', value: '(404) 555-0999', label: null }] },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/${own.id}/profile`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expect(
      await asOwnerA((tx) => tx.leadContactPoint.findMany({ where: { leadId: own.id } })),
    ).toMatchObject([{ value: '(404) 555-0103' }]);
  });
});

describe('Leads Review Two, L3b', () => {
  it("R2 2: Add Task makes the lead's own task, shown on the lead and not in the Tasks lists", async () => {
    const lead = await newLead();
    expectError(
      await call('post', `/${lead.id}/tasks`, people.ownerA, { title: 'Call back' }),
      400,
      'VALIDATION_FAILED',
    );
    const res = await call('post', `/${lead.id}/tasks`, people.ownerA, {
      title: 'Call back about the return',
      dueOn: '2030-03-04',
      priority: 'HIGH',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = LeadTask.parse(res.body);
    expect(task).toMatchObject({
      title: 'Call back about the return',
      dueOn: '2030-03-04',
      priority: 'HIGH',
      done: false,
      assignedTo: { userId: people.ownerA.id },
    });
    const listed = (await call('get', `/${lead.id}/tasks`, people.ownerA)).body as {
      items: LeadTask[];
    };
    expect(listed.items.map((t) => t.id)).toEqual([task.id]);
    expect(
      profile(await call('get', `/${lead.id}/profile`, people.ownerA)).openTasks.map((t) => t.id),
    ).toEqual([task.id]);
    // The Tasks module's lists are clients' work: a lead's task is not in them.
    const tasks = await request(app.getHttpServer())
      .get('/api/v1/business/tasks')
      .set('x-business-id', ids.firmA)
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    expect(tasks.status, JSON.stringify(tasks.body)).toBe(200);
    expect(JSON.stringify(tasks.body)).not.toContain(task.id);

    const done = LeadTask.parse(
      (await call('patch', `/${lead.id}/tasks/${task.id}`, people.ownerA, { done: true })).body,
    );
    expect(done.done).toBe(true);
    expect(profile(await call('get', `/${lead.id}/profile`, people.ownerA)).openTasks).toEqual([]);
    const actions = (
      await asOwnerA((tx) =>
        tx.auditLog.findMany({ where: { entityId: lead.id }, select: { action: true } }),
      )
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['lead.task_created', 'lead.task_completed']));
    // Firm B reaches neither the lead nor its task.
    expectError(
      await call(
        'post',
        `/${lead.id}/tasks`,
        people.ownerB,
        { title: 'X', dueOn: '2030-01-01' },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'patch',
        `/${lead.id}/tasks/${task.id}`,
        people.ownerB,
        { done: false },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
  });

  it('R2 4: a file staff add stays with the lead and arrives internal at conversion, with its task', async () => {
    const lead = await newLead({ stage: 'CONTACTED' });
    const bytes = pdf('lead-file');
    const facts = {
      fileName: 'engagement-letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const ticket = await call('post', `/${lead.id}/files`, people.ownerA, facts);
    expect(ticket.status, JSON.stringify(ticket.body)).toBe(200);
    const { uploadToken, url } = ticket.body as { uploadToken: string; url: string };
    storage.put({ url }, bytes);
    // Another firm can't confirm it, nor reach the lead.
    expectError(
      await call('post', `/${lead.id}/files/confirm`, people.ownerB, { uploadToken }, ids.firmB),
      404,
      'NOT_FOUND',
    );
    const confirmed = await call('post', `/${lead.id}/files/confirm`, people.ownerA, {
      uploadToken,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const file = LeadDocument.parse(confirmed.body);
    expect(file).toMatchObject({
      fileName: 'engagement-letter.pdf',
      scanStatus: 'CLEAN',
      addedBy: { userId: people.ownerA.id },
    });
    // The same ticket twice is refused.
    expectError(
      await call('post', `/${lead.id}/files/confirm`, people.ownerA, { uploadToken }),
      410,
      'UPLOAD_EXPIRED',
    );
    const tab = LeadDocumentsAndForms.parse(
      (await call('get', `/${lead.id}/documents-and-forms`, people.ownerA)).body,
    );
    expect(tab.documents.map((d) => d.id)).toEqual([file.id]);
    expect(
      (await call('get', `/${lead.id}/uploads/${file.id}/download`, people.ownerA)).status,
    ).toBe(200);
    const task = LeadTask.parse(
      (
        await call('post', `/${lead.id}/tasks`, people.ownerA, {
          title: 'Prepare',
          dueOn: '2030-05-01',
        })
      ).body,
    );

    const converted = await call('post', `/${lead.id}/convert-to-client`, people.ownerA, {
      idempotencyKey: randomUUID(),
      accountType: 'INDIVIDUAL',
      fullName: 'Pat Convert',
      email: lead.email,
      phone: '+15550100999',
      serviceIds: [ids.tax],
      primaryStaffUserId: people.ownerA.id,
    });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const result = converted.body as {
      clientId: string;
      carried: { documents: number; tasks: number };
    };
    expect(result.carried).toMatchObject({ documents: 1, tasks: 1 });
    const after = await asOwnerA(async (tx) => ({
      doc: await tx.document.findFirstOrThrow({ where: { leadUploadId: file.id } }),
      task: await tx.task.findUniqueOrThrow({ where: { id: task.id } }),
    }));
    expect(after.doc).toMatchObject({
      clientId: result.clientId,
      direction: 'INTERNAL',
      intakeId: null,
    });
    expect(after.task).toMatchObject({ clientId: result.clientId, leadId: null });
    // A converted lead takes no more files.
    expectError(await call('post', `/${lead.id}/files`, people.ownerA, facts), 409, 'LEAD_CLOSED');
  });

  it("removes a file staff added; firm B can't", async () => {
    const lead = await newLead({ stage: 'CONTACTED' });
    const bytes = pdf('remove-me');
    const ticket = (
      await call('post', `/${lead.id}/files`, people.ownerA, {
        fileName: 'remove-me.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    ).body as { uploadToken: string; url: string };
    storage.put(ticket, bytes);
    const file = LeadDocument.parse(
      (
        await call('post', `/${lead.id}/files/confirm`, people.ownerA, {
          uploadToken: ticket.uploadToken,
        })
      ).body,
    );
    expectError(
      await call('delete', `/${lead.id}/files/${file.id}`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expect((await call('delete', `/${lead.id}/files/${file.id}`, people.ownerA)).status).toBe(200);
    expect(
      LeadDocumentsAndForms.parse(
        (await call('get', `/${lead.id}/documents-and-forms`, people.ownerA)).body,
      ).documents,
    ).toEqual([]);
  });
});

describe('Leads Review Two, R2 15', () => {
  const pairOf = (res: Response, a: string, b: string) =>
    (res.body as { items: { leads: { id: string }[]; reasons: string[] }[] }).items.find(
      (p) => [p.leads[0]!.id, p.leads[1]!.id].sort().join() === [a, b].sort().join(),
    );

  it('lists leads with the same email or phone, never merged; Not a duplicate takes the pair off', async () => {
    const email = `twin-${run}@example.test`;
    const one = await newLead({ email, phone: '(404) 555-0177' });
    const two = await newLead({
      email: email.toUpperCase(),
      phone: '+1 404 555 0177',
      allowDuplicate: true,
    });
    const list = await call('get', '/duplicates', people.ownerA);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(pairOf(list, one.id, two.id)?.reasons).toEqual(['EMAIL', 'PHONE']);
    // Another firm sees none of them.
    const other = await call('get', '/duplicates', people.ownerB, undefined, ids.firmB);
    expect(pairOf(other, one.id, two.id)).toBeUndefined();
    // Staff can't dismiss; the firm B owner can't name firm A's leads.
    expectError(
      await call('post', '/duplicates/dismiss', people.staffA, {
        leadId: one.id,
        otherLeadId: two.id,
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call(
        'post',
        '/duplicates/dismiss',
        people.ownerB,
        { leadId: one.id, otherLeadId: two.id },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    for (let i = 0; i < 2; i++) {
      const res = await call('post', '/duplicates/dismiss', people.ownerA, {
        leadId: two.id,
        otherLeadId: one.id,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(pairOf(await call('get', '/duplicates', people.ownerA), one.id, two.id)).toBeUndefined();
    // Both leads are as they were.
    expect(profile(await call('get', `/${two.id}/profile`, people.ownerA)).archivedAt).toBeNull();
  });

  it('merges on purpose: chosen values, both sets of contacts, tags and services; the other is kept, archived and linked', async () => {
    const kept = await newLead({ email: `keep-${run}@example.test`, phone: '(404) 555-0181' });
    const merged = await newLead({
      firstName: 'Patricia',
      email: `merge-${run}@example.test`,
      phone: '(404) 555-0182',
      otherContacts: [{ kind: 'EMAIL', value: `work-${run}@example.test`, label: 'Work' }],
    });
    profile(await call('patch', `/${kept.id}`, people.ownerA, { tags: [`Keep ${run}`] }));
    const tagged = profile(
      await call('patch', `/${merged.id}`, people.ownerA, { tags: [`Merge ${run}`] }),
    );
    const body = (extra: object = {}) => ({
      mergeLeadId: merged.id,
      take: { name: 'MERGED', email: 'MERGED' },
      ...extra,
    });
    expectError(await call('post', `/${kept.id}/merge`, people.staffA, body()), 403, 'FORBIDDEN');
    expectError(
      await call('post', `/${kept.id}/merge`, people.ownerB, body(), ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/${kept.id}/merge`, people.ownerA, { mergeLeadId: kept.id }),
      409,
      'MERGE_NOT_ALLOWED',
    );
    expectError(
      await call(
        'post',
        `/${kept.id}/merge`,
        people.ownerA,
        body({ versions: { kept: 'old', merged: tagged.version } }),
      ),
      409,
      'SAVE_CONFLICT',
    );
    const res = await call('post', `/${kept.id}/merge`, people.ownerA, body());
    const after = profile(res);
    expect(after).toMatchObject({
      firstName: 'Patricia',
      email: `merge-${run}@example.test`,
      phone: '(404) 555-0181',
    });
    expect(after.otherContacts.map((c) => c.value).sort()).toEqual(
      [`keep-${run}@example.test`, `work-${run}@example.test`, '(404) 555-0182'].sort(),
    );
    expect([...after.tags].sort()).toEqual([`Keep ${run}`, `Merge ${run}`].sort());
    expect(after.mergedFrom).toEqual([
      { id: merged.id, name: expect.any(String), number: merged.number },
    ]);
    expect(after.recentActivity.map((a) => a.label)).toContain(`Merged from ${merged.number}`);

    // The merged lead opens, read only, linked to the kept one; it can't be changed or merged again.
    const old = profile(await call('get', `/${merged.id}/profile`, people.ownerA));
    expect(old.archivedAt).not.toBeNull();
    expect(old.mergedInto).toEqual({ id: kept.id, name: expect.any(String), number: kept.number });
    expectError(
      await call('patch', `/${merged.id}`, people.ownerA, { priority: 'HOT' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/${kept.id}/merge`, people.ownerA, body()),
      409,
      'MERGE_NOT_ALLOWED',
    );
    const audit = await asOwnerA((tx) =>
      tx.auditLog.findMany({ where: { action: 'lead.merged', entityId: kept.id } }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([
      { mergedLeadId: merged.id, taken: ['name', 'email'] },
    ]);
  });
});

/** Firm A's rows, read as the owner (the audit's own check). */
async function asOwnerA<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
}
