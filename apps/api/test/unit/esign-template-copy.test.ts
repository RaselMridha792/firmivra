// R13 step 9, templates from requests: save-as-template and duplicate on the in-memory ports
// (esign-fakes.ts). What a template keeps and drops (never a client's file or value; the sender's
// own values only when asked), the refusals before anything is stored, a refused name removing the
// stored packet, the access rules, the 404s across firms and the audit (ids only). Synthetic data
// only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignTemplateDetail, type EsignField } from '@firmivra/types';
import type { EsignDocumentRecord } from '../../src/esign/requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignTemplateCopyService } from '../../src/esign/templates/template-copy.service.js';
import { EsignTemplatesService } from '../../src/esign/templates/templates.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  fakePdf,
  InMemoryTemplateRepository,
  seedTemplate,
} from './esign-fakes.js';

let w: EsignWorld;
let templates: InMemoryTemplateRepository;
let requests: EsignRequestsService;
let svc: EsignTemplateCopyService;
let owner: EsignActor;
let staff: EsignActor;

beforeEach(() => {
  w = esignWorld();
  templates = new InMemoryTemplateRepository();
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  const access = new EsignTemplatesService(templates, w.directory, w.store, w.audit);
  svc = new EsignTemplateCopyService(
    requests,
    access,
    templates,
    w.repo,
    fakePdf,
    w.store,
    w.audit,
  );
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
});
afterEach(() => vi.restoreAllMocks());

async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}

/**
 * A DRAFT for c1 by staff: one uploaded 2-page file (its second page turned), the primary login
 * and an outside person as signers, a field each, a merge field and a sender-typed field.
 */
async function draft(file: Partial<EsignDocumentRecord> = {}) {
  const { id } = await requests.create(w.a, staff, {
    title: 'Fake letter for Fake Client One',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c1,
    engagementId: w.ids.e1,
  });
  const documentId = randomUUID();
  const s3Key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, s3Key, new Uint8Array(Buffer.from('pdf:2')), 'application/pdf');
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [
      {
        id: documentId,
        position: 0,
        fileName: 'Fake letter.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
        pageCount: 2,
        pageSizes: [
          { width: 612, height: 792 },
          { width: 612, height: 792 },
        ],
        sourceDocumentId: null,
        scanStatus: 'CLEAN',
        createdAt: new Date(),
        s3Key,
        sha256: '0'.repeat(64),
        ...file,
      },
    ];
    row.parts.pagePlan = [
      { documentId, page: 0, rotation: 0 },
      { documentId, page: 1, rotation: 90 },
    ];
  });
  const withRecipients = await requests.putRecipients(w.a, staff, id, {
    recipients: [
      {
        kind: 'SIGNER',
        role: 'CLIENT',
        routingOrder: 1,
        who: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary },
        delivery: 'EMAIL',
        authMethod: 'EMAIL_CODE',
      },
      {
        kind: 'SIGNER',
        role: 'CUSTOM',
        roleLabel: 'Fake witness',
        routingOrder: 2,
        who: { type: 'EXTERNAL', name: 'Fake Outside', email: 'outside@example.test' },
        delivery: 'EMAIL',
        authMethod: 'ACCESS_CODE',
        accessCode: 'FAKE1234',
      },
    ],
  });
  const [client, outside] = withRecipients.recipients;
  const field = (extra: Partial<EsignField>): EsignField => ({
    id: randomUUID(),
    recipientId: null,
    type: 'TEXT',
    pageIndex: 0,
    ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
    required: true,
    label: null,
    mergeKey: null,
    options: [],
    groupKey: null,
    value: null,
    filled: false,
    ...extra,
  });
  w.repo.seed(w.a, id, (row) => {
    row.parts.fields = [
      field({ recipientId: client!.id, type: 'SIGNATURE', pageIndex: 1 }),
      field({ recipientId: outside!.id, type: 'SIGNATURE', pageIndex: 1, y: 0.5 }),
      field({ mergeKey: 'CLIENT_FULL_NAME', value: 'Fake Client One' }),
      field({ value: 'Fake sender note', y: 0.3 }),
    ];
  });
  w.audit.entries.length = 0;
  return id;
}

