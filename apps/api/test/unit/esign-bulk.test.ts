// R13 step 10, bulk send on the in-memory ports (esign-fakes.ts): the batch (one row per client,
// a client the caller can't reach a NOT_SENT row with nothing made for it), the checks made once
// for every client before anything is written, the batch's own access and the audit (ids only).
// The job that makes and sends the requests is esign-bulk-job.test.ts. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EsignBulkBatch, type EsignBulkSendBody } from '@firmivra/types';
import type { z } from 'zod';
import { EsignBulkService } from '../../src/esign/bulk/bulk.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignTemplatesService } from '../../src/esign/templates/templates.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  InMemoryBulkRepository,
  InMemoryTemplateRepository,
  seedTemplate,
  type TemplateRow,
} from './esign-fakes.js';

type Body = z.output<typeof EsignBulkSendBody>;
let w: EsignWorld;
let templates: InMemoryTemplateRepository;
let bulk: InMemoryBulkRepository;
let svc: EsignBulkService;
let owner: EsignActor;
let staff: EsignActor;
let t: TemplateRow;

beforeEach(async () => {
  w = esignWorld();
  templates = new InMemoryTemplateRepository(w.repo);
  bulk = new InMemoryBulkRepository();
  const { repo, directory, store, audit } = w;
  const requests = new EsignRequestsService(repo, directory, w.modules, store, audit, fakeHasher);
  const access = new EsignTemplatesService(templates, directory, store, audit);
  svc = new EsignBulkService(bulk, access, requests, directory, audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
});

const body = (clients: Body['clients'], extra: Partial<Body> = {}): Body => ({
  clients,
  roles: [],
  confirm: true,
  ...extra,
});
async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}
const requestsOf = async (businessId: string) =>
  w.repo.listRequests(businessId, { visibleTo: null }, { after: null, limit: 1000 });
const rows = (b: EsignBulkBatch) => b.items.map((i) => [i.clientName, i.state, i.problem]);

