// R13 step 6, requests API parts 1b and 1c: status, drafts, page plan and recipients on the
// in-memory ports (esign-fakes.ts):
// access (Owner and Admin all, Staff and Managers own or assigned), cross-firm and cross-client
// 404s, DRAFT only, and an audit of ids only; and the fakes themselves (each firm sees only its
// own rows, writes reach DRAFTs only). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EsignField,
  type EsignPutRecipientsBody,
  type EsignRecipient,
  EsignRequestDetail,
} from '@firmivra/types';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
  NewEsignRequest,
} from '../../src/esign/requests/esign.repository.js';
import { ESIGN_TEST_DEFAULTS, esignWorld, type EsignWorld, fakeHasher } from './esign-fakes.js';

let w: EsignWorld;
let svc: EsignRequestsService;
let owner: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;

beforeEach(() => {
  w = esignWorld();
  svc = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
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

const field = (pageIndex: number, recipientId: string | null = null): EsignField => ({
  id: randomUUID(),
  recipientId,
  type: recipientId ? 'SIGNATURE' : 'TEXT',
  pageIndex,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.05,
  required: true,
  label: null,
  mergeKey: null,
  options: [],
  groupKey: null,
  value: recipientId ? null : 'prefilled',
  filled: false,
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

describe('PUT page plan', () => {
  async function withPages() {
    const d = await draft(owner, w.ids.c1);
    const [d1, d2] = [doc(3, 0), doc(1, 1)];
    const plan = [
      { documentId: d1.id, page: 0, rotation: 0 as const },
      { documentId: d1.id, page: 1, rotation: 0 as const },
      { documentId: d1.id, page: 2, rotation: 90 as const },
      { documentId: d2.id, page: 0, rotation: 0 as const },
    ];
    const [onPage1, onPage2] = [field(1), field(2)];
    w.repo.seed(w.a, d.id, (row) => {
      row.parts.documents.push(d1, d2);
      row.parts.pagePlan = plan;
      row.parts.fields = [onPage1, onPage2];
    });
    return { id: d.id, plan, onPage1, onPage2 };
  }

  it('reorders the pages: fields follow their page, and go with a removed page', async () => {
    const { id, plan, onPage1, onPage2 } = await withPages();
    const [p0, p1, p2, p3] = [plan[0]!, plan[1]!, plan[2]!, plan[3]!];
    const next = await svc.putPagePlan(w.a, owner, id, [p3, p2, p0, p1]);
    expect(next.pagePlan).toEqual([p3, p2, p0, p1]);
    expect(next.fields.map((f) => [f.id, f.pageIndex])).toEqual([
      [onPage1.id, 3],
      [onPage2.id, 1],
    ]);
    const fewer = await svc.putPagePlan(w.a, owner, id, [p0, p2]);
    expect(fewer.fields.map((f) => [f.id, f.pageIndex])).toEqual([[onPage2.id, 1]]);
    expect(w.audit.entries.at(-1)).toMatchObject({
      action: 'esign.page_plan_updated',
      metadata: { pageCount: 2, fieldsRemoved: 1 },
    });
  });

  it('refuses to rotate a page with fields (409) and pages that are not the request’s (400)', async () => {
    const { id, plan } = await withPages();
    const turned = plan.map((p, i) => (i === 1 ? { ...p, rotation: 180 as const } : p));
    expect(await refused(svc.putPagePlan(w.a, owner, id, turned))).toEqual([
      409,
      'PAGE_HAS_FIELDS',
    ]);
    // A page without fields turns.
    const free = plan.map((p, i) => (i === 3 ? { ...p, rotation: 270 as const } : p));
    expect((await svc.putPagePlan(w.a, owner, id, free)).pagePlan[3]?.rotation).toBe(270);
    const beyond = [{ ...plan[0]!, page: 3 }];
    const unknown = [{ documentId: randomUUID(), page: 0, rotation: 0 as const }];
    for (const pages of [beyond, unknown]) {
      expect(await refused(svc.putPagePlan(w.a, owner, id, pages))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
  });
});

describe('PUT recipients', () => {
  type Input = EsignPutRecipientsBody['recipients'][number];
  const signer = (who: Input['who'], extra: Partial<Input> = {}) => ({
    kind: 'SIGNER' as const,
    role: 'CLIENT' as const,
    routingOrder: 1,
    who,
    delivery: 'EMAIL' as const,
    authMethod: 'EMAIL_CODE' as const,
    ...extra,
  });
  const put = (id: string, recipients: ReturnType<typeof signer>[], actor = owner) =>
    svc.putRecipients(w.a, actor, id, { recipients });

  it('links the client’s PRIMARY and SPOUSE logins by id, a member and an outsider', async () => {
    const d = await draft(owner, w.ids.c1);
    const res = await put(d.id, [
      signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary }),
      signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse }, { role: 'SPOUSE' }),
      signer(
        { type: 'STAFF', userId: w.users.staffA },
        { role: 'PREPARER', routingOrder: 2, delivery: 'IN_PERSON' },
      ),
      // An outsider with a client login's email stays an outsider: never matched by email.
      signer(
        {
          type: 'EXTERNAL',
          name: 'Fake Witness',
          email: `${w.ids.primary.slice(0, 8)}@client.test`,
        },
        {
          role: 'CUSTOM',
          roleLabel: 'Witness',
          routingOrder: 3,
          authMethod: 'ACCESS_CODE',
          accessCode: 'abc123',
        },
      ),
    ]);
    expect(EsignRequestDetail.parse(res)).toEqual(res);
    expect(
      res.recipients.map((r) => [r.name, r.link.type, r.colorIndex, r.hasAccessCode, r.status]),
    ).toEqual([
      ['Fake primary', 'CLIENT_LOGIN', 0, false, 'WAITING'],
      ['Fake spouse', 'CLIENT_LOGIN', 1, false, 'WAITING'],
      ['staff-a', 'STAFF', 2, false, 'WAITING'],
      ['Fake Witness', 'EXTERNAL', 3, true, 'WAITING'],
    ]);
    expect(res.recipients[3]?.roleLabel).toBe('Witness');
    expect(res.signerNames).toEqual(['Fake primary', 'Fake spouse', 'staff-a', 'Fake Witness']);
    // The code itself is never returned or audited.
    expect(JSON.stringify(res)).not.toContain('abc123');
    expect(JSON.stringify(w.audit.entries)).not.toContain('abc123');
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.recipients_updated',
      entity: { type: 'esign_request', id: d.id },
      metadata: { recipientIds: res.recipients.map((r) => r.id), fieldsRemoved: 0 },
    });
  });

  it('refuses logins that are not the client’s ACTIVE PRIMARY or SPOUSE, and inactive members', async () => {
    const d = await draft(owner, w.ids.c1);
    for (const clientAccountId of [
      w.ids.authorized,
      w.ids.disabled,
      w.ids.c2Login, // another client's
      w.ids.loginB, // another firm's
      randomUUID(),
    ]) {
      expect(await refused(put(d.id, [signer({ type: 'CLIENT_LOGIN', clientAccountId })]))).toEqual(
        [409, 'LOGIN_NOT_ACTIVE'],
      );
    }
    for (const userId of [w.users.goneA, w.users.ownerB, randomUUID()]) {
      expect(await refused(put(d.id, [signer({ type: 'STAFF', userId })]))).toEqual([
        409,
        'NOT_A_MEMBER',
      ]);
    }
    // No client yet: no client login fits.
    const bare = await draft(owner);
    expect(
      await refused(
        put(bare.id, [signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary })]),
      ),
    ).toEqual([409, 'LOGIN_NOT_ACTIVE']);
  });

  it('keeps ids, colours and access codes; removed signers lose their fields', async () => {
    const d = await draft(owner, w.ids.c1);
    const first = await put(d.id, [
      signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary }),
      signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse }, { role: 'SPOUSE' }),
      signer(
        { type: 'EXTERNAL', name: 'Fake Partner', email: 'partner@outside.test' },
        { role: 'BUSINESS_OWNER', authMethod: 'ACCESS_CODE', accessCode: 'code42' },
      ),
    ]);
    const [primary, spouse, partner] = [0, 1, 2].map((i) => first.recipients[i]!) as [
      EsignRecipient,
      EsignRecipient,
      EsignRecipient,
    ];
    const kept = field(0, spouse.id);
    const gone = field(0, primary.id);
    const sender = field(0);
    w.repo.seed(w.a, d.id, (row) => (row.parts.fields = [kept, gone, sender]));

    const second = await put(d.id, [
      signer({ type: 'EXTERNAL', name: 'Fake New', email: 'new@outside.test' }),
      signer(
        { type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse },
        { id: spouse.id, role: 'SPOUSE' },
      ),
      signer(
        { type: 'EXTERNAL', name: 'Fake Partner', email: 'partner@outside.test' },
        { id: partner.id, role: 'BUSINESS_OWNER', authMethod: 'ACCESS_CODE' },
      ),
    ]);
    expect(second.recipients.map((r) => [r.id === spouse.id, r.colorIndex])).toEqual([
      [false, 0], // the lowest free colour
      [true, 1],
      [false, 2],
    ]);
    expect(second.recipients[2]).toMatchObject({ id: partner.id, hasAccessCode: true });
    expect(second.fields.map((f) => f.id)).toEqual([kept.id, sender.id]);

    // An approver signs nothing: their fields go too.
    const third = await put(d.id, [
      signer({ type: 'STAFF', userId: w.users.managerA }, { kind: 'APPROVER', role: 'MANAGER' }),
      signer(
        { type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse },
        { id: spouse.id, kind: 'CC', role: 'SPOUSE' },
      ),
    ]);
    expect(third.fields.map((f) => f.id)).toEqual([sender.id]);
    expect(third.signerNames).toEqual([]);
  });

  it('asks for an access code it does not have, 400s an unknown id, and uses order 1 when PARALLEL', async () => {
    const d = await draft(owner, w.ids.c1);
    const first = await put(d.id, [
      signer({ type: 'EXTERNAL', name: 'Fake X', email: 'x@outside.test' }),
    ]);
    const id = first.recipients[0]!.id;
    const noCode = signer(
      { type: 'EXTERNAL', name: 'Fake X', email: 'x@outside.test' },
      { id, authMethod: 'ACCESS_CODE' },
    );
    expect(await refused(put(d.id, [noCode]))).toEqual([400, 'VALIDATION_FAILED']);
    const unknown = signer(
      { type: 'EXTERNAL', name: 'Fake Y', email: 'y@outside.test' },
      { id: randomUUID() },
    );
    expect(await refused(put(d.id, [unknown]))).toEqual([400, 'VALIDATION_FAILED']);
    // A kept id that is now someone else does not inherit the old access code.
    const coded = { authMethod: 'ACCESS_CODE' as const };
    await put(d.id, [
      signer(
        { type: 'EXTERNAL', name: 'Fake X', email: 'x@outside.test' },
        { id, ...coded, accessCode: 'c0de42' },
      ),
    ]);
    const other = signer(
      { type: 'EXTERNAL', name: 'Fake Z', email: 'z@outside.test' },
      { id, ...coded },
    );
    expect(await refused(put(d.id, [other]))).toEqual([400, 'VALIDATION_FAILED']);

    await svc.update(w.a, owner, d.id, { routing: 'PARALLEL' });
    const parallel = await put(d.id, [
      signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary }, { routingOrder: 3 }),
      signer(
        { type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse },
        { role: 'SPOUSE', routingOrder: 5 },
      ),
    ]);
    expect(parallel.recipients.map((r) => r.routingOrder)).toEqual([1, 1]);
  });

  it('keeps an access code for the same member or login, never for another one', async () => {
    const d = await draft(owner, w.ids.c1);
    const coded = { authMethod: 'ACCESS_CODE' as const };
    const people: [Input['who'], Input['who']][] = [
      [
        { type: 'STAFF', userId: w.users.staffA },
        { type: 'STAFF', userId: w.users.managerA },
      ],
      [
        { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary },
        { type: 'CLIENT_LOGIN', clientAccountId: w.ids.spouse },
      ],
    ];
    for (const [who, someoneElse] of people) {
      const first = await put(d.id, [signer(who, { ...coded, accessCode: 'k3ep42' })]);
      const id = first.recipients[0]!.id;
      // The same person, no new code: the stored one stays.
      const again = await put(d.id, [signer(who, { id, ...coded })]);
      expect(again.recipients[0]).toMatchObject({ id, hasAccessCode: true });
      // The same id now someone else: a new code is needed.
      expect(await refused(put(d.id, [signer(someoneElse, { id, ...coded })]))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
  });

  it('lets Staff manage recipients on their assigned client’s request', async () => {
    const d = await draft(owner, w.ids.c1);
    const res = await put(
      d.id,
      [signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary })],
      staff,
    );
    expect(res.recipients).toHaveLength(1);
    expect(
      await refused(
        put(d.id, [signer({ type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary })], staff2),
      ),
    ).toEqual([404, 'NOT_FOUND']);
  });
});

