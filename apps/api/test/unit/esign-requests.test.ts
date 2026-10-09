// R13 step 6, requests API part 1b: status and drafts on the in-memory ports (esign-fakes.ts):
// access (Owner and Admin all, Staff and Managers own or assigned), cross-firm and cross-client
// 404s, DRAFT only, and an audit of ids only; and the fakes themselves (each firm sees only its
// own rows, writes reach DRAFTs only). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignRequestDetail } from '@firmivra/types';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
  NewEsignRequest,
} from '../../src/esign/requests/esign.repository.js';
import { ESIGN_TEST_DEFAULTS, esignWorld, type EsignWorld } from './esign-fakes.js';

let w: EsignWorld;
let svc: EsignRequestsService;
let owner: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;

beforeEach(() => {
  w = esignWorld();
  svc = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  staff2 = { userId: w.users.staffA2, role: 'STAFF' };
});

/** The HTTP answer an error stands for: [status, code]. */
async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}

const draft = (actor: EsignActor = owner, clientId?: string, engagementId?: string) =>
  svc.create(w.a, actor, {
    title: 'Engagement letter 2025',
    source: clientId ? 'CLIENT_RECORD' : 'TAB',
    clientId,
    engagementId,
  });

const doc = (pageCount: number, position: number): EsignDocumentRecord => ({
  id: randomUUID(),
  position,
  fileName: `file-${position}.pdf`,
  contentType: 'application/pdf',
  sizeBytes: 1000,
  pageCount,
  pageSizes: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })),
  sourceDocumentId: null,
  scanStatus: 'CLEAN',
  createdAt: new Date(),
  s3Key: `tenant/${w.a}/esign/x/${position}`,
  sha256: '0'.repeat(64),
});

/** A recipient linked to a client login, as PUT recipients (part 1c) stores it. */
const loginRecipient = (clientAccountId: string): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name: 'Fake primary',
  email: 'primary@client.test',
  phone: null,
  link: { type: 'CLIENT_LOGIN', clientAccountId },
  delivery: 'EMAIL',
  authMethod: 'EMAIL_CODE',
  accessCodeHash: null,
  colorIndex: 0,
  status: 'WAITING',
  sentAt: null,
  viewedAt: null,
  signedAt: null,
  declinedAt: null,
  declineReason: null,
  lastRemindedAt: null,
  reminderCount: 0,
});

const input = (): NewEsignRequest => ({
  title: 'Engagement letter 2025',
  source: 'TAB',
  clientId: null,
  engagementId: null,
  senderUserId: w.users.ownerA,
  internalNote: null,
  emailSubject: null,
  emailMessage: ESIGN_TEST_DEFAULTS.emailMessage,
  routing: 'SEQUENTIAL',
  expiryDays: ESIGN_TEST_DEFAULTS.expiryDays,
  reminders: ESIGN_TEST_DEFAULTS.reminders,
  expiryWarningDays: ESIGN_TEST_DEFAULTS.expiryWarningDays,
});

describe('GET /esign/status', () => {
  it('says on with the caller’s role, and off (never an error) with no role', async () => {
    expect(await svc.status(w.a, owner)).toEqual({ enabled: true, myEsignRole: 'OWNER' });
    expect(await svc.status(w.a, staff)).toEqual({ enabled: true, myEsignRole: 'STAFF' });
    w.modules.set(w.a, 'esign', false);
    expect(await svc.status(w.a, owner)).toEqual({ enabled: false, myEsignRole: null });
    // One firm's switch is not another's.
    expect(await svc.status(w.b, { userId: w.users.ownerB, role: 'OWNER' })).toMatchObject({
      enabled: true,
    });
  });
});