describe('POST bulk-send', () => {
  it('makes a batch of QUEUED rows and nothing else yet (202 is the controller’s)', async () => {
    const b = EsignBulkBatch.parse(
      await svc.send(w.a, owner, t.record.id, body([{ clientId: w.ids.c2 }])),
    );
    expect(b).toMatchObject({
      templateId: t.record.id,
      templateName: t.record.name,
      createdBy: { userId: w.users.ownerA, name: 'owner-a' },
      done: false,
    });
    expect(b.items).toEqual([
      {
        clientId: w.ids.c2,
        clientName: 'Fake Client Two',
        state: 'QUEUED',
        requestId: null,
        problem: null,
      },
    ]);
    expect(await requestsOf(w.a)).toEqual([]);
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.bulk_created',
        entity: { type: 'esign_bulk_batch', id: b.id },
        metadata: {
          templateId: t.record.id,
          templateVersion: 1,
          clientIds: [w.ids.c2],
          refused: 0,
        },
      },
    ]);
  });

  it('turns a client the caller can’t reach into a NOT_SENT row: no name, nothing made', async () => {
    const list = [w.ids.c1, w.ids.archived, w.ids.c2];
    const b = await svc.send(w.a, staff, t.record.id, body(list.map((clientId) => ({ clientId }))));
    // Staff reach only c1 (assigned to them); archived and c2 are refused. The archived one is
    // still theirs, so it keeps its name.
    expect(rows(b)).toEqual([
      ['Fake Client One', 'QUEUED', null],
      ['Fake Archived', 'NOT_SENT', 'NO_CLIENT'],
      ['Client', 'NOT_SENT', 'NO_CLIENT'],
    ]);
    expect(w.audit.entries[0]!.metadata).toMatchObject({ clientIds: [w.ids.c1], refused: 2 });
    expect(await requestsOf(w.a)).toEqual([]);
    expect(await requestsOf(w.b)).toEqual([]);
  });

  it('answers 404 for a client id that is not the firm’s (another firm’s or unknown)', async () => {
    for (const id of [w.ids.cB, randomUUID()]) {
      const work = svc.send(
        w.a,
        owner,
        t.record.id,
        body([{ clientId: w.ids.c1 }, { clientId: id }]),
      );
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    expect(bulk.batches.of(w.a).size).toBe(0);
    expect(w.audit.entries).toEqual([]);
  });

  it('answers 409 ENGAGEMENT_MISMATCH for a service that is not the client’s', async () => {
    const work = svc.send(
      w.a,
      owner,
      t.record.id,
      body([{ clientId: w.ids.c1, engagementId: w.ids.e2 }]),
    );
    expect(await refused(work)).toEqual([409, 'ENGAGEMENT_MISMATCH']);
    expect(bulk.batches.of(w.a).size).toBe(0);
  });

  it('refuses what holds for every client before writing anything', async () => {
    const one = body([{ clientId: w.ids.c2 }]);
    const viewer: EsignActor = { userId: w.users.staffA2, role: 'VIEWER' };
    const archived = await seedTemplate(w.a, templates, w.store, w.users.ownerA, {
      archivedAt: new Date(),
    });
    const other = await seedTemplate(w.b, templates, w.store, w.users.ownerB);
    const cases: [Promise<unknown>, number, string][] = [
      [svc.send(w.a, viewer, t.record.id, one), 403, 'FORBIDDEN'],
      [svc.send(w.a, owner, archived.record.id, one), 409, 'TEMPLATE_ARCHIVED'],
      [svc.send(w.a, owner, other.record.id, one), 404, 'NOT_FOUND'],
      [svc.send(w.a, owner, randomUUID(), one), 404, 'NOT_FOUND'],
      [
        svc.send(w.a, owner, t.record.id, { ...one, roles: [{ key: 'nope', delivery: 'EMAIL' }] }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        svc.send(w.a, owner, t.record.id, {
          ...one,
          roles: [{ key: 'preparer', who: { type: 'STAFF', userId: w.users.goneA } }],
        }),
        409,
        'NOT_A_MEMBER',
      ],
    ];
    for (const [work, status, code] of cases) expect(await refused(work)).toEqual([status, code]);
    expect(bulk.batches.of(w.a).size + bulk.batches.of(w.b).size).toBe(0);
    expect(w.audit.entries).toEqual([]);
  });

  it('needs every role filled, and never an access code (another check or IN_PERSON)', async () => {
    const v = t.versions[0]!;
    v.roles[0] = { ...v.roles[0]!, authMethod: 'ACCESS_CODE' };
    v.roles.push({ ...v.roles[1]!, key: 'witness', role: 'WITNESS', routingOrder: 3 });
    templates.insert(w.a, t);
    const one = (roles: Body['roles']) => body([{ clientId: w.ids.c2 }], { roles });
    const witness = {
      key: 'witness',
      who: { type: 'EXTERNAL' as const, name: 'Fake W', email: 'w@example.test' },
    };
    expect(await refused(svc.send(w.a, owner, t.record.id, one([witness])))).toEqual([
      409,
      'TEMPLATE_ROLES_UNFILLED',
    ]);
    const noWitness = one([{ key: 'client', authMethod: 'EMAIL_CODE' }]);
    expect(await refused(svc.send(w.a, owner, t.record.id, noWitness))).toEqual([
      409,
      'TEMPLATE_ROLES_UNFILLED',
    ]);
    expect(bulk.batches.of(w.a).size).toBe(0);
    for (const fill of [
      { authMethod: 'EMAIL_CODE' as const },
      { delivery: 'IN_PERSON' as const },
    ]) {
      const b = await svc.send(w.a, owner, t.record.id, one([witness, { key: 'client', ...fill }]));
      expect(b.items[0]!.state).toBe('QUEUED');
    }
  });

  it('checks an approver role once: never the sender (APPROVER_NOT_ALLOWED)', async () => {
    t.versions[0]!.roles.push({
      key: 'approver',
      kind: 'APPROVER',
      role: 'CUSTOM',
      roleLabel: 'Fake approver',
      routingOrder: 1,
      authMethod: 'EMAIL_CODE',
      colorIndex: 2,
    });
    templates.insert(w.a, t);
    const as = (userId: string) =>
      body([{ clientId: w.ids.c2 }], {
        roles: [{ key: 'approver', who: { type: 'STAFF', userId } }],
      });
    expect(await refused(svc.send(w.a, owner, t.record.id, as(w.users.ownerA)))).toEqual([
      409,
      'APPROVER_NOT_ALLOWED',
    ]);
    expect(await refused(svc.send(w.a, owner, t.record.id, as(w.users.staffA)))).toEqual([
      409,
      'APPROVER_NOT_ALLOWED',
    ]);
    expect((await svc.send(w.a, owner, t.record.id, as(w.users.adminA))).items[0]!.state).toBe(
      'QUEUED',
    );
  });
});

describe('GET /esign/bulk/{batchId}', () => {
  it('answers Owner and Admin and the maker; 404 to anyone else and across firms', async () => {
    const b = await svc.send(w.a, staff, t.record.id, body([{ clientId: w.ids.c1 }]));
    for (const who of [owner, staff, { userId: w.users.adminA, role: 'ADMIN' as const }]) {
      expect((await svc.get(w.a, who, b.id)).id).toBe(b.id);
    }
    const others: [string, EsignActor][] = [
      [w.a, { userId: w.users.staffA2, role: 'STAFF' }],
      [w.a, { userId: w.users.managerA, role: 'MANAGER' }],
      [w.b, { userId: w.users.ownerB, role: 'OWNER' }],
      [w.a, owner],
    ];
    for (const [i, [firm, who]] of others.entries()) {
      const id = i === 3 ? randomUUID() : b.id;
      expect(await refused(svc.get(firm, who, id))).toEqual([404, 'NOT_FOUND']);
    }
    expect(w.audit.entries.filter((e) => e.action === 'esign.bulk_viewed').length).toBe(3);
  });
});
