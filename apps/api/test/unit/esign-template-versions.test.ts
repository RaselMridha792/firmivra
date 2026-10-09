// R13 step 10, template versions: the list, save-as-version and restore on the in-memory ports
// (esign-fakes.ts). A version is only ever added on top (never changed or deleted), save-as-version
// copies and refuses exactly as save-as-template, restore shares the old packet, who may add one,
// archived templates, the optimistic lock (a refused write removes the stored packet), the 404s
// across firms and for another member's PRIVATE template, and the audit (ids only). Synthetic
// data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignTemplateDetail, EsignTemplateVersionList } from '@firmivra/types';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignTemplateCopyService } from '../../src/esign/templates/template-copy.service.js';
import { EsignTemplateVersionsService } from '../../src/esign/templates/template-versions.service.js';
import { EsignTemplatesService } from '../../src/esign/templates/templates.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  fakePdf,
  InMemoryTemplateRepository,
  seedTemplate,
  type TemplateRow,
} from './esign-fakes.js';

let w: EsignWorld;
let templates: InMemoryTemplateRepository;
let requests: EsignRequestsService;
let svc: EsignTemplateVersionsService;
let owner: EsignActor;
let staff: EsignActor;
/** A PRIVATE template staff owns, at version 1. */
let mine: TemplateRow;

beforeEach(async () => {
  w = esignWorld();
  templates = new InMemoryTemplateRepository(w.repo);
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  const access = new EsignTemplatesService(templates, w.directory, w.store, w.audit);
  const copies = new EsignTemplateCopyService(
    requests,
    access,
    templates,
    w.repo,
    fakePdf,
    w.store,
    w.audit,
  );
  svc = new EsignTemplateVersionsService(requests, access, copies, templates, w.directory, w.audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  mine = await seedTemplate(w.a, templates, w.store, w.users.staffA, { visibility: 'PRIVATE' });
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

/** A DRAFT for c1 by staff: one 1-page file, a sender-typed field and a merge field. */
async function draft(sourceDocumentId: string | null = null) {
  const { id } = await requests.create(w.a, staff, {
    title: 'Fake letter',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c1,
  });
  const documentId = randomUUID();
  const s3Key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, s3Key, new Uint8Array(Buffer.from('pdf:1')), 'application/pdf');
  const field = (value: string, mergeKey: 'CLIENT_FULL_NAME' | null) => ({
    id: randomUUID(),
    recipientId: null,
    type: 'TEXT' as const,
    pageIndex: 0,
    ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
    required: false,
    label: null,
    mergeKey,
    options: [],
    groupKey: null,
    value,
    filled: false,
  });
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [
      {
        id: documentId,
        position: 0,
        fileName: 'Fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
        pageCount: 1,
        pageSizes: [{ width: 612, height: 792 }],
        sourceDocumentId,
        scanStatus: 'CLEAN',
        createdAt: new Date(),
        s3Key,
        sha256: '0'.repeat(64),
      },
    ];
    row.parts.pagePlan = [{ documentId, page: 0, rotation: 0 }];
    row.parts.fields = [
      field('Fake sender words', null),
      field('Fake Client One', 'CLIENT_FULL_NAME'),
    ];
  });
  w.audit.entries.length = 0;
  return id;
}
const body = (extra: object = {}) => ({
  templateId: mine.record.id,
  keepSenderValues: false,
  ...extra,
});

