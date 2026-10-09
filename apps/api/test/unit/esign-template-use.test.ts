// R13 step 9, requests from templates: `use` on the in-memory ports (esign-fakes.ts). The roles
// that fill themselves, the fills (who, delivery, access codes kept only as hashes), every check
// before anything is written (a 400 or 409 leaves no DRAFT and no file: no orphan), the copied
// packet, the access rules, the 404s across firms and the audit (ids only). Synthetic data only.
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignRequestDetail } from '@firmivra/types';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignTemplateCopyService } from '../../src/esign/templates/template-copy.service.js';
import { EsignTemplateUseService } from '../../src/esign/templates/template-use.service.js';
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
let uses: EsignTemplateUseService;
let owner: EsignActor;
let staff: EsignActor;

beforeEach(() => {
  w = esignWorld();
  templates = new InMemoryTemplateRepository(w.repo);
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
  const { directory, store, audit } = w;
  uses = new EsignTemplateUseService(
    requests,
    access,
    svc,
    templates,
    directory,
    store,
    fakeHasher,
    audit,
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
const allRequests = async () =>
  (await w.repo.listRequests(w.a, { visibleTo: null }, { after: null, limit: 1000 })).length;

describe('use a template', () => {
  it('makes a DRAFT: CLIENT from the primary login, PREPARER the caller, the packet copied', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const r = EsignRequestDetail.parse(
      await uses.use(w.a, staff, t.record.id, {
        clientId: w.ids.c1,
        engagementId: w.ids.e1,
        roles: [],
      }),
    );
    expect(r).toMatchObject({
      status: 'DRAFT',
      source: 'TEMPLATE',
      title: t.record.name,
      client: { id: w.ids.c1 },
      engagement: { id: w.ids.e1 },
      sender: { userId: w.users.staffA },
      template: { id: t.record.id, version: 1 },
    });
    expect(r.recipients.map((x) => [x.role, x.link, x.colorIndex, x.status])).toEqual([
      ['CLIENT', { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary }, 0, 'WAITING'],
      ['PREPARER', { type: 'STAFF', userId: w.users.staffA }, 1, 'WAITING'],
    ]);
    const [doc] = r.documents;
    expect(doc).toMatchObject({ pageCount: 2, scanStatus: 'CLEAN', sourceDocumentId: null });
    expect(r.pagePlan.map((p) => [p.documentId, p.page])).toEqual([
      [doc!.id, 0],
      [doc!.id, 1],
    ]);
    expect(r.fields.map((f) => [f.recipientId, f.mergeKey])).toEqual([
      [r.recipients[0]!.id, null],
      [r.recipients[1]!.id, null],
      [null, 'CLIENT_FULL_NAME'],
    ]);
    const { s3Key } = (await w.repo.parts(w.a, r.id)).documents[0]!;
    expect(s3Key).toBe(`tenant/${w.a}/esign/${r.id}/source/${doc!.id}`);
    expect(Buffer.from((await w.store.read(w.a, s3Key))!).toString()).toBe('pdf:2');
    expect((await w.repo.events(w.a, r.id)).map((e) => e.type)).toEqual(['CREATED']);
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.request_created',
        entity: { type: 'esign_request', id: r.id },
        metadata: {
          clientId: w.ids.c1,
          engagementId: w.ids.e1,
          source: 'TEMPLATE',
          templateId: t.record.id,
          templateVersion: 1,
        },
      },
    ]);
    // The template itself never changes.
    expect(await templates.find(w.a, t.record.id)).toEqual(t.record);
  });

  it('takes fills: who, delivery and an access code (stored only as its hash)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const r = await uses.use(w.a, owner, t.record.id, {
      clientId: w.ids.c2,
      title: 'Fake title',
      roles: [
        {
          key: 'preparer',
          who: { type: 'EXTERNAL', name: 'Fake Outside', email: 'outside@example.test' },
          authMethod: 'ACCESS_CODE',
          accessCode: 'FAKE1234',
        },
      ],
    });
    expect(r.title).toBe('Fake title');
    expect(r.recipients.map((x) => [x.name, x.authMethod, x.hasAccessCode])).toEqual([
      ['Fake primary', 'EMAIL_CODE', false],
      ['Fake Outside', 'ACCESS_CODE', true],
    ]);
    expect(JSON.stringify(w.audit.entries)).not.toContain('FAKE1234');
  });

  it('refuses before anything is written, leaving no DRAFT and no file (no orphan)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const approverRole = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    templates.rows.of(w.a).get(approverRole.record.id)!.versions[0]!.roles.push({
      key: 'approver',
      kind: 'APPROVER',
      role: 'MANAGER',
      roleLabel: null,
      routingOrder: 1,
      authMethod: 'EMAIL_CODE',
      colorIndex: 2,
    });
    const coded = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    templates.rows.of(w.a).get(coded.record.id)!.versions[0]!.roles[0]!.authMethod = 'ACCESS_CODE';
    const staffWho = (userId: string) => ({ type: 'STAFF' as const, userId });
    const cases: [string, Parameters<EsignTemplateUseService['use']>[3], string][] = [
      // No client: CLIENT can't fill itself.
      [t.record.id, { roles: [] }, '409 TEMPLATE_ROLES_UNFILLED'],
      [coded.record.id, { clientId: w.ids.c1, roles: [] }, '409 TEMPLATE_ROLES_UNFILLED'],
      [t.record.id, { clientId: w.ids.c1, roles: [{ key: 'nope' }] }, '400 VALIDATION_FAILED'],
      [
        t.record.id,
        {
          clientId: w.ids.c1,
          roles: [{ key: 'preparer', who: staffWho(w.users.staffA), delivery: 'PORTAL' }],
        },
        '400 VALIDATION_FAILED',
      ],
      [
        t.record.id,
        {
          clientId: w.ids.c1,
          roles: [
            { key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.disabled } },
          ],
        },
        '409 LOGIN_NOT_ACTIVE',
      ],
      [
        t.record.id,
        { clientId: w.ids.c1, roles: [{ key: 'preparer', who: staffWho(w.users.goneA) }] },
        '409 NOT_A_MEMBER',
      ],
      [
        approverRole.record.id,
        { clientId: w.ids.c1, roles: [{ key: 'approver', who: staffWho(w.users.staffA2) }] },
        '409 APPROVER_NOT_ALLOWED',
      ],
      [
        approverRole.record.id,
        { clientId: w.ids.c1, roles: [{ key: 'approver', who: staffWho(w.users.ownerA) }] },
        '409 APPROVER_NOT_ALLOWED', // the sender (owner) can't approve their own request
      ],
      [
        t.record.id,
        { clientId: w.ids.c1, engagementId: w.ids.e2, roles: [] },
        '409 ENGAGEMENT_MISMATCH',
      ],
      [t.record.id, { clientId: w.ids.archived, roles: [] }, '404 NOT_FOUND'],
      [t.record.id, { clientId: w.ids.cB, roles: [] }, '404 NOT_FOUND'],
    ];
    const before = await allRequests();
    const objects = w.store.objects.size;
    for (const [templateId, body, answer] of cases) {
      const [status, code] = await refused(uses.use(w.a, owner, templateId, body));
      expect(`${status} ${code}`).toBe(answer);
    }
    expect(await allRequests()).toBe(before);
    expect(w.store.objects.size).toBe(objects);
    expect(w.audit.entries).toEqual([]);
  });

  it('names every role still open', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    try {
      await uses.use(w.a, owner, t.record.id, { roles: [] });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'TEMPLATE_ROLES_UNFILLED',
        details: [{ path: 'roles.client' }],
      });
    }
  });

  it('removes the copied file when the write fails', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(templates, 'createDraft').mockRejectedValue(new Error('fake database down'));
    const objects = w.store.objects.size;
    await expect(
      uses.use(w.a, owner, t.record.id, { clientId: w.ids.c1, roles: [] }),
    ).rejects.toThrow('fake database down');
    expect(w.store.objects.size).toBe(objects);
  });

  it('refuses archived (409), another member’s PRIVATE or another firm’s (404), a Viewer (403)', async () => {
    const archived = await seedTemplate(w.a, templates, w.store, w.users.ownerA, {
      archivedAt: new Date(),
    });
    const theirs = await seedTemplate(w.a, templates, w.store, w.users.staffA2, {
      visibility: 'PRIVATE',
    });
    const other = await seedTemplate(w.b, templates, w.store, w.users.ownerB);
    const mine = await seedTemplate(w.a, templates, w.store, w.users.staffA);
    const body = { clientId: w.ids.c1, roles: [] };
    const viewer: EsignActor = { userId: w.users.staffA, role: 'VIEWER' };
    for (const [who, id, answer] of [
      [owner, archived.record.id, '409 TEMPLATE_ARCHIVED'],
      [staff, theirs.record.id, '404 NOT_FOUND'],
      [owner, other.record.id, '404 NOT_FOUND'],
      [viewer, mine.record.id, '403 FORBIDDEN'],
    ] as const) {
      const [status, code] = await refused(uses.use(w.a, who, id, body));
      expect(`${status} ${code}`).toBe(answer);
    }
    // Staff may not use it for a client they don't reach.
    const staff2: EsignActor = { userId: w.users.staffA2, role: 'STAFF' };
    expect(await refused(uses.use(w.a, staff2, mine.record.id, body))).toEqual([404, 'NOT_FOUND']);
  });

  it('refuses a packet that is not the saved one (409 FILE_BLOCKED)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    await w.store.put(w.a, t.versions[0]!.s3Key, new Uint8Array([1]), 'application/pdf');
    const res = uses.use(w.a, owner, t.record.id, { clientId: w.ids.c1, roles: [] });
    expect(await refused(res)).toEqual([409, 'FILE_BLOCKED']);
  });
});
