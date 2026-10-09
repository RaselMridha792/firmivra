// R13 step 7, requests 3: POST /esign/requests/{id}/send on the in-memory ports (esign-fakes.ts)
// with R18's rules and link tokens: the readiness refusal (APPROVAL_PENDING alone included), the
// packet hash and expiry, the first turn's signers, one-time tokens stored only as hashes, the
// invitations queued and emailed (none for IN_PERSON, the Signature center for PORTAL), a failed
// email that leaves the request sent with no secret in the log, the audit, the double-click and
// the access rules. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignField } from '@firmivra/types';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
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
import { NotifyDeliveryError } from '../../src/notify/notify.service.js';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';
import { esignWorld, type EsignWorld, fakeHasher, fakePdf } from './esign-fakes.js';

const PORTAL = 'https://portal.example.test';
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage[] = [];
  fail = false;
  send(message: NotifyMessage): Promise<void> {
    if (this.fail) return Promise.reject(new NotifyDeliveryError(message.template, 'email', 'X'));
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
}

let w: EsignWorld;
let notify: FakeNotify;
let requests: EsignRequestsService;
let svc: EsignSendService;
let owner: EsignActor;

beforeEach(() => {
  w = esignWorld();
  notify = new FakeNotify();
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  const prepare = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
  svc = new EsignSendService(
    requests,
    prepare,
    w.repo,
    w.directory,
    esignRules,
    fakePdf,
    w.store,
    new RandomLinkTokens(),
    notify,
    w.audit,
    { PORTAL_BASE_URL: `${PORTAL}/` },
  );
  owner = { userId: w.users.ownerA, role: 'OWNER' };
});
afterEach(() => vi.restoreAllMocks());

async function refused(work: Promise<unknown>): Promise<[number, string, unknown?]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code: string; details?: unknown };
    return [error.getStatus(), body.code, body.details];
  }
  throw new Error('expected a refusal');
}

const signer = (extra: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name: 'Fake primary',
  email: 'primary@client.test',
  phone: null,
  link: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary },
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
  ...extra,
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

/** A ready DRAFT for c1 (assigned to staff), its file stored as a 2-page fake PDF. */
async function readyDraft(
  recipients = [signer()],
  routing: 'SEQUENTIAL' | 'PARALLEL' = 'SEQUENTIAL',
) {
  const { id } = await requests.create(w.a, owner, {
    title: 'Engagement letter 2025',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c1,
    engagementId: w.ids.e1,
  });
  const documentId = randomUUID();
  const key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, key, new TextEncoder().encode('pdf:2'), 'application/pdf');
  const file: EsignDocumentRecord = {
    id: documentId,
    position: 0,
    fileName: 'letter.pdf',
    contentType: 'application/pdf',
    sizeBytes: 5,
    pageCount: 2,
    pageSizes: [0, 1].map(() => ({ width: 612, height: 792 })),
    sourceDocumentId: null,
    scanStatus: 'CLEAN',
    createdAt: new Date(),
    s3Key: key,
    sha256: '0'.repeat(64),
  };
  w.repo.seed(w.a, id, (row) => {
    row.record.routing = routing;
    row.parts.documents = [file];
    row.parts.pagePlan = [0, 1].map((page) => ({ documentId, page, rotation: 0 }));
    row.parts.recipients = recipients;
    row.parts.fields = recipients.filter((r) => r.kind === 'SIGNER').map((r) => sign(r.id));
  });
  return { id, documentId };
}