describe('page plan and recipients: access and state', () => {
  it('answers 404 for another firm’s request and 409 INVALID_STATE once sent', async () => {
    const d = await draft(owner, w.ids.c1);
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    for (const work of [
      svc.putRecipients(w.b, ownerB, d.id, { recipients: [] }),
      svc.putPagePlan(w.b, ownerB, d.id, []),
    ]) {
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    // A write between the read and the save (a PUT fields, say) is never reverted: 409.
    const parts = w.repo.parts.bind(w.repo);
    for (const work of [
      () => svc.putRecipients(w.a, owner, d.id, { recipients: [] }),
      () => svc.putPagePlan(w.a, owner, d.id, []),
    ]) {
      w.repo.parts = async (businessId, id) => {
        w.repo.parts = parts;
        await w.repo.updateDraft(w.a, d.id, { title: 'In between' });
        return parts(businessId, id);
      };
      expect(await refused(work())).toEqual([409, 'INVALID_STATE']);
    }
    w.repo.seed(w.a, d.id, (row) => (row.record.status = 'SENT'));
    for (const work of [
      svc.putRecipients(w.a, owner, d.id, { recipients: [] }),
      svc.putPagePlan(w.a, owner, d.id, []),
    ]) {
      expect(await refused(work)).toEqual([409, 'INVALID_STATE']);
    }
  });
});

describe('approvers', () => {
  type Input = EsignPutRecipientsBody['recipients'][number];
  const approver = (who: Input['who']) => ({
    kind: 'APPROVER' as const,
    role: 'MANAGER' as const,
    routingOrder: 1,
    who,
    delivery: 'EMAIL' as const,
    authMethod: 'EMAIL_CODE' as const,
  });
  const staffWho = (userId: string): Input['who'] => ({ type: 'STAFF', userId });

  it('takes an Owner, Admin or Firm Sign Manager who is not the sender', async () => {
    const d = await draft(staff, w.ids.c1);
    const res = await svc.putRecipients(w.a, staff, d.id, {
      recipients: [w.users.ownerA, w.users.adminA, w.users.managerA].map((u) =>
        approver(staffWho(u)),
      ),
    });
    expect(res.recipients.map((r) => [r.kind, r.name, r.status])).toEqual([
      ['APPROVER', 'owner-a', 'WAITING'],
      ['APPROVER', 'admin-a', 'WAITING'],
      ['APPROVER', 'manager-a', 'WAITING'],
    ]);
  });

  it('refuses Staff, the sender, a client login and an outsider (409 APPROVER_NOT_ALLOWED)', async () => {
    const d = await draft(owner, w.ids.c1);
    for (const who of [
      staffWho(w.users.staffA),
      staffWho(w.users.ownerA), // the sender
      { type: 'CLIENT_LOGIN' as const, clientAccountId: w.ids.primary },
      { type: 'EXTERNAL' as const, name: 'Fake Boss', email: 'boss@outside.test' },
    ]) {
      expect(
        await refused(svc.putRecipients(w.a, owner, d.id, { recipients: [approver(who)] })),
      ).toEqual([409, 'APPROVER_NOT_ALLOWED']);
    }
    // Another firm's owner is not a member here.
    expect(
      await refused(
        svc.putRecipients(w.a, owner, d.id, { recipients: [approver(staffWho(w.users.ownerB))] }),
      ),
    ).toEqual([409, 'NOT_A_MEMBER']);
    expect((await svc.get(w.a, owner, d.id)).recipients).toEqual([]);
  });

  it('names a member once as approver (400), and never lets an approver change the request', async () => {
    const d = await draft(owner, w.ids.c1);
    const twice = [approver(staffWho(w.users.managerA)), approver(staffWho(w.users.managerA))];
    expect(await refused(svc.putRecipients(w.a, owner, d.id, { recipients: twice }))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    await svc.putRecipients(w.a, owner, d.id, { recipients: twice.slice(1) });
    const manager: EsignActor = { userId: w.users.managerA, role: 'MANAGER' };
    expect((await svc.get(w.a, manager, d.id)).allowedActions).toEqual([]);
    for (const work of [
      svc.putRecipients(w.a, manager, d.id, { recipients: [] }),
      svc.putPagePlan(w.a, manager, d.id, []),
    ]) {
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    expect((await svc.get(w.a, owner, d.id)).recipients).toHaveLength(1);
  });

  it('asks again after any edit: approvers go back to WAITING', async () => {
    const d = await draft(staff, w.ids.c1);
    await svc.putRecipients(w.a, staff, d.id, {
      recipients: [approver(staffWho(w.users.managerA))],
    });
    const approve = () =>
      w.repo.seed(w.a, d.id, (row) => {
        for (const r of row.parts.recipients) r.status = 'APPROVED';
      });
    approve();
    expect((await svc.get(w.a, staff, d.id)).recipients[0]?.status).toBe('APPROVED');
    await svc.update(w.a, staff, d.id, { title: 'Changed' });
    expect((await svc.get(w.a, staff, d.id)).recipients[0]?.status).toBe('WAITING');
    approve();
    await svc.putPagePlan(w.a, staff, d.id, []);
    expect((await svc.get(w.a, staff, d.id)).recipients[0]?.status).toBe('WAITING');
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
    // A write answers the request as written, strictly later; a stale readAt is refused.
    const read = (await w.repo.findRequest(w.a, made.id))!;
    const saved = await w.repo.savePagePlan(w.a, made.id, [], [], read.lastActivityAt);
    expect(saved?.lastActivityAt.getTime()).toBeGreaterThan(read.lastActivityAt.getTime());
    expect(await w.repo.saveRecipients(w.a, made.id, [], [], read.lastActivityAt)).toBeNull();
    w.repo.seed(w.a, made.id, (row) => (row.record.status = 'SENT'));
    const now = saved!.lastActivityAt;
    expect(await w.repo.savePagePlan(w.a, made.id, [], [], now)).toBeNull();
    expect(await w.repo.saveRecipients(w.a, made.id, [], [], now)).toBeNull();
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
