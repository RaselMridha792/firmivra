// R13 step 8, lifecycle: remind and void on the in-memory ports (esign-fakes.ts) with R18's link
// tokens: who is reminded and how often, fresh links stored only as hashes, the voided emails
// without the reason, the optimistic lock, the audit (ids only) and the access rules. Synthetic
// data only.
import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignField, EsignRequestStatus } from '@firmivra/types';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EsignLifecycleService } from '../../src/esign/lifecycle/lifecycle.service.js';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
} from '../../src/esign/requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import type { NotifyMessage } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  FakeNotify,
  InMemoryLifecycleRepository,
  sentRecipient as recipient,
} from './esign-fakes.js';

const PORTAL = 'https://portal.example.test';
const APP = 'https://app.example.test';
const HOUR = 3_600_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let w: EsignWorld;
let notify: FakeNotify;
let lc: InMemoryLifecycleRepository;
let requests: EsignRequestsService;
let svc: EsignLifecycleService;
let owner: EsignActor;

beforeEach(() => {
  w = esignWorld();
  notify = new FakeNotify();
  lc = new InMemoryLifecycleRepository(w.repo);
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  svc = new EsignLifecycleService(
    requests,
    w.repo,
    lc,
    w.directory,
    new RandomLinkTokens(),
    notify,
    w.audit,
    { PORTAL_BASE_URL: `${PORTAL}/`, APP_BASE_URL: APP },
  );
  owner = { userId: w.users.ownerA, role: 'OWNER' };
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

const outside = (extra: Partial<EsignRecipientRecord> = {}) =>
  recipient(w, {
    name: 'Fake outside',
    email: 'outside@example.test',
    link: { type: 'EXTERNAL' },
    ...extra,
  });

/**
 * A request for c1 (assigned to staff), sent 4 days ago with these recipients, a stored 1-page
 * file and a field per signer; `status` SENT unless given.
 */
async function sentRequest(
  recipients: EsignRecipientRecord[] = [recipient(w)],
  status: EsignRequestStatus = 'SENT',
) {
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
  const sentAt = new Date(Date.now() - 4 * 86_400_000);
  const fields = recipients
    .filter((r) => r.kind === 'SIGNER')
    .map((r): EsignField => ({
      id: randomUUID(),
      recipientId: r.id,
      type: 'SIGNATURE',
      pageIndex: 0,
      ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      required: true,
      label: null,
      mergeKey: null,
      options: [],
      groupKey: null,
      value: null,
      filled: r.status === 'SIGNED',
    }));
  w.repo.seed(w.a, id, (row) => {
    Object.assign(row.record, { status, sentAt, expiresAt: new Date(+sentAt + 30 * 86_400_000) });
    if (status === 'DRAFT' || status === 'NEEDS_APPROVAL') row.record.sentAt = null;
    row.parts.documents = [file];
    row.parts.pagePlan = [{ documentId, page: 0, rotation: 0 }];
    row.parts.recipients = recipients;
    row.parts.fields = fields;
  });
  w.repo.timelines.of(w.a).set(id, []);
  return { id, documentId, key };
}

const linkOf = (m: NotifyMessage) => (m.data as { link: string }).link;
const tokenOf = (m: NotifyMessage) => linkOf(m).slice(linkOf(m).indexOf('#t=') + 3);

describe('remind', () => {
  it('emails every signer whose turn it is a fresh link, stored only as its hash', async () => {
    const first = recipient(w);
    const portal = recipient(w, {
      delivery: 'PORTAL',
      name: 'Fake portal',
      email: 'p@client.test',
    });
    const kiosk = recipient(w, { delivery: 'IN_PERSON', name: 'Fake kiosk' });
    const later = recipient(w, { status: 'WAITING', sentAt: null, routingOrder: 2 });
    const signed = recipient(w, { status: 'SIGNED', name: 'Fake signed' });
    const cc = recipient(w, { kind: 'CC', name: 'Fake cc' });
    const { id } = await sentRequest([first, portal, kiosk, later, signed, cc]);
    const before = (await w.repo.findRequest(w.a, id))!.lastActivityAt;

    const detail = await svc.remind(w.a, owner, id);

    expect(notify.sent.map((m) => [m.template, m.to])).toEqual([
      ['esign.reminder', 'primary@client.test'],
      ['esign.reminder', 'p@client.test'],
    ]);
    expect(linkOf(notify.sent[0]!).startsWith(`${PORTAL}/fake-firm-a/sign#t=`)).toBe(true);
    expect(linkOf(notify.sent[1]!)).toBe(`${PORTAL}/fake-firm-a/signatures`);
    expect(notify.sent[0]!.data).toMatchObject({
      name: 'Fake primary',
      title: 'Engagement letter 2025',
    });
    const token = tokenOf(notify.sent[0]!);
    expect([...lc.links.of(w.a).keys()]).toEqual([sha(token)]);
    expect(lc.findLink(w.a, sha(token))).toBe(first.id);
    const reminded = detail.recipients.filter((r) => r.reminderCount === 1).map((r) => r.id);
    expect(reminded).toEqual([first.id, portal.id]);
    expect(Date.parse(detail.lastActivityAt)).toBeGreaterThan(+before);
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.actorKind, e.actorName, e.recipient?.id])).toEqual([
      ['REMINDER_SENT', 'STAFF', 'owner-a', first.id],
      ['REMINDER_SENT', 'STAFF', 'owner-a', portal.id],
    ]);
    const emailIds = [...w.repo.outbox.of(w.a).keys()];
    expect([...w.repo.outbox.of(w.a).values()].map((e) => e.status)).toEqual(['SENT', 'SENT']);
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.request_reminded',
      entity: { type: 'esign_request', id },
      metadata: { clientId: w.ids.c1, recipientIds: [first.id, portal.id], emailIds },
    });
    const kept = JSON.stringify([w.audit.entries, events, [...w.repo.outbox.of(w.a).values()]]);
    expect(kept).not.toContain(token);
    expect(kept).not.toContain('primary@client.test');
  });

  it('reminds one signer; refuses a finished one, one not yet in turn and an unknown id', async () => {
    const a = recipient(w);
    const b = recipient(w, { name: 'Fake b', email: 'b@client.test' });
    const signed = recipient(w, { status: 'SIGNED' });
    const waiting = recipient(w, { status: 'WAITING', sentAt: null, routingOrder: 2 });
    const { id } = await sentRequest([a, b, signed, waiting]);
    await svc.remind(w.a, owner, id, b.id);
    expect(notify.sent.map((m) => m.to)).toEqual(['b@client.test']);
    expect(await refused(svc.remind(w.a, owner, id, signed.id))).toEqual([409, 'RECIPIENT_DONE']);
    expect(await refused(svc.remind(w.a, owner, id, waiting.id))).toEqual([409, 'INVALID_STATE']);
    expect(await refused(svc.remind(w.a, owner, id, randomUUID()))).toEqual([404, 'NOT_FOUND']);
  });

  it('answers REMIND_TOO_SOON within an hour of the last reminder to them, not after', async () => {
    const a = recipient(w, { lastRemindedAt: new Date(Date.now() - HOUR + 60_000) });
    const { id } = await sentRequest([a]);
    expect(await refused(svc.remind(w.a, owner, id))).toEqual([409, 'REMIND_TOO_SOON']);
    expect(notify.sent).toHaveLength(0);
    w.repo.seed(
      w.a,
      id,
      (row) => (row.parts.recipients[0]!.lastRemindedAt = new Date(Date.now() - HOUR)),
    );
    expect((await svc.remind(w.a, owner, id)).recipients[0]!.reminderCount).toBe(1);
    expect(await refused(svc.remind(w.a, owner, id))).toEqual([409, 'REMIND_TOO_SOON']);
  });

  it('is REQUEST_CLOSED once closed and INVALID_STATE before it is sent', async () => {
    for (const status of ['COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED'] as const) {
      const { id } = await sentRequest([recipient(w)], status);
      expect(await refused(svc.remind(w.a, owner, id))).toEqual([409, 'REQUEST_CLOSED']);
    }
    for (const status of ['DRAFT', 'NEEDS_APPROVAL'] as const) {
      const { id } = await sentRequest([recipient(w, { status: 'WAITING' })], status);
      expect(await refused(svc.remind(w.a, owner, id))).toEqual([409, 'INVALID_STATE']);
    }
  });

  it('reminds once on a double-click: the second finds it changed (409 INVALID_STATE)', async () => {
    const { id } = await sentRequest();
    const results = await Promise.allSettled([
      svc.remind(w.a, owner, id),
      svc.remind(w.a, owner, id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(await refused(Promise.reject(lost.reason))).toEqual([409, 'INVALID_STATE']);
    expect([notify.sent.length, w.repo.outbox.of(w.a).size, lc.links.of(w.a).size]).toEqual([
      1, 1, 1,
    ]);
  });
});

describe('void', () => {
  it('voids with the reason for staff only; tells each signer who was sent it, without it', async () => {
    const sent = recipient(w);
    const done = recipient(w, { status: 'SIGNED', name: 'Fake signed', email: 's@client.test' });
    const waiting = recipient(w, { status: 'WAITING', sentAt: null, email: 'w@client.test' });
    const { id } = await sentRequest([sent, done, waiting]);
    lc.links.of(w.a).set('old-hash', { requestId: id, recipientId: sent.id, tokenVersion: 0 });
    const reason = 'Fake reason: wrong tax year';

    const detail = await svc.void(w.a, owner, id, reason);

    expect([detail.status, detail.voidReason, detail.voidedBy]).toEqual([
      'VOIDED',
      reason,
      { userId: w.users.ownerA, name: 'owner-a' },
    ]);
    expect(detail.voidedAt).not.toBeNull();
    expect(detail.allowedActions).toEqual(['DOWNLOAD']);
    expect(notify.sent.map((m) => [m.template, m.to, m.data])).toEqual([
      [
        'esign.voided',
        'primary@client.test',
        { name: 'Fake primary', title: 'Engagement letter 2025' },
      ],
    ]);
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.reason, e.actorName])).toEqual([
      ['VOIDED', reason, 'owner-a'],
    ]);
    expect(lc.findLink(w.a, 'old-hash')).toBeNull();
    const audit = w.audit.entries.at(-1)!;
    expect(audit.action).toBe('esign.request_voided');
    expect(JSON.stringify([audit, [...w.repo.outbox.of(w.a).values()]])).not.toContain(
      'Fake reason',
    );
  });

  it('voids a NEEDS_APPROVAL request (no signer was told); refuses a DRAFT and a closed one', async () => {
    const { id } = await sentRequest(
      [recipient(w, { status: 'WAITING', sentAt: null })],
      'NEEDS_APPROVAL',
    );
    expect((await svc.void(w.a, owner, id, 'Fake reason')).status).toBe('VOIDED');
    expect(notify.sent).toHaveLength(0);
    expect(await refused(svc.void(w.a, owner, id, 'Fake reason'))).toEqual([409, 'REQUEST_CLOSED']);
    const draft = await sentRequest([recipient(w, { status: 'WAITING' })], 'DRAFT');
    expect(await refused(svc.void(w.a, owner, draft.id, 'Fake reason'))).toEqual([
      409,
      'INVALID_STATE',
    ]);
  });

  it('stays voided when an email fails: FAILED in the outbox, ids only in the log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    notify.fail = true;
    const { id } = await sentRequest();
    expect((await svc.void(w.a, owner, id, 'Fake reason')).status).toBe('VOIDED');
    const [emailId, email] = [...w.repo.outbox.of(w.a).entries()][0]!;
    expect(email).toMatchObject({
      template: 'esign.voided',
      status: 'FAILED',
      error: 'NotifyDeliveryError',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(emailId);
    expect(logged).not.toContain('primary@client.test');
  });
});

describe('who may', () => {
  it('is a write: 404 across firms, for unassigned Staff and an approver; 403 for a Viewer', async () => {
    const approver = recipient(w, {
      kind: 'APPROVER',
      role: 'MANAGER',
      status: 'APPROVED',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    const x = outside();
    const { id } = await sentRequest([x, approver]);
    const cases: [string, EsignActor, number][] = [
      [w.b, { userId: w.users.ownerB, role: 'OWNER' }, 404],
      [w.a, { userId: w.users.staffA2, role: 'STAFF' }, 404],
      [w.a, { userId: w.users.managerA, role: 'MANAGER' }, 404],
      [w.a, { userId: w.users.staffA, role: 'VIEWER' }, 403],
    ];
    for (const [firm, actor, status] of cases) {
      for (const work of [svc.remind(firm, actor, id), svc.void(firm, actor, id, 'Fake reason')]) {
        expect((await refused(work))[0]).toBe(status);
      }
    }
    expect(notify.sent).toHaveLength(0);
    const staff: EsignActor = { userId: w.users.staffA, role: 'STAFF' };
    expect((await svc.remind(w.a, staff, id)).status).toBe('SENT');
  });
});
