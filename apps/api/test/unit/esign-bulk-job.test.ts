// R13 step 10, bulk send's job on the in-memory ports (esign-fakes.ts): each client's request made
// and sent (source BULK, the batch's template version, the client's only open service), per-client
// problems that never fail the batch, a refused client that gets nothing, retries that never make
// or send twice, the job lock, firm-by-firm runs and the maker's context on the audit rows.
// Synthetic data only.
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignBulkBatch, type EsignBulkSendBody } from '@firmivra/types';
import type { z } from 'zod';
import { requestContext } from '../../src/common/request-context.js';
import { EsignBulkJob, problemOf } from '../../src/esign/bulk/bulk.job.js';
import { EsignBulkService } from '../../src/esign/bulk/bulk.service.js';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignSendService } from '../../src/esign/requests/send.service.js';
import { EsignTemplateCopyService } from '../../src/esign/templates/template-copy.service.js';
import { EsignTemplateUseService } from '../../src/esign/templates/template-use.service.js';
import { EsignTemplatesService } from '../../src/esign/templates/templates.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  FakeNotify,
  fakePdf,
  InMemoryBulkRepository,
  InMemoryLifecycleRepository,
  InMemoryTemplateRepository,
  seedTemplate,
  type TemplateRow,
} from './esign-fakes.js';

type Body = z.output<typeof EsignBulkSendBody>;
let w: EsignWorld;
let templates: InMemoryTemplateRepository;
let bulk: InMemoryBulkRepository;
let lifecycle: InMemoryLifecycleRepository;
let notify: FakeNotify;
let uses: EsignTemplateUseService;
let sender: EsignSendService;
let svc: EsignBulkService;
let job: EsignBulkJob;
let owner: EsignActor;
let staff: EsignActor;
let t: TemplateRow;

beforeEach(async () => {
  w = esignWorld();
  templates = new InMemoryTemplateRepository(w.repo);
  bulk = new InMemoryBulkRepository();
  lifecycle = new InMemoryLifecycleRepository(w.repo);
  lifecycle.firmIds.push(w.a, w.b);
  notify = new FakeNotify();
  const { repo, directory, store, audit } = w;
  const requests = new EsignRequestsService(repo, directory, w.modules, store, audit, fakeHasher);
  const access = new EsignTemplatesService(templates, directory, store, audit);
  const copies = new EsignTemplateCopyService(
    requests,
    access,
    templates,
    repo,
    fakePdf,
    store,
    audit,
  );
  uses = new EsignTemplateUseService(
    requests,
    access,
    copies,
    templates,
    directory,
    store,
    fakeHasher,
    audit,
  );
  const prepare = new EsignPrepareService(requests, repo, directory, esignRules, audit);
  sender = new EsignSendService(
    requests,
    prepare,
    repo,
    directory,
    esignRules,
    fakePdf,
    store,
    new RandomLinkTokens(),
    notify,
    audit,
    { PORTAL_BASE_URL: 'https://portal.example.test' },
  );
  svc = new EsignBulkService(bulk, access, requests, directory, audit);
  job = new EsignBulkJob(bulk, lifecycle, repo, directory, uses, sender);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
});
afterEach(() => vi.restoreAllMocks());

const body = (clients: Body['clients'], extra: Partial<Body> = {}): Body => ({
  clients,
  roles: [],
  confirm: true,
  ...extra,
});
const requestsOf = async (businessId: string) =>
  w.repo.listRequests(businessId, { visibleTo: null }, { after: null, limit: 1000 });
const rows = (b: EsignBulkBatch) => b.items.map((i) => [i.clientName, i.state, i.problem]);
const run = () => job.run({ businessIds: [w.a] });

