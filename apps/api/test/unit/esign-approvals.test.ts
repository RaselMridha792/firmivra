// R13 extras (contract 3), approvals on the in-memory ports (esign-fakes.ts) with R18's rules:
// submit-for-approval (only APPROVAL_PENDING left; approvers emailed through the outbox), each
// approver's decision (the last one sends it in the sender's name; a failed send leaves the
// approvals standing and tells the sender), a rejection back to DRAFT with its note kept for staff
// only, who reaches it (an approver only to decide), and the approver picker. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignApprovalBody, type EsignField } from '@firmivra/types';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EsignApprovalsService } from '../../src/esign/extras/approvals.service.js';
import { EsignLifecycleService } from '../../src/esign/lifecycle/lifecycle.service.js';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
} from '../../src/esign/requests/esign.repository.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { EsignSendService } from '../../src/esign/requests/send.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  FakeNotify,
  fakePdf,
  InMemoryExtrasRepository,
  InMemoryLifecycleRepository,
  sentRecipient,
} from './esign-fakes.js';

const APP = 'https://app.example.test';
const PORTAL = 'https://portal.example.test';

let w: EsignWorld;
let notify: FakeNotify;
let extras: InMemoryExtrasRepository;
let requests: EsignRequestsService;
let svc: EsignApprovalsService;
const as = (userId: string, role: EsignActor['role']): EsignActor => ({ userId, role });
let owner: EsignActor;
let admin: EsignActor;
let manager: EsignActor;

beforeEach(() => {
  w = esignWorld();
  notify = new FakeNotify();
  extras = new InMemoryExtrasRepository(w.repo);
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  const prepare = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
  const tokens = new RandomLinkTokens();
  const env = { PORTAL_BASE_URL: PORTAL, APP_BASE_URL: APP };
  const send = new EsignSendService(
    requests,
    prepare,
    w.repo,
    w.directory,
    esignRules,
    fakePdf,
    w.store,
    tokens,
    notify,
    w.audit,
    env,
  );
  const lifecycle = new EsignLifecycleService(
    requests,
    w.repo,
    new InMemoryLifecycleRepository(w.repo),
    w.directory,
    w.store,
    tokens,
    notify,
    w.audit,
    env,
  );
  svc = new EsignApprovalsService(
    requests,
    prepare,
    send,
    lifecycle,
    w.repo,
    extras,
    w.directory,
    w.audit,
    env,
  );
  owner = as(w.users.ownerA, 'OWNER');
  admin = as(w.users.adminA, 'ADMIN');
  manager = as(w.users.managerA, 'MANAGER');
});

async function refused(work: Promise<unknown>): Promise<[number, string, unknown?]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code: string; details?: unknown };
    return body.details === undefined
      ? [error.getStatus(), body.code]
      : [error.getStatus(), body.code, body.details];
  }
  throw new Error('expected a refusal');
}

const approver = (userId: string, name: string): EsignRecipientRecord =>
  sentRecipient(w, {
    kind: 'APPROVER',
    role: 'MANAGER',
    name,
    email: `${name}@firm.test`,
    link: { type: 'STAFF', userId },
    status: 'WAITING',
    sentAt: null,
  });
const sign = (recipientId: string): EsignField => ({
  id: randomUUID(),
  recipientId,
  type: 'SIGNATURE',
  pageIndex: 0,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.05,
  required: true,
  label: null,
  mergeKey: null,
  options: [],
  groupKey: null,
  value: null,
  filled: false,
});