describe('drafts', () => {
  it('creates a DRAFT sent by the caller with the firm’s defaults, matching the contract', async () => {
    const d = await draft(owner, w.ids.c1, w.ids.e1);
    expect(EsignRequestDetail.parse(d)).toEqual(d);
    expect(d).toMatchObject({
      status: 'DRAFT',
      source: 'CLIENT_RECORD',
      client: { id: w.ids.c1, displayName: 'Fake Client One' },
      engagement: { id: w.ids.e1 },
      sender: { userId: w.users.ownerA, name: 'owner-a' },
      expiryDays: 30,
      emailMessage: 'Please review and sign.',
      nextAction: { kind: 'FINISH_DRAFT', waitingOn: [] },
      allowedActions: ['EDIT', 'DISCARD', 'SEND'],
    });
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.request_created',
        entity: { type: 'esign_request', id: d.id },
        metadata: { clientId: w.ids.c1, engagementId: w.ids.e1, source: 'CLIENT_RECORD' },
      },
    ]);
    // A PENDING service is open too; a draft may start with no client.
    await draft(owner, w.ids.c1, w.ids.e1Pending);
    expect((await draft(staff2)).client).toBeNull();
  });

  it('refuses a client the caller may not see (404) and a service that is not open or not the client’s (409)', async () => {
    expect(await refused(draft(staff2, w.ids.c1))).toEqual([404, 'NOT_FOUND']);
    expect(await refused(draft(owner, w.ids.cB))).toEqual([404, 'NOT_FOUND']); // firm B's client
    expect(await refused(draft(owner, w.ids.archived))).toEqual([404, 'NOT_FOUND']);
    for (const e of [w.ids.e1Done, w.ids.e2, w.ids.eB, randomUUID()]) {
      expect(await refused(draft(owner, w.ids.c1, e))).toEqual([409, 'ENGAGEMENT_MISMATCH']);
    }
    const noClient = svc.create(w.a, owner, { title: 'x', source: 'TAB', engagementId: w.ids.e1 });
    expect(await refused(noClient)).toEqual([409, 'ENGAGEMENT_MISMATCH']);
    expect(w.audit.entries).toEqual([]);
  });

  it('lets Owner see everything, Staff their own and their clients’, and answers 404 otherwise', async () => {
    const forC1 = await draft(owner, w.ids.c1);
    const forC2 = await draft(owner, w.ids.c2);
    const staff2Own = await draft(staff2);
    expect((await svc.get(w.a, staff, forC1.id)).id).toBe(forC1.id); // assigned client
    expect((await svc.get(w.a, staff2, staff2Own.id)).id).toBe(staff2Own.id); // own request
    expect(await svc.get(w.a, owner, staff2Own.id)).toMatchObject({ id: staff2Own.id });
    // Cross-client: Staff not assigned to the client, and not the sender.
    expect(await refused(svc.get(w.a, staff2, forC1.id))).toEqual([404, 'NOT_FOUND']);
    expect(await refused(svc.get(w.a, staff, forC2.id))).toEqual([404, 'NOT_FOUND']);
    const manager: EsignActor = { userId: w.users.staffA2, role: 'MANAGER' };
    expect(await refused(svc.get(w.a, manager, forC1.id))).toEqual([404, 'NOT_FOUND']);
    expect((await svc.get(w.a, manager, staff2Own.id)).id).toBe(staff2Own.id);
    expect(await refused(draft(manager, w.ids.c2))).toEqual([404, 'NOT_FOUND']);
    // An approver reaches the request they approve, though its client is not assigned to them.
    w.repo.seed(w.a, forC2.id, (row) =>
      row.parts.recipients.push({
        ...loginRecipient(w.ids.c2Login),
        kind: 'APPROVER',
        role: 'MANAGER',
        link: { type: 'STAFF', userId: w.users.staffA2 },
      }),
    );
    const asApprover = await svc.get(w.a, manager, forC2.id);
    expect([asApprover.id, asApprover.allowedActions]).toEqual([forC2.id, []]);
    expect(await refused(svc.get(w.a, staff, forC2.id))).toEqual([404, 'NOT_FOUND']);
    // ...but never changes it: an approver's path is for reads and decisions only.
    expect(await refused(svc.update(w.a, manager, forC2.id, { title: 'x' }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.discard(w.a, manager, forC2.id))).toEqual([404, 'NOT_FOUND']);
    expect((await svc.get(w.a, owner, forC2.id)).allowedActions).toContain('EDIT');
    expect(await svc.status(w.a, manager)).toEqual({ enabled: true, myEsignRole: 'MANAGER' });
    expect(await refused(svc.update(w.a, staff2, forC1.id, { title: 'x' }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    // Cross-firm: firm B's owner with firm A's request id.
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    for (const work of [
      svc.get(w.b, ownerB, forC1.id),
      svc.update(w.b, ownerB, forC1.id, { title: 'x' }),
      svc.discard(w.b, ownerB, forC1.id),
    ]) {
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    expect((await svc.get(w.a, owner, forC1.id)).title).toBe('Engagement letter 2025');
  });

  it('updates a DRAFT: texts, settings, and a new client clears the service', async () => {
    const d = await draft(owner, w.ids.c1, w.ids.e1);
    const updated = await svc.update(w.a, owner, d.id, {
      title: 'Form 8879',
      internalNote: null,
      emailSubject: 'Please sign',
      routing: 'PARALLEL',
      expiryDays: 10,
      clientId: w.ids.c2,
    });
    expect(updated).toMatchObject({
      title: 'Form 8879',
      emailSubject: 'Please sign',
      routing: 'PARALLEL',
      expiryDays: 10,
      client: { id: w.ids.c2 },
      engagement: null,
    });
    const withService = await svc.update(w.a, owner, d.id, { engagementId: w.ids.e2 });
    expect(withService.engagement?.id).toBe(w.ids.e2);
    expect(await refused(svc.update(w.a, owner, d.id, { engagementId: w.ids.e1 }))).toEqual([
      409,
      'ENGAGEMENT_MISMATCH',
    ]);
    expect(w.audit.entries.at(1)).toMatchObject({
      action: 'esign.request_updated',
      metadata: {
        changed: expect.arrayContaining(['title', 'routing', 'clientId', 'engagementId']),
      },
    });
    // Staff can't move a request to a client they don't reach.
    const mine = await draft(staff, w.ids.c1);
    expect(await refused(svc.update(w.a, staff, mine.id, { clientId: w.ids.c2 }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });

  it('audits every view (ids only), but not the answer to a PATCH', async () => {
    const d = await draft(owner, w.ids.c1);
    await svc.get(w.a, owner, d.id);
    await svc.update(w.a, owner, d.id, { title: 'Form 8879' });
    expect(w.audit.entries.map((e) => [e.action, e.metadata])).toEqual([
      ['esign.request_created', expect.anything()],
      ['esign.request_viewed', { clientId: w.ids.c1 }],
      ['esign.request_updated', { changed: ['title'] }],
    ]);
  });

  it('skips an empty PATCH: no write, no audit', async () => {
    const d = await draft(owner, w.ids.c1);
    const before = (await w.repo.findRequest(w.a, d.id))?.lastActivityAt;
    expect((await svc.update(w.a, owner, d.id, { clientId: w.ids.c1 })).id).toBe(d.id);
    expect((await w.repo.findRequest(w.a, d.id))?.lastActivityAt).toEqual(before);
    expect(w.audit.entries.map((e) => e.action)).toEqual(['esign.request_created']);
  });

  it('answers a PATCH from the written record, though the caller loses the request by it', async () => {
    const d = await draft(owner, w.ids.c1);
    const cleared = await svc.update(w.a, staff, d.id, { clientId: null });
    expect(cleared.client).toBeNull();
    expect(w.audit.entries.at(-1)?.metadata).toEqual({
      changed: ['clientId', 'engagementId'],
      fromClientId: w.ids.c1,
      toClientId: null,
    });
    expect(await refused(svc.get(w.a, staff, d.id))).toEqual([404, 'NOT_FOUND']);
  });

  it('refuses a new client while the old client’s logins are recipients (409 RECIPIENTS_LINKED)', async () => {
    const d = await draft(owner, w.ids.c1);
    w.repo.seed(w.a, d.id, (row) => row.parts.recipients.push(loginRecipient(w.ids.primary)));
    expect(await refused(svc.update(w.a, owner, d.id, { clientId: null }))).toEqual([
      409,
      'RECIPIENTS_LINKED',
    ]);
    // The same client is not a change.
    await svc.update(w.a, owner, d.id, { clientId: w.ids.c1, title: 'Still c1' });
  });

  it('changes only DRAFTs (409 INVALID_STATE), also when a send wins the race', async () => {
    const d = await draft(owner, w.ids.c1);
    w.repo.loseNextWrite = true;
    expect(await refused(svc.update(w.a, owner, d.id, { title: 'x' }))).toEqual([
      409,
      'INVALID_STATE',
    ]);
    w.repo.seed(w.a, d.id, (row) => (row.record.status = 'SENT'));
    for (const work of [
      svc.update(w.a, owner, d.id, { title: 'x' }),
      svc.discard(w.a, owner, d.id),
    ]) {
      expect(await refused(work)).toEqual([409, 'INVALID_STATE']);
    }
    const sent = await svc.get(w.a, owner, d.id);
    expect(sent).toMatchObject({ status: 'SENT', title: 'Engagement letter 2025' });
    expect(sent.allowedActions).toEqual([]);
  });

  it('discards a DRAFT and deletes its stored files', async () => {
    const d = await draft(staff, w.ids.c1);
    const file = doc(2, 0);
    w.repo.seed(w.a, d.id, (row) => row.parts.documents.push(file));
    expect(await svc.discard(w.a, staff, d.id)).toEqual({ ok: true });
    expect(await refused(svc.get(w.a, owner, d.id))).toEqual([404, 'NOT_FOUND']);
    expect(w.store.removed).toEqual([{ businessId: w.a, key: file.s3Key }]);
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.request_discarded',
      entity: { type: 'esign_request', id: d.id },
      metadata: { documentIds: [file.id] },
    });
  });

  it('still deletes the files when the discard audit fails after the delete', async () => {
    const d = await draft(staff, w.ids.c1);
    const file = doc(2, 0);
    w.repo.seed(w.a, d.id, (row) => row.parts.documents.push(file));
    vi.spyOn(w.audit, 'log').mockRejectedValueOnce(new Error('audit down'));
    expect(await svc.discard(w.a, staff, d.id)).toEqual({ ok: true });
    expect(await refused(svc.get(w.a, owner, d.id))).toEqual([404, 'NOT_FOUND']);
    expect(w.store.removed).toEqual([{ businessId: w.a, key: file.s3Key }]);
  });
});

describe('the in-memory fakes', () => {
  it('keeps each firm’s requests to itself', async () => {
    const made = await w.repo.createRequest(w.a, input());
    expect(made).toMatchObject({ status: 'DRAFT', title: 'Engagement letter 2025' });
    expect(await w.repo.findRequest(w.a, made.id)).toEqual(made);
    expect(await w.repo.findRequest(w.b, made.id)).toBeNull();
    expect(await w.repo.updateDraft(w.b, made.id, { title: 'x' })).toBe('INVALID_STATE');
    expect(await w.repo.deleteDraft(w.b, made.id)).toBeNull();
    expect((await w.repo.parts(w.b, made.id)).documents).toEqual([]);
    expect((await w.repo.findRequest(w.a, made.id))?.title).toBe('Engagement letter 2025');
  });

  it('writes to DRAFTs only, and can lose one write to a send', async () => {
    const made = await w.repo.createRequest(w.a, input());
    expect(await w.repo.updateDraft(w.a, made.id, { title: 'Form 8879' })).toMatchObject({
      title: 'Form 8879',
    });
    w.repo.loseNextWrite = true;
    expect(await w.repo.updateDraft(w.a, made.id, { title: 'lost' })).toBe('INVALID_STATE');
    expect(w.repo.loseNextWrite).toBe(false);
    w.repo.seed(w.a, made.id, (row) => (row.record.status = 'SENT'));
    expect(await w.repo.savePagePlan(w.a, made.id, [], [])).toBe(false);
    expect(await w.repo.saveRecipients(w.a, made.id, [], [])).toBe(false);
    expect(await w.repo.deleteDraft(w.a, made.id)).toBeNull();
    expect(await w.repo.findRequest(w.a, made.id)).toMatchObject({
      status: 'SENT',
      title: 'Form 8879',
    });
    expect(await w.repo.updateDraft(w.a, randomUUID(), { title: 'x' })).toBe('INVALID_STATE');
  });

  it('answers the directory per firm', async () => {
    expect((await w.directory.client(w.a, w.ids.c1))?.displayName).toBe('Fake Client One');
    expect(await w.directory.client(w.b, w.ids.c1)).toBeNull();
    expect(await w.directory.engagement(w.b, w.ids.e1)).toBeNull();
    expect(await w.directory.clientLogin(w.b, w.ids.primary)).toBeNull();
    expect(await w.directory.member(w.b, w.users.ownerA)).toBeNull();
    expect((await w.directory.member(w.a, w.users.goneA))?.active).toBe(false);
  });
});