describe('sending a request', () => {
  it('hashes and stores the packet, starts the expiry and sends to the first routing order', async () => {
    const first = signer();
    const second = signer({ routingOrder: 2, name: 'Fake spouse', email: 'spouse@client.test' });
    const { id, documentId } = await readyDraft([first, second]);
    const before = Date.now();
    const sent = await svc.send(w.a, owner, id);

    const packet = `packet:${documentId}/0/0,${documentId}/1/0`;
    expect(sent.status).toBe('SENT');
    expect(sent.originalSha256).toBe(sha(packet));
    const stored = await w.store.read(w.a, w.store.keyFor(w.a, id, `packet-${sha(packet)}.pdf`));
    expect(Buffer.from(stored!).toString()).toBe(packet);
    const sentAt = Date.parse(sent.sentAt!);
    expect(sentAt).toBeGreaterThanOrEqual(before);
    expect(Date.parse(sent.expiresAt!) - sentAt).toBe(30 * 86_400_000);
    expect(sent.recipients.map((r) => [r.name, r.status, r.sentAt === sent.sentAt])).toEqual([
      ['Fake primary', 'SENT', true],
      ['Fake spouse', 'WAITING', false],
    ]);
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.actorKind, e.actorName])).toEqual([
      ['SENT', 'STAFF', 'owner-a'],
    ]);
    expect(notify.sent.map((m) => m.to)).toEqual(['primary@client.test']);
  });

  it('sends to every signer at once when PARALLEL', async () => {
    const { id } = await readyDraft(
      [signer(), signer({ name: 'Fake spouse', email: 'spouse@client.test' })],
      'PARALLEL',
    );
    const sent = await svc.send(w.a, owner, id);
    expect(sent.recipients.map((r) => r.status)).toEqual(['SENT', 'SENT']);
    expect(notify.sent).toHaveLength(2);
  });

  it('issues one-time link tokens and stores only their hashes', async () => {
    const a = signer();
    const b = signer({
      name: 'Fake outside',
      email: 'outside@example.test',
      link: { type: 'EXTERNAL' },
    });
    const { id } = await readyDraft([a, b], 'PARALLEL');
    await svc.send(w.a, owner, id);
    const slug = 'fake-firm-a';
    const tokens = notify.sent.map((m) => {
      const link = (m.data as { link: string }).link;
      expect(link.startsWith(`${PORTAL}/${slug}/sign#t=`)).toBe(true);
      return link.slice(link.indexOf('#t=') + 3);
    });
    expect(tokens[0]).toMatch(/^[\w-]{43}$/);
    expect(tokens[0]).not.toBe(tokens[1]);
    const stored = w.repo.tokenHashes.of(w.a);
    expect([stored.get(a.id), stored.get(b.id)]).toEqual(tokens.map((t) => sha(t!)));
    // The token is in its one email only: not in the stored rows, the audit or the timeline.
    const kept = JSON.stringify([
      [...stored.values()],
      [...w.repo.outbox.of(w.a).values()],
      w.audit.entries,
      await w.repo.events(w.a, id),
      await w.repo.parts(w.a, id),
    ]);
    for (const t of tokens) expect(kept).not.toContain(t);
  });

  it('queues and emails the invitation with the firm’s request data, from config', async () => {
    const { id } = await readyDraft();
    w.repo.seed(w.a, id, (row) => (row.record.emailMessage = 'Please sign by Friday.'));
    await svc.send(w.a, owner, id);
    const [message] = notify.sent;
    expect(message).toMatchObject({
      template: 'esign.request',
      to: 'primary@client.test',
      businessId: w.a,
      data: {
        name: 'Fake primary',
        title: 'Engagement letter 2025',
        senderName: 'owner-a',
        message: 'Please sign by Friday.',
      },
    });
    expect([...w.repo.outbox.of(w.a).values()]).toEqual([
      expect.objectContaining({ template: 'esign.request', status: 'SENT', error: null }),
    ]);
  });

  it('emails no IN_PERSON signer, and a PORTAL signer the Signature center without a token', async () => {
    const kiosk = signer({ delivery: 'IN_PERSON', name: 'Fake kiosk', email: 'kiosk@client.test' });
    const portal = signer({ delivery: 'PORTAL', name: 'Fake portal', email: 'portal@client.test' });
    const { id } = await readyDraft([kiosk, portal], 'PARALLEL');
    const sent = await svc.send(w.a, owner, id);
    expect(sent.recipients.map((r) => r.status)).toEqual(['SENT', 'SENT']);
    expect(notify.sent.map((m) => [m.to, (m.data as { link: string }).link])).toEqual([
      ['portal@client.test', `${PORTAL}/fake-firm-a/signatures`],
    ]);
    expect(w.repo.tokenHashes.of(w.a).size).toBe(0);
  });

  it('keeps the request sent when an email fails: FAILED in the outbox, ids only in the log', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    notify.fail = true;
    const { id } = await readyDraft();
    const sent = await svc.send(w.a, owner, id);
    expect(sent.status).toBe('SENT');
    const [email] = [...w.repo.outbox.of(w.a).entries()];
    expect(email?.[1]).toMatchObject({ status: 'FAILED', error: 'NotifyDeliveryError' });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(email![0]);
    for (const secret of ['primary@client.test', '#t=', ...w.repo.tokenHashes.of(w.a).values()]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('audits esign.request_sent with ids only', async () => {
    const first = signer();
    const { id } = await readyDraft([first]);
    await svc.send(w.a, owner, id);
    const entry = w.audit.entries.find((e) => e.action === 'esign.request_sent');
    const emailIds = [...w.repo.outbox.of(w.a).keys()];
    expect(entry).toEqual({
      action: 'esign.request_sent',
      entity: { type: 'esign_request', id },
      metadata: { clientId: w.ids.c1, recipientIds: [first.id], emailIds },
    });
  });
});