describe('the bulk job', () => {
  it('makes nothing for a client refused when the batch was made', async () => {
    const list = [w.ids.c1, w.ids.archived, w.ids.c2];
    const b = await svc.send(w.a, staff, t.record.id, body(list.map((clientId) => ({ clientId }))));
    await run();
    expect((await requestsOf(w.a)).map((r) => r.record.clientId)).toEqual([w.ids.c1]);
    expect(await requestsOf(w.b)).toEqual([]);
    expect(rows(await svc.get(w.a, staff, b.id)).slice(1)).toEqual([
      ['Fake Archived', 'NOT_SENT', 'NO_CLIENT'],
      ['Client', 'NOT_SENT', 'NO_CLIENT'],
    ]);
  });

  it('makes and sends each client’s request (source BULK, the only open service)', async () => {
    const b = await svc.send(
      w.a,
      owner,
      t.record.id,
      body([{ clientId: w.ids.c1, engagementId: w.ids.e1 }, { clientId: w.ids.c2 }], {
        title: 'Fake bulk letter',
      }),
    );
    expect(await run()).toEqual({ skipped: false, processed: 2 });
    const done = EsignBulkBatch.parse(await svc.get(w.a, owner, b.id));
    expect(done.done).toBe(true);
    expect(rows(done)).toEqual([
      ['Fake Client One', 'SENT', null],
      ['Fake Client Two', 'SENT', null],
    ]);
    for (const [i, item] of done.items.entries()) {
      const r = await w.repo.findRequest(w.a, item.requestId!);
      expect(r).toMatchObject({
        status: 'SENT',
        source: 'BULK',
        title: 'Fake bulk letter',
        clientId: [w.ids.c1, w.ids.c2][i],
        engagementId: [w.ids.e1, w.ids.e2][i],
        senderUserId: w.users.ownerA,
        template: { id: t.record.id, version: 1 },
      });
    }
    // One request per client: each has its own signers.
    expect(notify.sent.length).toBe(2);
    expect(w.audit.entries.map((e) => [e.action, e.entity.type])).toEqual([
      ['esign.bulk_created', 'esign_bulk_batch'],
      ['esign.request_created', 'esign_request'],
      ['esign.request_sent', 'esign_request'],
      ['esign.request_created', 'esign_request'],
      ['esign.request_sent', 'esign_request'],
      ['esign.bulk_viewed', 'esign_bulk_batch'],
    ]);
    expect(JSON.stringify(w.audit.entries)).not.toMatch(/Fake Client|@client\.test|#t=/);
  });

  it('records each client’s problem and goes on: the DRAFT stays where one was made', async () => {
    w.directory.contacts.of(w.a).delete(w.ids.c2); // no client values: MERGE_MISSING
    t.versions[0]!.roles.push({
      ...t.versions[0]!.roles[0]!,
      key: 'spouse',
      role: 'SPOUSE',
      colorIndex: 3,
    });
    templates.insert(w.a, t);
    // c1: two open services and none given (NO_ENGAGEMENT); c2: no SPOUSE login.
    const b = await svc.send(
      w.a,
      owner,
      t.record.id,
      body([{ clientId: w.ids.c1 }, { clientId: w.ids.c2 }]),
    );
    await run();
    const got = await svc.get(w.a, owner, b.id);
    expect(rows(got)).toEqual([
      ['Fake Client One', 'NOT_SENT', 'NO_ENGAGEMENT'],
      ['Fake Client Two', 'NOT_SENT', 'TEMPLATE_ROLES_UNFILLED'],
    ]);
    expect(got.done).toBe(true);
    expect((await w.repo.findRequest(w.a, got.items[0]!.requestId!))?.status).toBe('DRAFT');
    expect(got.items[1]!.requestId).toBeNull();
    expect((await requestsOf(w.a)).length).toBe(1);
  });

  it('names a merge value the client lacks (MERGE_MISSING)', async () => {
    w.directory.contacts.of(w.a).delete(w.ids.c2);
    const b = await svc.send(w.a, owner, t.record.id, body([{ clientId: w.ids.c2 }]));
    await run();
    expect(rows(await svc.get(w.a, owner, b.id))).toEqual([
      ['Fake Client Two', 'NOT_SENT', 'MERGE_MISSING'],
    ]);
  });

  it('copies the batch’s version even when a newer one is saved before the run', async () => {
    const b = await svc.send(w.a, owner, t.record.id, body([{ clientId: w.ids.c2 }]));
    const v2 = {
      ...t.versions[0]!,
      note: 'Fake v2',
      savedByUserId: w.users.ownerA,
    };
    await templates.addVersion(w.a, t.record.id, v2, t.record.updatedAt);
    await run();
    const { items } = await svc.get(w.a, owner, b.id);
    const r = await w.repo.findRequest(w.a, items[0]!.requestId!);
    expect(r?.template).toEqual({ id: t.record.id, version: 1 });
  });

  it('never makes or sends twice: a DRAFT already made is found, a sent one counts as SENT', async () => {
    const b = await svc.send(
      w.a,
      owner,
      t.record.id,
      body([{ clientId: w.ids.c2 }, { clientId: w.ids.c1, engagementId: w.ids.e1 }]),
    );
    const stored = (await bulk.find(w.a, b.id))!;
    // A run that stopped after making row 0's DRAFT, and after sending row 1's.
    const body0 = { clientId: w.ids.c2, engagementId: w.ids.e2, roles: [] };
    await uses.use(w.a, owner, t.record.id, body0, {
      id: stored.items[0]!.requestId,
      source: 'BULK',
    });
    const body1 = { clientId: w.ids.c1, engagementId: w.ids.e1, roles: [] };
    await uses.use(w.a, owner, t.record.id, body1, {
      id: stored.items[1]!.requestId,
      source: 'BULK',
    });
    await sender.send(w.a, owner, stored.items[1]!.requestId);
    const sends = vi.spyOn(sender, 'send');
    await run();
    expect(sends.mock.calls.map((c) => c[2])).toEqual([stored.items[0]!.requestId]);
    expect(rows(await svc.get(w.a, owner, b.id)).map((r) => r[1])).toEqual(['SENT', 'SENT']);
    expect((await requestsOf(w.a)).length).toBe(2);
    expect(notify.sent.length).toBe(2);
    // Another run finds nothing QUEUED.
    expect(await run()).toEqual({ skipped: false, processed: 0 });
  });

  it('tries a failing row again, at most 3 times, logging ids only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(sender, 'send').mockRejectedValue(new TypeError('Fake Client Two secret'));
    const b = await svc.send(w.a, owner, t.record.id, body([{ clientId: w.ids.c2 }]));
    await run();
    await run();
    expect((await bulk.find(w.a, b.id))!.items[0]).toMatchObject({
      state: 'QUEUED',
      attempts: 2,
      created: true,
    });
    await run();
    expect(rows(await svc.get(w.a, owner, b.id))).toEqual([
      ['Fake Client Two', 'NOT_SENT', 'NOT_READY'],
    ]);
    expect((await requestsOf(w.a)).length).toBe(1);
    expect(warn.mock.calls.join(' ')).toContain('(TypeError)');
    expect(warn.mock.calls.join(' ')).not.toContain('secret');
  });

  it('sends nothing for a maker who left the firm (NOT_A_MEMBER)', async () => {
    const b = await svc.send(
      w.a,
      staff,
      t.record.id,
      body([{ clientId: w.ids.c1, engagementId: w.ids.e1 }]),
    );
    w.directory.people.of(w.a).get(w.users.staffA)!.active = false;
    await run();
    expect(rows(await svc.get(w.a, owner, b.id))).toEqual([
      ['Fake Client One', 'NOT_SENT', 'NOT_A_MEMBER'],
    ]);
    expect(await requestsOf(w.a)).toEqual([]);
  });

  it('writes the audit rows in the firm and in the maker’s name', async () => {
    const seen: unknown[] = [];
    const log = w.audit.log.bind(w.audit);
    vi.spyOn(w.audit, 'log').mockImplementation((...args) => {
      const store = requestContext.getStore();
      seen.push([args[0], store?.tenant?.businessId, store?.auth?.userId]);
      return log(...args);
    });
    await svc.send(w.a, staff, t.record.id, body([{ clientId: w.ids.c1, engagementId: w.ids.e1 }]));
    await run();
    expect(seen.slice(1)).toEqual([
      ['esign.request_created', w.a, w.users.staffA],
      ['esign.request_sent', w.a, w.users.staffA],
    ]);
  });

  it('does nothing while another task holds the lock, and works firm by firm', async () => {
    const b = await svc.send(w.a, owner, t.record.id, body([{ clientId: w.ids.c2 }]));
    bulk.lockedElsewhere = true;
    expect(await run()).toEqual({ skipped: true });
    bulk.lockedElsewhere = false;
    expect(await job.run({ businessIds: [w.b] })).toEqual({
      skipped: false,
      processed: 0,
    });
    expect((await svc.get(w.a, owner, b.id)).done).toBe(false);
    expect(await job.run()).toEqual({ skipped: false, processed: 1 }); // every firm with Firm Sign
    expect((await svc.get(w.a, owner, b.id)).done).toBe(true);
  });
});

describe('problemOf', () => {
  it('takes NOT_READY’s first readiness problem, a Firm Sign code, else the fallback', () => {
    const notReady = new ConflictException({
      code: 'NOT_READY',
      details: [{ code: 'NO_SIGNERS' }],
    });
    expect(problemOf(notReady, 'NOT_READY')).toBe('NO_SIGNERS');
    expect(problemOf(new ConflictException({ code: 'NOT_READY', details: [] }), 'NO_CLIENT')).toBe(
      'NOT_READY',
    );
    expect(problemOf(new ConflictException({ code: 'ENGAGEMENT_MISMATCH' }), 'NO_CLIENT')).toBe(
      'ENGAGEMENT_MISMATCH',
    );
    expect(problemOf(new NotFoundException({ code: 'NOT_FOUND' }), 'NO_CLIENT')).toBe('NO_CLIENT');
  });
});