/** A DRAFT for c1 (assigned to staffA) sent by the Owner, ready but for its two approvers. */
async function draft(approvers = [approver(w.users.managerA, 'manager-a')]) {
  const { id } = await requests.create(w.a, owner, {
    title: 'Engagement letter 2025',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c1,
    engagementId: w.ids.e1,
  });
  const documentId = randomUUID();
  const key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, key, new TextEncoder().encode('pdf:1'), 'application/pdf');
  const file: EsignDocumentRecord = {
    id: documentId,
    position: 0,
    fileName: 'letter.pdf',
    contentType: 'application/pdf',
    sizeBytes: 5,
    pageCount: 1,
    pageSizes: [{ width: 612, height: 792 }],
    sourceDocumentId: null,
    scanStatus: 'CLEAN',
    createdAt: new Date(),
    s3Key: key,
    sha256: '0'.repeat(64),
  };
  const signer = sentRecipient(w, { status: 'WAITING', sentAt: null });
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [file];
    row.parts.pagePlan = [{ documentId, page: 0, rotation: 0 }];
    row.parts.recipients = [signer, ...approvers];
    row.parts.fields = [sign(signer.id)];
  });
  return { id, signer, approvers };
}
const two = () => [approver(w.users.managerA, 'manager-a'), approver(w.users.adminA, 'admin-a')];
const approve = { decision: 'APPROVE' as const };
const reject = { decision: 'REJECT' as const, note: 'Fake: fix the fee on page 1' };

describe('submit for approval', () => {
  it('moves the DRAFT to NEEDS_APPROVAL and emails each approver through the outbox', async () => {
    const { id, approvers } = await draft(two());
    const out = await svc.submit(w.a, owner, id);
    expect(out.status).toBe('NEEDS_APPROVAL');
    expect(out.recipients.filter((r) => r.kind === 'APPROVER').map((r) => r.status)).toEqual([
      'SENT',
      'SENT',
    ]);
    expect(notify.sent.map((m) => [m.template, m.to])).toEqual([
      ['esign.approval-requested', 'manager-a@firm.test'],
      ['esign.approval-requested', 'admin-a@firm.test'],
    ]);
    expect(notify.sent[0]!.data).toMatchObject({
      senderName: 'owner-a',
      link: `${APP}/firm-sign/requests/${id}`,
    });
    const outbox = [...w.repo.outbox.of(w.a).values()];
    expect(outbox.map((e) => [e.recipientId, e.status])).toEqual(
      approvers.map((a) => [a.id, 'SENT']),
    );
    expect((await w.repo.events(w.a, id)).map((e) => e.type)).toEqual(['APPROVAL_REQUESTED']);
    const audit = w.audit.entries.at(-1)!;
    expect(audit.action).toBe('esign.approval_requested');
    expect(audit.metadata).toEqual({
      clientId: w.ids.c1,
      recipientIds: approvers.map((a) => a.id),
      emailIds: [...w.repo.outbox.of(w.a).keys()],
    });
  });

  it('is NOT_READY with any other problem, or with no approval pending', async () => {
    const { id } = await draft();
    w.repo.seed(w.a, id, (row) => (row.parts.documents[0]!.scanStatus = 'PENDING'));
    const [status, code, details] = await refused(svc.submit(w.a, owner, id));
    expect([status, code]).toEqual([409, 'NOT_READY']);
    expect((details as { code: string }[]).map((p) => p.code).sort()).toEqual([
      'APPROVAL_PENDING',
      'SCAN_PENDING',
    ]);
    const plain = await draft([]);
    expect(await refused(svc.submit(w.a, owner, plain.id))).toEqual([409, 'NOT_READY', []]);
  });

  it('checks each approver again (409 APPROVER_NOT_ALLOWED) and refuses a sent request', async () => {
    const { id } = await draft();
    w.repo.roles.of(w.a).set(w.users.managerA, 'STAFF');
    expect(await refused(svc.submit(w.a, owner, id))).toEqual([409, 'APPROVER_NOT_ALLOWED']);
    w.repo.roles.of(w.a).set(w.users.managerA, 'MANAGER');
    await svc.submit(w.a, owner, id);
    expect(await refused(svc.submit(w.a, owner, id))).toEqual([409, 'INVALID_STATE']);
  });

  it('is a write: 404 across firms and for unassigned Staff, 403 for a Viewer', async () => {
    const { id } = await draft();
    expect(await refused(svc.submit(w.b, as(w.users.ownerB, 'OWNER'), id))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.submit(w.a, as(w.users.staffA2, 'STAFF'), id))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    // The approver reaches it only to decide.
    expect(await refused(svc.submit(w.a, manager, id))).toEqual([404, 'NOT_FOUND']);
    const viewer = as(w.users.staffA, 'VIEWER');
    expect(await refused(svc.submit(w.a, viewer, id))).toEqual([403, 'FORBIDDEN']);
  });

  it('answers 409 INVALID_STATE when the request changed in between', async () => {
    const { id } = await draft();
    vi.spyOn(extras, 'submitForApproval').mockResolvedValueOnce(null);
    expect(await refused(svc.submit(w.a, owner, id))).toEqual([409, 'INVALID_STATE']);
    expect(notify.sent).toEqual([]);
  });
});