describe('refusing to send', () => {
  it('answers 409 NOT_READY with the problems, and writes nothing', async () => {
    const { id } = await readyDraft();
    w.repo.seed(w.a, id, (row) => (row.record.engagementId = null));
    const [status, code, details] = await refused(svc.send(w.a, owner, id));
    expect([status, code]).toEqual([409, 'NOT_READY']);
    expect((details as { code: string }[]).map((p) => p.code)).toEqual(['NO_ENGAGEMENT']);
    expect((await w.repo.findRequest(w.a, id))?.status).toBe('DRAFT');
    expect([notify.sent.length, w.repo.outbox.of(w.a).size]).toEqual([0, 0]);
    expect(w.audit.entries.map((e) => e.action)).not.toContain('esign.request_sent');
  });

  it('answers NOT_READY with APPROVAL_PENDING alone (that DRAFT goes to submit-for-approval)', async () => {
    const approver = signer({
      kind: 'APPROVER',
      role: 'MANAGER',
      name: 'manager-a',
      email: 'manager-a@firm.test',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    const { id } = await readyDraft([signer(), approver]);
    const [status, code, details] = await refused(svc.send(w.a, owner, id));
    expect([status, code]).toEqual([409, 'NOT_READY']);
    expect((details as { code: string }[]).map((p) => p.code)).toEqual(['APPROVAL_PENDING']);
    // Approved (the last approval's send failed earlier): it sends, and the approval stands.
    w.repo.seed(w.a, id, (row) => (row.parts.recipients[1]!.status = 'APPROVED'));
    const sent = await svc.send(w.a, owner, id);
    expect(sent.recipients.map((r) => r.status)).toEqual(['SENT', 'APPROVED']);
    expect(notify.sent.map((m) => m.to)).toEqual(['primary@client.test']);
  });

  it('sends once on a double-click: the second finds it changed (409 INVALID_STATE)', async () => {
    const { id } = await readyDraft();
    const results = await Promise.allSettled([svc.send(w.a, owner, id), svc.send(w.a, owner, id)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected');
    expect(await refused(Promise.reject((lost as PromiseRejectedResult).reason))).toEqual([
      409,
      'INVALID_STATE',
      undefined,
    ]);
    expect(await refused(svc.send(w.a, owner, id))).toEqual([409, 'INVALID_STATE', undefined]);
    expect([notify.sent.length, w.repo.tokenHashes.of(w.a).size]).toEqual([1, 1]);
    expect(w.audit.entries.filter((e) => e.action === 'esign.request_sent')).toHaveLength(1);
  });

  it('is a write: 404 across firms, for unassigned Staff and an approver; 403 for a Viewer', async () => {
    const approver = signer({
      kind: 'APPROVER',
      role: 'MANAGER',
      status: 'APPROVED',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    const { id } = await readyDraft([signer(), approver]);
    const cases: [string, EsignActor, number][] = [
      [w.b, { userId: w.users.ownerB, role: 'OWNER' }, 404],
      [w.a, { userId: w.users.staffA2, role: 'STAFF' }, 404],
      [w.a, { userId: w.users.managerA, role: 'MANAGER' }, 404],
      [w.a, { userId: w.users.staffA, role: 'VIEWER' }, 403],
    ];
    for (const [firm, actor, status] of cases) {
      expect((await refused(svc.send(firm, actor, id)))[0]).toBe(status);
    }
    // The assigned Staff member sends it.
    const sent = await svc.send(w.a, { userId: w.users.staffA, role: 'STAFF' }, id);
    expect(sent.status).toBe('SENT');
  });
});