describe('save as template', () => {
  it('keeps the packet, roles, fields and settings, and nothing of the client', async () => {
    const requestId = await draft();
    const t = EsignTemplateDetail.parse(
      await svc.saveAsTemplate(w.a, staff, requestId, {
        name: 'Fake engagement',
        visibility: 'PRIVATE',
        keepSenderValues: false,
      }),
    );
    expect(t).toMatchObject({
      visibility: 'PRIVATE',
      owner: { userId: w.users.staffA },
      version: 1,
      pageCount: 2,
      roleCount: 2,
      // The turned page shows its long side across.
      pageSizes: [
        { width: 612, height: 792 },
        { width: 792, height: 612 },
      ],
      roles: [
        { key: 'role-1', role: 'CLIENT', authMethod: 'EMAIL_CODE', colorIndex: 0 },
        { key: 'role-2', role: 'CUSTOM', roleLabel: 'Fake witness', authMethod: 'ACCESS_CODE' },
      ],
      expiryDays: 30,
    });
    expect(t.fields.map((f) => [f.roleKey, f.mergeKey, f.value])).toEqual([
      ['role-1', null, null],
      ['role-2', null, null],
      [null, 'CLIENT_FULL_NAME', null],
      [null, null, null],
    ]);
    const text = JSON.stringify(t);
    for (const secret of ['Fake Client One', 'Fake Outside', 'outside@example.test', 'FAKE1234']) {
      expect(text).not.toContain(secret);
    }
    const stored = (await templates.version(w.a, t.id, 1))!;
    expect(stored.s3Key).toMatch(new RegExp(`^tenant/${w.a}/esign/${t.id}/template-`));
    expect(Buffer.from((await w.store.read(w.a, stored.s3Key))!).toString()).toMatch(/^packet:/);
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.template_created',
        entity: { type: 'esign_template', id: t.id },
        metadata: { fromRequestId: requestId, visibility: 'PRIVATE', version: 1 },
      },
    ]);
  });

  it('keeps the sender’s own typed values only when asked, never merge values', async () => {
    const requestId = await draft();
    const t = await svc.saveAsTemplate(w.a, staff, requestId, {
      name: 'Fake kept',
      visibility: 'FIRM',
      keepSenderValues: true,
    });
    expect(t.visibility).toBe('FIRM');
    expect(t.fields.map((f) => f.value)).toEqual([null, null, null, 'Fake sender note']);
  });

  it('refuses client files, files not CLEAN and an empty packet, storing nothing', async () => {
    const cases: [Partial<EsignDocumentRecord>, string][] = [
      [{ sourceDocumentId: randomUUID() }, 'TEMPLATE_HAS_CLIENT_FILES'],
      [{ scanStatus: 'PENDING' }, 'SCAN_PENDING'],
      [{ scanStatus: 'INFECTED' }, 'FILE_BLOCKED'],
      [{ scanStatus: 'FAILED' }, 'FILE_BLOCKED'],
    ];
    for (const [file, code] of cases) {
      const requestId = await draft(file);
      const objects = w.store.objects.size;
      const body = {
        name: `Fake ${code}`,
        visibility: 'PRIVATE' as const,
        keepSenderValues: false,
      };
      expect(await refused(svc.saveAsTemplate(w.a, staff, requestId, body))).toEqual([409, code]);
      expect(w.store.objects.size).toBe(objects);
    }
    const { id: empty } = await requests.create(w.a, staff, { title: 'Fake', source: 'TAB' });
    w.audit.entries.length = 0;
    const body = { name: 'Fake empty', visibility: 'PRIVATE' as const, keepSenderValues: false };
    expect(await refused(svc.saveAsTemplate(w.a, staff, empty, body))).toEqual([
      409,
      'INVALID_STATE',
    ]);
    expect((await templates.list(w.a, { visibleTo: null, archived: false })).length).toBe(0);
    expect(w.audit.entries).toEqual([]);
  });

  it('refuses a taken name (409) and removes the packet it stored', async () => {
    await seedTemplate(w.a, templates, w.store, w.users.ownerA, { name: 'Fake taken' });
    const requestId = await draft();
    const objects = w.store.objects.size;
    const body = { name: 'FAKE TAKEN', visibility: 'PRIVATE' as const, keepSenderValues: false };
    expect(await refused(svc.saveAsTemplate(w.a, staff, requestId, body))).toEqual([
      409,
      'TEMPLATE_NAME_TAKEN',
    ]);
    expect(w.store.objects.size).toBe(objects);
  });

  it('answers 404 to who may not change the request and across firms; 403 to a Viewer', async () => {
    const requestId = await draft();
    const body = { name: 'Fake', visibility: 'PRIVATE' as const, keepSenderValues: false };
    const staff2: EsignActor = { userId: w.users.staffA2, role: 'STAFF' };
    expect(await refused(svc.saveAsTemplate(w.a, staff2, requestId, body))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    expect(await refused(svc.saveAsTemplate(w.b, ownerB, requestId, body))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    const viewer: EsignActor = { userId: w.users.staffA, role: 'VIEWER' };
    expect(await refused(svc.saveAsTemplate(w.a, viewer, requestId, body))).toEqual([
      403,
      'FORBIDDEN',
    ]);
  });
});