describe('template versions', () => {
  it('lists every version, newest first, with the current one marked', async () => {
    const list = EsignTemplateVersionList.parse(await svc.list(w.a, owner, mine.record.id));
    expect(list.items).toEqual([
      {
        version: 1,
        savedAt: mine.versions[0]!.savedAt.toISOString(),
        savedBy: { userId: w.users.staffA, name: 'staff-a' },
        note: null,
        pageCount: 2,
        roleCount: 2,
        fieldCount: 3,
        current: true,
      },
    ]);
  });

  it('saves a request as the next version; the older one stays as it was', async () => {
    const requestId = await draft();
    const saved = EsignTemplateDetail.parse(
      await svc.saveAsVersion(w.a, staff, requestId, body({ note: 'Fake change' })),
    );
    expect([saved.version, saved.pageCount, saved.roleCount]).toEqual([2, 1, 0]);
    expect(saved.fields.map((f) => f.value)).toEqual([null, null]);
    const list = await svc.list(w.a, staff, mine.record.id);
    expect(list.items.map((v) => [v.version, v.note, v.current, v.pageCount])).toEqual([
      [2, 'Fake change', true, 1],
      [1, null, false, 2],
    ]);
    expect(await templates.version(w.a, mine.record.id, 1)).toEqual(mine.versions[0]);
    const v2 = (await templates.version(w.a, mine.record.id, 2))!;
    expect(v2.s3Key).toMatch(new RegExp(`^tenant/${w.a}/esign/${mine.record.id}/template-`));
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.template_version_saved',
        entity: { type: 'esign_template', id: mine.record.id },
        metadata: { fromRequestId: requestId, version: 2 },
      },
    ]);
    const kept = await svc.saveAsVersion(w.a, staff, requestId, body({ keepSenderValues: true }));
    expect([kept.version, kept.fields.map((f) => f.value)]).toEqual([
      3,
      ['Fake sender words', null],
    ]);
  });

  it('refuses what save-as-template refuses, archived templates, and storing nothing', async () => {
    const vault = await draft(randomUUID());
    const requestId = await draft();
    const archived = await seedTemplate(w.a, templates, w.store, w.users.staffA, {
      archivedAt: new Date(),
    });
    const objects = w.store.objects.size;
    expect(await refused(svc.saveAsVersion(w.a, staff, vault, body()))).toEqual([
      409,
      'TEMPLATE_HAS_CLIENT_FILES',
    ]);
    const toArchived = body({ templateId: archived.record.id });
    expect(await refused(svc.saveAsVersion(w.a, staff, requestId, toArchived))).toEqual([
      409,
      'TEMPLATE_ARCHIVED',
    ]);
    expect(await refused(svc.restore(w.a, staff, archived.record.id, 1, {}))).toEqual([
      409,
      'TEMPLATE_ARCHIVED',
    ]);
    expect(w.store.objects.size).toBe(objects);
    expect((await templates.find(w.a, mine.record.id))?.version).toBe(1);
  });

  it('refuses a version over a change it did not see (409), removing the stored packet', async () => {
    const requestId = await draft();
    const stale = await templates.find(w.a, mine.record.id);
    await svc.restore(w.a, staff, mine.record.id, 1, {});
    vi.spyOn(templates, 'find').mockResolvedValue(stale);
    const objects = w.store.objects.size;
    expect(await refused(svc.saveAsVersion(w.a, staff, requestId, body()))).toEqual([
      409,
      'INVALID_STATE',
    ]);
    expect(await refused(svc.restore(w.a, staff, mine.record.id, 1, {}))).toEqual([
      409,
      'INVALID_STATE',
    ]);
    expect(w.store.objects.size).toBe(objects);
    vi.restoreAllMocks();
    expect((await templates.find(w.a, mine.record.id))?.version).toBe(2);
  });

  it('restores an older version as a new newest one, sharing its packet', async () => {
    await svc.saveAsVersion(w.a, staff, await draft(), body());
    w.audit.entries.length = 0;
    const restored = await svc.restore(w.a, staff, mine.record.id, 1, {});
    expect([restored.version, restored.pageCount, restored.roleCount]).toEqual([3, 2, 2]);
    const v3 = (await templates.version(w.a, mine.record.id, 3))!;
    expect([v3.s3Key, v3.note, v3.savedByUserId]).toEqual([
      mine.versions[0]!.s3Key,
      'Restored version 1',
      w.users.staffA,
    ]);
    const noted = await svc.restore(w.a, owner, mine.record.id, 2, { note: 'Fake note' });
    expect(noted.version).toBe(4);
    expect((await templates.version(w.a, mine.record.id, 4))?.note).toBe('Fake note');
    expect(w.audit.entries.map((e) => e.metadata)).toEqual([
      { restoredVersion: 1, version: 3 },
      { restoredVersion: 2, version: 4 },
    ]);
    expect(await refused(svc.restore(w.a, staff, mine.record.id, 9, {}))).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });

  it('answers 404 for another member’s PRIVATE or another firm’s, 403 to who may not change it', async () => {
    const requestId = await draft();
    const staff2: EsignActor = { userId: w.users.staffA2, role: 'STAFF' };
    const manager: EsignActor = { userId: w.users.managerA, role: 'MANAGER' };
    const viewer: EsignActor = { userId: w.users.staffA, role: 'VIEWER' };
    const firmTemplate = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const other = await seedTemplate(w.b, templates, w.store, w.users.ownerB);
    const cases: [Promise<unknown>, string][] = [
      [svc.list(w.a, staff2, mine.record.id), '404 NOT_FOUND'],
      [svc.list(w.a, manager, mine.record.id), '404 NOT_FOUND'],
      [svc.list(w.a, owner, other.record.id), '404 NOT_FOUND'],
      [svc.restore(w.a, staff2, mine.record.id, 1, {}), '404 NOT_FOUND'],
      [svc.restore(w.a, owner, other.record.id, 1, {}), '404 NOT_FOUND'],
      [
        svc.saveAsVersion(w.a, owner, requestId, body({ templateId: other.record.id })),
        '404 NOT_FOUND',
      ],
      // The request is staff's (c1 is assigned to them): staff2 doesn't reach it.
      [svc.saveAsVersion(w.a, staff2, requestId, body()), '404 NOT_FOUND'],
      [svc.restore(w.a, staff, firmTemplate.record.id, 1, {}), '403 FORBIDDEN'],
      [svc.restore(w.a, viewer, mine.record.id, 1, {}), '403 FORBIDDEN'],
      [svc.saveAsVersion(w.a, viewer, requestId, body()), '403 FORBIDDEN'],
      [
        svc.saveAsVersion(w.a, staff, requestId, body({ templateId: firmTemplate.record.id })),
        '403 FORBIDDEN',
      ],
    ];
    for (const [work, answer] of cases) {
      const [status, code] = await refused(work);
      expect(`${status} ${code}`).toBe(answer);
    }
    // A Manager changes FIRM templates; Owner and Admin every one.
    expect((await svc.restore(w.a, manager, firmTemplate.record.id, 1, {})).version).toBe(2);
    expect((await svc.restore(w.a, owner, mine.record.id, 1, {})).version).toBe(2);
    expect((await templates.find(w.b, other.record.id))?.version).toBe(1);
  });
});