describe('deciding', () => {
  it('waits for every approver; the last approval sends it in the sender’s name', async () => {
    const { id, signer } = await draft(two());
    await svc.submit(w.a, owner, id);
    notify.sent.length = 0;
    const first = await svc.decide(w.a, manager, id, approve);
    expect(first.status).toBe('NEEDS_APPROVAL');
    expect(first.nextAction.waitingOn).toEqual(['admin-a']);
    const sent = await svc.decide(w.a, admin, id, approve);
    expect(sent.status).toBe('SENT');
    expect(sent.recipients.find((r) => r.id === signer.id)!.status).toBe('SENT');
    expect(sent.recipients.filter((r) => r.kind === 'APPROVER').map((r) => r.status)).toEqual([
      'APPROVED',
      'APPROVED',
    ]);
    expect(notify.sent.map((m) => [m.template, m.to])).toEqual([['esign.request', signer.email]]);
    const types = (await w.repo.events(w.a, id)).map((e) => [e.type, e.actorName]);
    expect(types).toEqual([
      ['APPROVAL_REQUESTED', 'owner-a'],
      ['APPROVED', 'manager-a'],
      ['APPROVED', 'admin-a'],
      ['SENT', 'owner-a'],
    ]);
    const decided = w.audit.entries.filter((e) => e.action === 'esign.approval_decided');
    expect(decided.map((e) => e.metadata)).toEqual([
      { clientId: w.ids.c1, recipientId: expect.any(String), decision: 'APPROVE', emailIds: [] },
      { clientId: w.ids.c1, recipientId: expect.any(String), decision: 'APPROVE', emailIds: [] },
    ]);
  });

  it('a rejection needs a note, puts it back to DRAFT and tells the sender (no note)', async () => {
    expect(EsignApprovalBody.safeParse({ decision: 'REJECT' }).success).toBe(false);
    const { id } = await draft(two());
    await svc.submit(w.a, owner, id);
    await svc.decide(w.a, manager, id, approve);
    notify.sent.length = 0;
    const out = await svc.decide(w.a, admin, id, reject);
    expect(out.status).toBe('DRAFT');
    expect(out.recipients.filter((r) => r.kind === 'APPROVER').map((r) => r.status)).toEqual([
      'WAITING',
      'WAITING',
    ]);
    expect(out.approvalNotes.map((n) => [n.decision, n.note])).toEqual([
      ['APPROVE', ''],
      ['REJECT', reject.note],
    ]);
    expect(notify.sent).toHaveLength(1);
    expect(notify.sent[0]).toMatchObject({
      template: 'esign.staff-update',
      to: 'owner-a@firm.test',
      data: { event: 'APPROVAL_REJECTED', signerName: 'admin-a' },
    });
    const words = JSON.stringify([notify.sent, w.audit.entries, await w.repo.events(w.a, id)]);
    expect(words).not.toContain('fix the fee');
    // A new round starts over.
    expect((await svc.submit(w.a, owner, id)).status).toBe('NEEDS_APPROVAL');
  });

  it('a failed send after the last approval keeps the approvals and tells the sender', async () => {
    const { id } = await draft();
    await svc.submit(w.a, owner, id);
    // A readiness problem that appeared since: the file is being checked again.
    w.repo.seed(w.a, id, (row) => (row.parts.documents[0]!.scanStatus = 'PENDING'));
    notify.sent.length = 0;
    const out = await svc.decide(w.a, manager, id, approve);
    expect(out.status).toBe('DRAFT');
    expect(out.recipients.find((r) => r.kind === 'APPROVER')!.status).toBe('APPROVED');
    expect(notify.sent.map((m) => [m.template, m.to, (m.data as { event: string }).event])).toEqual(
      [['esign.staff-update', 'owner-a@firm.test', 'APPROVED']],
    );
    expect(w.audit.entries.at(-1)!.action).toBe('esign.approval_send_failed');
    // Sending it again needs no new approval.
    w.repo.seed(w.a, id, (row) => (row.parts.documents[0]!.scanStatus = 'CLEAN'));
    const readiness = await refused(svc.submit(w.a, owner, id));
    expect(readiness).toEqual([409, 'NOT_READY', []]);
  });

  it('reaches an approver only to decide: Staff 404, a non-approver 403, other firms 404', async () => {
    const { id } = await draft();
    // Not before it is submitted.
    expect(await refused(svc.decide(w.a, manager, id, approve))).toEqual([409, 'INVALID_STATE']);
    await svc.submit(w.a, owner, id);
    const seen = await requests.get(w.a, manager, id);
    expect(seen.allowedActions).toEqual(['APPROVE']);
    expect(await refused(requests.update(w.a, manager, id, { title: 'x' }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.decide(w.a, as(w.users.staffA2, 'STAFF'), id, approve))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.decide(w.a, owner, id, approve))).toEqual([403, 'NOT_AN_APPROVER']);
    const ownerB = as(w.users.ownerB, 'OWNER');
    expect(await refused(svc.decide(w.b, ownerB, id, approve))).toEqual([404, 'NOT_FOUND']);
    // An approver whose role changed since may no longer decide.
    w.repo.roles.of(w.a).set(w.users.managerA, 'STAFF');
    expect(await refused(svc.decide(w.a, manager, id, approve))).toEqual([403, 'NOT_AN_APPROVER']);
    w.repo.roles.of(w.a).set(w.users.managerA, 'MANAGER');
    await svc.decide(w.a, manager, id, approve);
    expect(await refused(svc.decide(w.a, manager, id, approve))).toEqual([409, 'INVALID_STATE']);
  });

  it('answers RECIPIENT_DONE to an approver who already approved', async () => {
    const { id } = await draft(two());
    await svc.submit(w.a, owner, id);
    await svc.decide(w.a, manager, id, approve);
    expect(await refused(svc.decide(w.a, manager, id, approve))).toEqual([409, 'RECIPIENT_DONE']);
    vi.spyOn(extras, 'decideApproval').mockResolvedValueOnce(null);
    expect(await refused(svc.decide(w.a, admin, id, approve))).toEqual([409, 'INVALID_STATE']);
  });
});

describe('the approver picker', () => {
  it('lists active Owners, Admins and Managers but the caller; a Viewer gets 403', async () => {
    const names = async (actor: EsignActor) =>
      (await svc.approvers(w.a, actor)).items.map((i) => [i.user.name, i.esignRole]);
    expect(await names(owner)).toEqual([
      ['admin-a', 'ADMIN'],
      ['manager-a', 'MANAGER'],
    ]);
    expect(await names(as(w.users.staffA, 'STAFF'))).toEqual([
      ['admin-a', 'ADMIN'],
      ['manager-a', 'MANAGER'],
      ['owner-a', 'OWNER'],
    ]);
    expect(await refused(svc.approvers(w.a, as(w.users.staffA, 'VIEWER')))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    const b = await svc.approvers(w.b, as(w.users.ownerB, 'OWNER'));
    expect(b.items).toEqual([]);
  });
});