describe('duplicate', () => {
  it('copies the newest version into a template the caller owns, at version 1', async () => {
    const source = await seedTemplate(w.a, templates, w.store, w.users.ownerA, {
      version: 1,
      description: 'Fake words',
    });
    const copy = await svc.duplicate(w.a, staff, source.record.id, { name: 'Fake copy' });
    expect(copy).toMatchObject({
      name: 'Fake copy',
      description: 'Fake words',
      visibility: 'FIRM',
      owner: { userId: w.users.staffA },
      version: 1,
      canEdit: true,
    });
    expect(copy.fields.map((f) => f.roleKey)).toEqual(
      source.versions[0]!.fields.map((f) => f.roleKey),
    );
    const stored = (await templates.version(w.a, copy.id, 1))!;
    expect(stored.s3Key.startsWith(`tenant/${w.a}/esign/${copy.id}/`)).toBe(true);
    expect(Buffer.from((await w.store.read(w.a, stored.s3Key))!).toString()).toBe('pdf:2');
    const priv = await svc.duplicate(w.a, staff, source.record.id, {
      name: 'Fake private copy',
      visibility: 'PRIVATE',
    });
    expect(priv.visibility).toBe('PRIVATE');
    expect(w.audit.entries.map((e) => e.metadata)).toEqual([
      { fromTemplateId: source.record.id, visibility: 'FIRM', version: 1 },
      { fromTemplateId: source.record.id, visibility: 'PRIVATE', version: 1 },
    ]);
  });

  it('refuses a taken name (409) and removes the copied packet', async () => {
    const source = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const objects = w.store.objects.size;
    const res = svc.duplicate(w.a, staff, source.record.id, { name: source.record.name });
    expect(await refused(res)).toEqual([409, 'TEMPLATE_NAME_TAKEN']);
    expect(w.store.objects.size).toBe(objects);
  });

  it('answers 404 for another member’s PRIVATE or another firm’s, 403 to a Viewer', async () => {
    const theirs = await seedTemplate(w.a, templates, w.store, w.users.staffA2, {
      visibility: 'PRIVATE',
    });
    const other = await seedTemplate(w.b, templates, w.store, w.users.ownerB);
    const firm = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const viewer: EsignActor = { userId: w.users.staffA, role: 'VIEWER' };
    for (const [who, id, answer] of [
      [staff, theirs.record.id, '404 NOT_FOUND'],
      [owner, other.record.id, '404 NOT_FOUND'],
      [viewer, firm.record.id, '403 FORBIDDEN'],
    ] as const) {
      const [status, code] = await refused(svc.duplicate(w.a, who, id, { name: 'Fake dup' }));
      expect(`${status} ${code}`).toBe(answer);
    }
  });
});
