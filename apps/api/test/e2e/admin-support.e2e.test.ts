// End-to-end: R60, Super Admin Support on R0's B2 tables. Every route under /api/v1/admin/support:
// the team and the pickers, Support Settings, the New Ticket form with files, the list, tabs and
// summary, Ticket Detail, every ticket action, files and their scan, and the SLA rules. Super
// Admins only (a firm's Owner is 403); the conversation, notes and history are insert-only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  SupportDirectory,
  SupportMe,
  SupportSettings,
  SupportSummary,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketPage,
  type UploadTicket,
} from '@firmivra/types';
import { SupportFilesService } from '../../src/admin-support/support-files.service.js';
import { SupportTicketsService } from '../../src/admin-support/support-tickets.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  head(key: string, { checksum = false } = {}) {
    const b = this.objects.get(key);
    return Promise.resolve(
      b
        ? { sizeBytes: b.length, sha256: checksum ? sha256(b) : null, contentEncoding: null }
        : null,
    );
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
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'guardduty',
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const lead = { id: randomUUID(), email: `r60-lead-${run}@firmivra.test` };
const BASE = '/api/v1/admin/support';

let app: INestApplication;
let tickets: SupportTicketsService;
let files: SupportFilesService;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.66.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, work);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
async function call(
  method: Method,
  path: string,
  body?: object,
  email = fx.users.admin.email,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;

let settings: SupportSettings;
const priority = (name: string) => settings.priorities.find((p) => p.name === name)!;
const category = (name: string) => settings.categories.find((c) => c.name === name)!;

async function upload(
  bytes = PDF,
  fileName = 'w2-form.pdf',
  contentType = 'application/pdf',
  firmId = fx.firmA.id,
) {
  const res = await call('post', '/uploads', {
    firmId,
    fileName,
    contentType,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const ticket = res.body as UploadTicket;
  storage.put(ticket, bytes);
  return ticket.uploadToken;
}

async function newTicket(over: Record<string, unknown> = {}): Promise<SupportTicket> {
  const res = await call('post', '/tickets', {
    requestId: randomUUID(),
    firmId: fx.firmA.id,
    contactId: fx.users.ownerA.id,
    subject: `Fake upload stops ${run}`,
    categoryId: category('Document Filing').id,
    priorityId: priority('High').id,
    assignTo: 'QUEUE',
    status: 'OPEN',
    source: 'EMAIL',
    description: 'The upload stops at 90%.',
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return SupportTicket.parse(res.body);
}
const detail = async (id: string) =>
  SupportTicketDetail.parse((await call('get', `/tickets/${id}`)).body);

beforeAll(async () => {
  await asOwner(async (tx) => {
    const department = await tx.platformDepartment.upsert({
      where: { code: 'CUSTOMER_SUCCESS_SUPPORT' },
      create: { code: 'CUSTOMER_SUCCESS_SUPPORT', name: 'Customer Success / Support' },
      update: {},
    });
    const executive = await tx.platformDepartment.upsert({
      where: { code: 'EXECUTIVE' },
      create: { code: 'EXECUTIVE', name: 'Executive' },
      update: {},
    });
    const role = (
      code: string,
      title: string,
      level: 'CEO' | 'MANAGER' | 'INDIVIDUAL_CONTRIBUTOR',
      departmentId: string,
    ) =>
      tx.platformRoleDefinition.upsert({
        where: { code },
        create: {
          code,
          title,
          level,
          departmentId,
          defaultScopeType: level === 'CEO' ? 'COMPANY' : 'TEAM',
        },
        update: {},
      });
    await role('EXECUTIVE_CEO', 'CEO', 'CEO', executive.id);
    const manager = await role(
      'CUSTOMER_SUCCESS_SUPPORT_CUSTOMER_SUPPORT_MANAGER',
      'Customer Support Manager',
      'MANAGER',
      department.id,
    );
    await role(
      'CUSTOMER_SUCCESS_SUPPORT_CUSTOMER_SUPPORT_REPRESENTATIVE',
      'Customer Support Representative',
      'INDIVIDUAL_CONTRIBUTOR',
      department.id,
    );
    await tx.user.create({
      data: {
        id: lead.id,
        cognitoSub: lead.id,
        pool: 'ADMIN',
        email: lead.email,
        name: 'Fake Support Lead',
      },
    });
    await tx.platformAdmin.create({ data: { userId: lead.id, role: 'TEAM_MEMBER' } });
    await tx.platformMember.create({
      data: {
        userId: lead.id,
        roleDefinitionId: manager.id,
        departmentId: department.id,
        scopeType: 'TEAM',
        status: 'ACTIVE',
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  tickets = nest.get(SupportTicketsService);
  files = nest.get(SupportFilesService);
  settings = SupportSettings.parse((await call('get', '/settings')).body);
});

afterAll(async () => {
  await app.close();
});

describe('the team and the pickers', () => {
  it('GET /me: a Super Admin is the Owner with every permission; a firm Owner is refused', async () => {
    const me = SupportMe.parse((await call('get', '/me')).body);
    expect(me.agent).toMatchObject({ id: fx.users.admin.id, role: 'OWNER', active: true });
    expect(me.permissions).toContain('EDIT_SETTINGS');
    expect(me.permissions).toContain('DELETE');
    expect((await call('get', '/me', undefined, fx.users.ownerA.email)).status).toBe(401);
  });

  it('GET /directory: every firm with its active owners, and the team with its roles', async () => {
    const dir = SupportDirectory.parse((await call('get', '/directory')).body);
    const a = dir.firms.find((f) => f.id === fx.firmA.id)!;
    expect(a.contacts).toEqual([
      expect.objectContaining({
        id: fx.users.ownerA.id,
        email: fx.users.ownerA.email,
        primary: true,
      }),
    ]);
    // Staff and clients are never contacts admin scope may read.
    expect(a.contacts.some((c) => c.id === fx.users.staffA.id)).toBe(false);
    expect(dir.agents.find((x) => x.id === lead.id)).toMatchObject({ role: 'LEAD', active: true });
    expect(dir.agents.find((x) => x.id === fx.users.admin.id)).toMatchObject({ role: 'OWNER' });
  });
});

describe('Support Settings', () => {
  it('GET /settings: the migration defaults in the contract shape', () => {
    expect(settings.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Account Access', 'Document Filing', 'General Inquiry']),
    );
    expect(priority('Critical')).toMatchObject({
      color: 'red',
      target: { amount: 1, unit: 'HOURS' },
      rank: 1,
    });
    expect(priority('Medium')).toMatchObject({ target: { amount: 1, unit: 'BUSINESS_DAYS' } });
    expect(settings.businessHours.days).toHaveLength(7);
    expect(settings.escalation.highPriority.priorityId).toBe(priority('High').id);
    // Every event has a rule; the grid always lets the Owner edit settings. (The test database
    // keeps earlier runs' changes, so these are the shapes, not the shipped values.)
    expect(settings.notifications.rules).toHaveLength(11);
    expect(settings.permissions.OWNER).toContain('EDIT_SETTINGS');
  });

  it('POST, PATCH and PUT active on categories, names unique in any case', async () => {
    const created = await call('post', '/settings/categories', { name: `Fake Onboarding ${run}` });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(
      (await call('post', '/settings/categories', { name: `fake onboarding ${run}` })).status,
    ).toBe(409);
    const renamed = await call('patch', `/settings/categories/${id}`, {
      name: `Fake Setup ${run}`,
      description: 'New firms',
    });
    expect(renamed.body).toMatchObject({
      name: `Fake Setup ${run}`,
      description: 'New firms',
      active: true,
    });
    expect(
      (await call('put', `/settings/categories/${id}/active`, { active: false })).body,
    ).toMatchObject({ active: false });
    expect(
      (await call('patch', `/settings/categories/${randomUUID()}`, { name: 'x' })).status,
    ).toBe(404);
  });

  it('POST, PATCH and PUT active on priorities: targets in hours or business days, one stays active', async () => {
    const created = await call('post', '/settings/priorities', {
      name: `Fake Urgent ${run}`,
      color: 'purple',
      target: { amount: 2, unit: 'HOURS' },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      color: 'purple',
      target: { amount: 2, unit: 'HOURS' },
      active: true,
    });
    const changed = await call('patch', `/settings/priorities/${id}`, {
      name: `Fake Urgent ${run}`,
      color: 'green',
      target: { amount: 3, unit: 'BUSINESS_DAYS' },
    });
    expect(changed.body).toMatchObject({
      color: 'green',
      target: { amount: 3, unit: 'BUSINESS_DAYS' },
    });
    expect(
      (await call('put', `/settings/priorities/${id}/active`, { active: false })).body,
    ).toMatchObject({ active: false });
    expect(
      (
        await call('post', '/settings/priorities', {
          name: 'Critical',
          color: 'red',
          target: { amount: 1, unit: 'HOURS' },
        })
      ).status,
    ).toBe(409);
  });

  it('PUT /settings/business-hours: one opening for every open day; holidays added and removed', async () => {
    const days = settings.businessHours.days;
    const saved = await call('put', '/settings/business-hours', {
      timeZone: settings.businessHours.timeZone,
      days,
      clock: settings.businessHours.clock,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ days, timeZone: settings.businessHours.timeZone });
    const mixed = days.map((d) =>
      d.day === 5 ? { ...d, open: true, start: '09:00', end: '13:00' } : d,
    );
    const refused = await call('put', '/settings/business-hours', {
      timeZone: 'America/Chicago',
      days: mixed,
      clock: 'BUSINESS',
    });
    expect([refused.status, code(refused)]).toEqual([422, 'NOT_SUPPORTED_YET']);
    const holiday = await call('post', '/settings/holidays', {
      date: '2031-12-25',
      name: 'Fake Christmas Day',
    });
    expect(holiday.status).toBe(201);
    expect(
      (await call('post', '/settings/holidays', { date: '2031-12-25', name: 'Again' })).status,
    ).toBe(409);
    const id = (holiday.body as { id: string }).id;
    expect((await call('delete', `/settings/holidays/${id}`)).body).toEqual({ ok: true });
    expect((await call('delete', `/settings/holidays/${id}`)).status).toBe(404);
  });

  it('PUT /settings/assignment: round robin and reassignment; the queue cannot be switched off yet', async () => {
    const body = { defaultQueue: true, roundRobin: false, reassign: false, reassignAfterHours: 4 };
    expect((await call('put', '/settings/assignment', body)).body).toEqual(body);
    const off = await call('put', '/settings/assignment', { ...body, defaultQueue: false });
    expect([off.status, code(off)]).toEqual([422, 'NOT_SUPPORTED_YET']);
  });

  it('PUT /settings/escalation: the three rules; the Support Lead is the one notified', async () => {
    const body = {
      slaBreach: { enabled: true, notify: 'LEAD' },
      highPriority: {
        enabled: true,
        priorityId: priority('High').id,
        target: { amount: 1, unit: 'BUSINESS_DAYS' },
      },
      critical: { enabled: true, priorityId: priority('Critical').id, channels: ['SMS', 'EMAIL'] },
    };
    const saved = await call('put', '/settings/escalation', body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({
      ...body,
      critical: { ...body.critical, channels: ['EMAIL', 'SMS'] },
    });
    const back = await call('put', '/settings/escalation', {
      ...body,
      slaBreach: { enabled: true, notify: 'ADMINS' },
    });
    expect(back.body).toMatchObject({ slaBreach: { notify: 'ADMINS' } });
    expect(
      (
        await call('put', '/settings/escalation', {
          ...body,
          critical: { ...body.critical, priorityId: randomUUID() },
        })
      ).status,
    ).toBe(400);
  });

  it('POST, PATCH and PUT active on canned responses', async () => {
    const created = await call('post', '/settings/canned-responses', {
      title: `Fake reset steps ${run}`,
      body: 'Open Settings, then Security.',
      categoryId: category('Account Access').id,
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({ createdBy: 'Fake admin', active: true });
    const changed = await call('patch', `/settings/canned-responses/${id}`, {
      title: `Fake reset ${run}`,
      body: 'Steps.',
    });
    expect(changed.body).toMatchObject({ title: `Fake reset ${run}`, categoryId: null });
    expect(
      (await call('put', `/settings/canned-responses/${id}/active`, { active: false })).body,
    ).toMatchObject({
      active: false,
    });
  });

  it('PUT /settings/notifications: recipients and channels per event; the client only for client events', async () => {
    const saved = await call('put', '/settings/notifications', {
      channels: ['EMAIL', 'IN_APP'],
      rules: [
        { event: 'NEW_TICKET', recipients: ['ADMINS', 'CLIENT'] },
        { event: 'SLA_BREACH', recipients: ['ASSIGNEE', 'LEAD', 'CLIENT'] },
        { event: 'REPLY', recipients: ['CLIENT'] },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const rules = (saved.body as SupportSettings['notifications']).rules;
    expect(rules.find((r) => r.event === 'NEW_TICKET')?.recipients).toEqual(['ADMINS', 'CLIENT']);
    expect(rules.find((r) => r.event === 'SLA_BREACH')?.recipients).toEqual(['ASSIGNEE', 'LEAD']);
    expect(rules.find((r) => r.event === 'REPLY')?.recipients).toEqual(['CLIENT']);
    expect((saved.body as SupportSettings['notifications']).channels).toEqual(['IN_APP', 'EMAIL']);
    const restored = await call('put', '/settings/notifications', settings.notifications);
    expect(restored.body).toEqual(settings.notifications);
  });

  it('PUT /settings/permissions: stored on the roles; the Owner keeps Edit settings', async () => {
    const refused = await call('put', '/settings/permissions', {
      OWNER: ['VIEW_ALL'],
      LEAD: [],
      AGENT: [],
    });
    expect([refused.status, code(refused)]).toEqual([422, 'OWNER_KEEPS_SETTINGS']);
    const grid = { ...settings.permissions, AGENT: ['VIEW_OWN', 'RESOLVE'] };
    const saved = await call('put', '/settings/permissions', grid);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(grid);
    expect((await call('put', '/settings/permissions', settings.permissions)).body).toEqual(
      settings.permissions,
    );
  });
});

describe('tickets', () => {
  it('POST /uploads: an upload ticket under the firm; an unknown firm is 404', async () => {
    const res = await call('post', '/uploads', {
      firmId: fx.firmA.id,
      fileName: 'w2.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
    });
    expect(res.status).toBe(200);
    expect((res.body as UploadTicket).url).toMatch(
      new RegExp(`^memory:tenant/${fx.firmA.id}/support/`),
    );
    const unknown = await call('post', '/uploads', {
      firmId: randomUUID(),
      fileName: 'w2.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
    });
    expect(unknown.status).toBe(404);
  });

  it('POST /tickets: a numbered ticket in the chosen status, with its file and note; a retry is the same ticket', async () => {
    const requestId = randomUUID();
    const token = await upload();
    const body = {
      requestId,
      firmId: fx.firmA.id,
      contactId: fx.users.ownerA.id,
      subject: `Fake W-2 will not upload ${run}`,
      categoryId: category('Document Filing').id,
      priorityId: priority('High').id,
      assignTo: lead.id,
      status: 'IN_PROGRESS',
      source: 'PHONE',
      description: 'Called about a W-2 that stops at 90%.',
      uploadTokens: [token],
      internalNote: 'Checked the upload logs.',
    };
    const res = await call('post', '/tickets', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const t = SupportTicket.parse(res.body);
    expect(t.number).toBeGreaterThan(1000);
    expect(t).toMatchObject({
      status: 'IN_PROGRESS',
      source: 'PHONE',
      assignee: { id: lead.id, name: 'Fake Support Lead' },
      firm: { id: fx.firmA.id },
      contact: { id: fx.users.ownerA.id, email: fx.users.ownerA.email },
      createdBy: { role: 'CLIENT' },
      counts: { messages: 1, attachments: 1, notes: 1 },
      version: 1,
      escalation: null,
    });
    expect(t.sla.state).toBe('WITHIN');
    expect(t.sla.dueAt).not.toBeNull();
    const again = await call('post', '/tickets', body);
    expect((again.body as SupportTicket).id).toBe(t.id);
    // The file was used: the token does not add it to another ticket.
    const reused = await call('post', '/tickets', { ...body, requestId: randomUUID() });
    expect(reused.status).toBe(410);
  });

  it('POST /tickets: refuses a contact from another firm, an inactive priority and a stranger as assignee', async () => {
    const base = {
      requestId: randomUUID(),
      firmId: fx.firmA.id,
      contactId: fx.users.ownerB.id,
      subject: 'Fake',
      categoryId: category('General Inquiry').id,
      priorityId: priority('Low').id,
      assignTo: 'QUEUE',
      status: 'OPEN',
      source: 'INTERNAL',
      description: 'Fake',
    };
    const contact = await call('post', '/tickets', base);
    expect([contact.status, code(contact)]).toEqual([400, 'CONTACT_NOT_IN_FIRM']);
    const stranger = await call('post', '/tickets', {
      ...base,
      requestId: randomUUID(),
      contactId: fx.users.ownerA.id,
      assignTo: fx.users.ownerA.id,
    });
    expect([stranger.status, code(stranger)]).toEqual([409, 'AGENT_INACTIVE']);
    const wrongFirmFile = await call('post', '/tickets', {
      ...base,
      requestId: randomUUID(),
      contactId: fx.users.ownerA.id,
      uploadTokens: [await upload(PDF, 'b.pdf', 'application/pdf', fx.firmB.id)],
    });
    expect([wrongFirmFile.status, code(wrongFirmFile)]).toEqual([410, 'UPLOAD_EXPIRED']);
  });

  it('GET /tickets: tabs, filters, search and paging; GET /summary counts the same tickets', async () => {
    const queued = await newTicket({ subject: `Fake queued ${run}` });
    const waiting = await newTicket({
      subject: `Fake waiting ${run}`,
      status: 'WAITING_ON_CUSTOMER',
    });
    const all = SupportTicketPage.parse(
      (await call('get', `/tickets?search=${run}&pageSize=100`)).body,
    );
    expect(all.items.map((t) => t.id)).toEqual(expect.arrayContaining([queued.id, waiting.id]));
    const unassigned = SupportTicketPage.parse(
      (await call('get', `/tickets?tab=UNASSIGNED&search=${run}`)).body,
    );
    expect(unassigned.items.some((t) => t.id === queued.id)).toBe(true);
    const waitingTab = SupportTicketPage.parse(
      (await call('get', `/tickets?tab=WAITING&search=${run}`)).body,
    );
    expect(waitingTab.items.map((t) => t.id)).toEqual([waiting.id]);
    expect(waitingTab.items[0]!.sla.state).toBe('PAUSED');
    const filtered = SupportTicketPage.parse(
      (await call('get', `/tickets?statuses=OPEN,IN_PROGRESS&search=${run}&pageSize=100`)).body,
    );
    expect(filtered.items.some((t) => t.id === waiting.id)).toBe(false);
    const byNumber = SupportTicketPage.parse(
      (await call('get', `/tickets?search=%23${queued.number}`)).body,
    );
    expect(byNumber.items.map((t) => t.id)).toEqual([queued.id]);
    const paged = SupportTicketPage.parse(
      (await call('get', `/tickets?search=${run}&pageSize=1&page=2`)).body,
    );
    expect(paged).toMatchObject({ page: 2, pageSize: 1 });
    expect((await call('get', '/tickets?statuses=ESCALATED')).status).toBe(400);
    const summary = SupportSummary.parse((await call('get', '/summary')).body);
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.waiting).toBeGreaterThanOrEqual(1);
    expect(summary.tabs.ALL).toBe(summary.total);
    expect(summary.tabs.WAITING).toBe(summary.waiting);
  });

  it('GET /tickets/:id: the opening message, notes, files and history; another id is 404', async () => {
    const token = await upload();
    const t = await newTicket({ uploadTokens: [token], internalNote: 'Fake note' });
    const d = await detail(t.id);
    expect(d.description).toBe('The upload stops at 90%.');
    expect(d.messages).toEqual([
      expect.objectContaining({
        id: t.id,
        author: { name: 'Fake ownerA', role: 'CLIENT' },
        sentToClient: true,
      }),
    ]);
    expect(d.messages[0]!.attachments).toEqual([expect.objectContaining({ name: 'w2-form.pdf' })]);
    expect(d.notes).toEqual([expect.objectContaining({ author: 'Fake admin', body: 'Fake note' })]);
    expect(d.attachments).toEqual([
      expect.objectContaining({ name: 'w2-form.pdf', scanStatus: 'PENDING', size: PDF.length }),
    ]);
    expect(d.activity.map((a) => a.type)).toEqual(
      expect.arrayContaining(['CREATED', 'AUTOMATION', 'ATTACHMENT', 'NOTE']),
    );
    expect((await call('get', `/tickets/${randomUUID()}`)).status).toBe(404);
    expect((await call('get', '/tickets/not-a-uuid')).status).toBe(400);
  });

  it('GET /tickets/:id/attachments/:aid/download: only once the scan is clean', async () => {
    const t = await newTicket({ uploadTokens: [await upload()] });
    const file = (await detail(t.id)).attachments[0]!;
    const pending = await call('get', `/tickets/${t.id}/attachments/${file.id}/download`);
    expect([pending.status, code(pending)]).toEqual([409, 'SCAN_PENDING']);
    const key = await asOwner((tx) =>
      tx.supportTicketAttachment.findUniqueOrThrow({
        where: { id: file.id },
        select: { s3Key: true },
      }),
    );
    const outcome = await files.handle({
      businessId: fx.firmA.id,
      prefix: 'support',
      key: key.s3Key,
      path: key.s3Key.split('/support/')[1]!,
      status: 'NO_THREATS_FOUND',
      reasons: [],
      versionId: null,
      eventTime: new Date(),
      eventId: randomUUID(),
    });
    expect(outcome).toBe('CLEAN');
    const link = await call('get', `/tickets/${t.id}/attachments/${file.id}/download`);
    expect(link.status).toBe(200);
    expect((link.body as { url: string }).url).toBe(`memory:${key.s3Key}?download`);
    expect(
      (await call('get', `/tickets/${t.id}/attachments/${randomUUID()}/download`)).status,
    ).toBe(404);
  });

  it('PATCH /tickets/:id: status, priority and category with the version; stale is 409', async () => {
    const t = await newTicket();
    const waiting = await call('patch', `/tickets/${t.id}`, {
      version: 1,
      status: 'WAITING_ON_CUSTOMER',
    });
    expect(waiting.body).toMatchObject({
      status: 'WAITING_ON_CUSTOMER',
      version: 2,
      sla: { state: 'PAUSED' },
    });
    const stale = await call('patch', `/tickets/${t.id}`, { version: 1, status: 'OPEN' });
    expect([stale.status, code(stale)]).toEqual([409, 'CONFLICT']);
    const back = await call('patch', `/tickets/${t.id}`, {
      version: 2,
      status: 'IN_PROGRESS',
      priorityId: priority('Critical').id,
      categoryId: category('Technical Issue').id,
    });
    expect(back.body).toMatchObject({
      status: 'IN_PROGRESS',
      priority: { name: 'Critical' },
      category: { name: 'Technical Issue' },
      sla: { state: 'WITHIN' },
    });
    const resolved = SupportTicket.parse(
      (await call('patch', `/tickets/${t.id}`, { version: 3, status: 'RESOLVED' })).body,
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.sla.state).toBe('MET');
    const reopened = SupportTicket.parse(
      (await call('patch', `/tickets/${t.id}`, { version: 4, status: 'OPEN' })).body,
    );
    expect(reopened).toMatchObject({ resolvedAt: null, closedAt: null, status: 'OPEN' });
    expect((await detail(t.id)).activity.map((a) => a.type)).toEqual(
      expect.arrayContaining([
        'STATUS_CHANGED',
        'PRIORITY_CHANGED',
        'CATEGORY_CHANGED',
        'REOPENED',
      ]),
    );
  });

  it('POST /tickets/:id/assign: to a member, back to the queue; a stranger is refused', async () => {
    const t = await newTicket();
    const assigned = await call('post', `/tickets/${t.id}/assign`, {
      version: 1,
      assignTo: lead.id,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ assignee: { id: lead.id }, version: 2 });
    const queued = await call('post', `/tickets/${t.id}/assign`, { version: 2, assignTo: 'QUEUE' });
    expect(queued.body).toMatchObject({ assignee: null, version: 3 });
    const same = await call('post', `/tickets/${t.id}/assign`, { version: 3, assignTo: 'QUEUE' });
    expect(same.body).toMatchObject({ version: 3 });
    const stranger = await call('post', `/tickets/${t.id}/assign`, {
      version: 3,
      assignTo: randomUUID(),
    });
    expect(code(stranger)).toBe('AGENT_INACTIVE');
    const types = (await detail(t.id)).activity.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['ASSIGNED', 'UNASSIGNED']));
  });

  it('POST /tickets/:id/escalate: with a reason, only while active', async () => {
    const t = await newTicket();
    const res = await call('post', `/tickets/${t.id}/escalate`, {
      version: 1,
      reason: 'Fake firm cannot file',
    });
    expect(res.body).toMatchObject({
      escalation: { reason: 'Fake firm cannot file', by: 'Fake admin' },
    });
    const tab = SupportTicketPage.parse(
      (await call('get', `/tickets?tab=ESCALATED&search=%23${t.number}`)).body,
    );
    expect(tab.items.map((x) => x.id)).toEqual([t.id]);
    await call('patch', `/tickets/${t.id}`, { version: 2, status: 'CLOSED' });
    const closed = await call('post', `/tickets/${t.id}/escalate`, { version: 3, reason: 'Again' });
    expect([closed.status, code(closed)]).toEqual([409, 'TICKET_CLOSED']);
  });

  it('POST /tickets/:id/merge: the source closes and its thread shows on the target', async () => {
    const target = await newTicket({ subject: 'Fake target' });
    const source = await newTicket({ subject: 'Fake duplicate', description: 'Same issue again.' });
    const res = await call('post', `/tickets/${target.id}/merge`, {
      version: 1,
      sourceId: source.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = await detail(target.id);
    expect(d.messages.find((m) => m.mergedFrom === source.number)?.body).toBe('Same issue again.');
    expect(d.activity.some((a) => a.type === 'MERGED')).toBe(true);
    const s = await detail(source.id);
    expect(s).toMatchObject({
      status: 'CLOSED',
      mergedInto: { id: target.id, number: target.number },
    });
    const again = await call('post', `/tickets/${target.id}/merge`, {
      version: 2,
      sourceId: source.id,
    });
    expect(code(again)).toBe('ALREADY_MERGED');
    const self = await call('post', `/tickets/${target.id}/merge`, {
      version: 2,
      sourceId: target.id,
    });
    expect(self.status).toBe(400);
  });

  it('POST /tickets/:id/replies: a reply answers the client and stops the clock; a note stays internal', async () => {
    const t = await newTicket();
    const kept = await call('post', `/tickets/${t.id}/replies`, {
      mode: 'REPLY',
      body: 'Draft for the team',
      sendToClient: false,
    });
    expect(kept.body).toMatchObject({ firstResponseAt: null, counts: { messages: 2 } });
    const sent = SupportTicket.parse(
      (
        await call('post', `/tickets/${t.id}/replies`, {
          mode: 'REPLY',
          body: 'Please try again now.',
          uploadTokens: [await upload(PNG, 'steps.png', 'image/png')],
        })
      ).body,
    );
    expect(sent.firstResponseAt).not.toBeNull();
    expect(sent.sla.dueAt).toBeNull();
    const note = await call('post', `/tickets/${t.id}/replies`, {
      mode: 'NOTE',
      body: 'Fake: logs look fine',
    });
    expect(note.body).toMatchObject({ counts: { notes: 1 } });
    const d = await detail(t.id);
    expect(d.messages.map((m) => [m.author.role, m.sentToClient])).toEqual([
      ['CLIENT', true],
      ['SUPPORT', false],
      ['SUPPORT', true],
    ]);
    expect(d.messages[2]!.attachments).toEqual([expect.objectContaining({ name: 'steps.png' })]);
    expect(
      (await call('post', `/tickets/${t.id}/replies`, { mode: 'REPLY', body: '   ' })).status,
    ).toBe(400);
  });

  it('POST /tickets/:id/attachments: files on the ticket; a bad file is refused and deleted', async () => {
    const t = await newTicket();
    const res = await call('post', `/tickets/${t.id}/attachments`, {
      uploadTokens: [await upload()],
    });
    expect(res.body).toMatchObject({ counts: { attachments: 1 } });
    const fake = await upload(Buffer.from('not a pdf at all'), 'fake.pdf');
    const refused = await call('post', `/tickets/${t.id}/attachments`, { uploadTokens: [fake] });
    expect([refused.status, code(refused)]).toEqual([409, 'UPLOAD_MISMATCH']);
    expect((await call('post', `/tickets/${t.id}/attachments`, { uploadTokens: [] })).status).toBe(
      400,
    );
  });

  it('DELETE /tickets/:id: soft, with the version; the ticket leaves every list', async () => {
    const t = await newTicket();
    expect((await call('delete', `/tickets/${t.id}?version=9`)).status).toBe(409);
    expect((await call('delete', `/tickets/${t.id}?version=1`)).body).toEqual({ ok: true });
    expect((await call('get', `/tickets/${t.id}`)).status).toBe(404);
    const list = SupportTicketPage.parse(
      (await call('get', `/tickets?search=%23${t.number}`)).body,
    );
    expect(list.items).toEqual([]);
    const row = await asOwner((tx) => tx.supportTicket.findUniqueOrThrow({ where: { id: t.id } }));
    expect(row.deletedAt).not.toBeNull();
  });

  it('the rules: a breach is recorded once and escalates by the SLA breach rule', async () => {
    const t = await newTicket({ priorityId: priority('Critical').id });
    await asOwner((tx) =>
      tx.supportTicket.update({
        where: { id: t.id },
        data: { firstResponseDueAt: new Date(Date.now() - 60_000) },
      }),
    );
    await tickets.runRules(true);
    await tickets.runRules(true);
    const d = await detail(t.id);
    expect(d.sla.state).toBe('BREACHED');
    expect(d.escalation).toMatchObject({
      by: 'System',
      reason: 'Response time exceeded the SLA target',
    });
    expect(d.activity.filter((a) => a.type === 'SLA_BREACHED')).toHaveLength(1);
    const overdue = SupportTicketPage.parse(
      (await call('get', `/tickets?tab=OVERDUE&search=%23${t.number}`)).body,
    );
    expect(overdue.items.map((x) => x.id)).toEqual([t.id]);
  });

  it("a firm Owner's session reaches no Support route (the admin site's session only)", async () => {
    const t = await newTicket();
    for (const [method, path] of [
      ['get', '/tickets'],
      ['get', `/tickets/${t.id}`],
      ['get', '/summary'],
      ['post', `/tickets/${t.id}/replies`],
    ] as const) {
      const res = await call(
        method,
        path,
        method === 'post' ? { mode: 'NOTE', body: 'x' } : undefined,
        fx.users.ownerA.email,
      );
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
