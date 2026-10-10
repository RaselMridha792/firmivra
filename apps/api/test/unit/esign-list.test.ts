// R13 step 6, requests API part 2b: the list (filters, quick filters, search, cursor), the
// counters, the timeline, and who sees what (Owner and Admin all; Staff, Managers and Viewers
// their own and their assigned clients'; an approver the ones they approve) with each row's
// allowedActions, on the in-memory ports (esign-fakes.ts). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EsignEventList,
  EsignRequestList,
  type EsignRequestStatus,
  EsignSummary,
  ListEsignRequestsQuery,
} from '@firmivra/types';
import type {
  EsignEventRecord,
  EsignRecipientRecord,
  EsignRequestRecord,
} from '../../src/esign/requests/esign.repository.js';
import { allowedActions, nextAction } from '../../src/esign/requests/actions.js';
import { EsignListService } from '../../src/esign/requests/list.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { esignWorld, type EsignWorld, fakeHasher } from './esign-fakes.js';

let w: EsignWorld;
let svc: EsignRequestsService;
let lists: EsignListService;
let owner: EsignActor;
let admin: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;
let manager: EsignActor;
let viewer: EsignActor;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  w = esignWorld();
  svc = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  lists = new EsignListService(w.repo, svc);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  admin = { userId: w.users.adminA, role: 'ADMIN' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  staff2 = { userId: w.users.staffA2, role: 'STAFF' };
  manager = { userId: w.users.managerA, role: 'MANAGER' };
  viewer = { userId: w.users.staffA, role: 'VIEWER' };
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

const person = (name: string, over: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name,
  email: `${name.replace(/\W/g, '').toLowerCase()}@client.test`,
  phone: null,
  link: { type: 'EXTERNAL' },
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
  ...over,
});
const approverOf = (userId: string, status: EsignRecipientRecord['status'] = 'WAITING') =>
  person('Fake Approver', {
    kind: 'APPROVER',
    role: 'MANAGER',
    link: { type: 'STAFF', userId },
    status,
  });

/** A stored request of firm A (or `firm`), with the given columns and recipients. */
async function make(
  over: Partial<EsignRequestRecord> & { recipients?: EsignRecipientRecord[]; firm?: string } = {},
) {
  const { recipients = [], firm = w.a, ...columns } = over;
  const made = await w.repo.createRequest(firm, {
    title: 'Fake engagement letter',
    source: 'TAB',
    clientId: null,
    engagementId: null,
    senderUserId: w.users.ownerA,
    internalNote: null,
    emailSubject: null,
    emailMessage: null,
    routing: 'SEQUENTIAL',
    expiryDays: 30,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
  });
  w.repo.seed(firm, made.id, (row) => {
    Object.assign(row.record, columns);
    row.parts.recipients = recipients;
  });
  return made.id;
}

const list = (actor: EsignActor, query: ListEsignRequestsQuery = {}) =>
  lists.list(w.a, actor, ListEsignRequestsQuery.parse(query));
const ids = async (actor: EsignActor, query: ListEsignRequestsQuery = {}) =>
  (await list(actor, query)).items.map((r) => r.id).sort();
const sorted = (...x: string[]) => [...x].sort();

describe('who sees what', () => {
  let own: string;
  let assigned: string;
  let other: string;
  let approving: string;
  let firmB: string;
  beforeEach(async () => {
    own = await make({ senderUserId: w.users.staffA, title: 'Staff own' });
    assigned = await make({ clientId: w.ids.c1, title: 'Assigned client' });
    other = await make({ clientId: w.ids.c2, title: 'Other client' });
    approving = await make({
      clientId: w.ids.c2,
      status: 'NEEDS_APPROVAL',
      recipients: [approverOf(w.users.managerA)],
    });
    firmB = await make({ firm: w.b, senderUserId: w.users.ownerB, clientId: w.ids.cB });
  });

  it('gives Owner and Admin every request of their own firm only', async () => {
    for (const actor of [owner, admin]) {
      expect(await ids(actor)).toEqual(sorted(own, assigned, other, approving));
    }
    expect(
      (await lists.list(w.b, { userId: w.users.ownerB, role: 'OWNER' }, { limit: 25 })).items.map(
        (r) => r.id,
      ),
    ).toEqual([firmB]);
  });

  it('gives Staff and Viewers their own and their assigned clients’ requests', async () => {
    expect(await ids(staff)).toEqual(sorted(own, assigned));
    expect(await ids(viewer)).toEqual(sorted(own, assigned));
    expect(await ids(staff2)).toEqual([]);
  });

  it('gives an approver the requests they approve, read only', async () => {
    expect(await ids(manager)).toEqual([approving]);
    const [row] = (await list(manager)).items;
    expect(row?.allowedActions).toEqual(['APPROVE']);
    expect((await svc.get(w.a, manager, approving)).allowedActions).toEqual(['APPROVE']);
  });

  it('lets a Viewer read but never change (403), and only download', async () => {
    const sent = await make({ senderUserId: w.users.staffA, status: 'SENT', sentAt: new Date() });
    const rows = (await list(viewer)).items;
    expect(rows.find((r) => r.id === own)?.allowedActions).toEqual([]);
    expect(rows.find((r) => r.id === sent)?.allowedActions).toEqual(['DOWNLOAD']);
    expect((await svc.get(w.a, viewer, own)).id).toBe(own);
    expect(await refused(svc.update(w.a, viewer, own, { title: 'x' }))).toEqual([403, 'FORBIDDEN']);
    expect(await refused(svc.discard(w.a, viewer, own))).toEqual([403, 'FORBIDDEN']);
    expect(await refused(svc.create(w.a, viewer, { title: 'x', source: 'TAB' }))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    // What a Viewer may not see stays 404, never 403.
    expect(await refused(svc.update(w.a, viewer, other, { title: 'x' }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });

  it('counts only what the caller may open', async () => {
    const counts = async (actor: EsignActor) => (await lists.summary(w.a, actor)).counts;
    expect(await counts(owner)).toMatchObject({ DRAFT: 3, NEEDS_APPROVAL: 1 });
    expect(await counts(staff)).toMatchObject({ DRAFT: 2, NEEDS_APPROVAL: 0 });
    expect(await counts(viewer)).toMatchObject({ DRAFT: 2, NEEDS_APPROVAL: 0 });
    expect(await counts(manager)).toMatchObject({ DRAFT: 0, NEEDS_APPROVAL: 1 });
    expect(await counts(staff2)).toMatchObject({ DRAFT: 0, NEEDS_APPROVAL: 0 });
  });
});

describe('filters', () => {
  it('takes SENT to include DELIVERED, and the other statuses as they are', async () => {
    const sent = await make({ status: 'SENT' });
    const delivered = await make({ status: 'DELIVERED' });
    const viewed = await make({ status: 'VIEWED' });
    await make();
    expect(await ids(owner, { status: 'SENT' })).toEqual(sorted(sent, delivered));
    expect(await ids(owner, { status: 'VIEWED' })).toEqual([viewed]);
    expect(await ids(owner, { status: 'DELIVERED' })).toEqual([delivered]);
  });

  it('filters by client, sender and last-activity days (inclusive, UTC)', async () => {
    const at = (d: string) => new Date(`2026-10-${d}Z`);
    const c1 = await make({ clientId: w.ids.c1, lastActivityAt: at('01T00:00:00.000') });
    const c2 = await make({ clientId: w.ids.c2, lastActivityAt: at('05T23:59:59.999') });
    const bySender = await make({
      senderUserId: w.users.adminA,
      lastActivityAt: at('06T00:00:00.000'),
    });
    expect(await ids(owner, { clientId: w.ids.c1 })).toEqual([c1]);
    expect(await ids(owner, { senderId: w.users.adminA })).toEqual([bySender]);
    expect(await ids(owner, { from: '2026-10-01', to: '2026-10-05' })).toEqual(sorted(c1, c2));
    expect(await ids(owner, { from: '2026-10-02' })).toEqual(sorted(c2, bySender));
    expect(await ids(owner, { to: '2026-09-30' })).toEqual([]);
  });

  it('searches the document name, client, sender and signers, ignoring case', async () => {
    const title = await make({ title: 'Form 8879 FAKE' });
    const client = await make({ clientId: w.ids.c2 });
    const signer = await make({ recipients: [person('Fake Zelda Signer')] });
    const sender = await make({ senderUserId: w.users.adminA });
    const cc = await make({ recipients: [person('Fake Zelda Copy', { kind: 'CC' })] });
    expect(await ids(owner, { q: 'form 8879' })).toEqual([title]);
    expect(await ids(owner, { q: 'client two' })).toEqual([client]);
    expect(await ids(owner, { q: 'zelda' })).toEqual([signer]);
    expect(await ids(owner, { q: 'ADMIN-A' })).toEqual([sender]);
    expect(cc).toBeDefined();
  });

  it('applies the quick filters (Expiring Soon 3 days, Recently Completed 30 days) with AND', async () => {
    const now = Date.now();
    const soon = await make({ status: 'VIEWED', expiresAt: new Date(now + 2 * DAY) });
    const later = await make({ status: 'SENT', expiresAt: new Date(now + 4 * DAY) });
    const recent = await make({ status: 'COMPLETED', completedAt: new Date(now - 29 * DAY) });
    await make({ status: 'COMPLETED', completedAt: new Date(now - 31 * DAY) });
    const mine = await make({ senderUserId: w.users.adminA });
    const approve = await make({
      status: 'NEEDS_APPROVAL',
      recipients: [approverOf(w.users.adminA)],
    });
    await make({ status: 'NEEDS_APPROVAL', recipients: [approverOf(w.users.adminA, 'APPROVED')] });
    expect(await ids(owner, { quickFilter: 'EXPIRING_SOON' })).toEqual([soon]);
    expect(await ids(owner, { quickFilter: 'AWAITING_SIGNATURE' })).toEqual(sorted(soon, later));
    expect(await ids(owner, { quickFilter: 'RECENTLY_COMPLETED' })).toEqual([recent]);
    expect(await ids(admin, { quickFilter: 'MY_REQUESTS' })).toEqual([mine]);
    expect(await ids(admin, { quickFilter: 'NEEDS_MY_APPROVAL' })).toEqual([approve]);
    // AND: a status outside the quick filter, or another sender, matches nothing.
    expect(await ids(owner, { quickFilter: 'AWAITING_SIGNATURE', status: 'DRAFT' })).toEqual([]);
    expect(await ids(owner, { quickFilter: 'AWAITING_SIGNATURE', status: 'SENT' })).toEqual([
      later,
    ]);
    expect(await ids(admin, { quickFilter: 'MY_REQUESTS', senderId: w.users.ownerA })).toEqual([]);
  });
});

describe('the cursor', () => {
  it('pages newest activity first without gaps or repeats, ties by id', async () => {
    const same = new Date('2026-10-01T10:00:00.000Z');
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push(await make({ lastActivityAt: same }));
    const newest = await make({ lastActivityAt: new Date('2026-10-02T10:00:00.000Z') });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = EsignRequestList.parse(await list(owner, { limit: 2, cursor }));
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen[0]).toBe(newest);
    expect(seen.slice(1)).toEqual([...made].sort().reverse());
  });

  it('answers no next cursor on the last page, and 400 for a bad one', async () => {
    await make();
    expect((await list(owner, { limit: 1 })).nextCursor).toBeNull();
    for (const cursor of [
      'nope',
      Buffer.from('x|y').toString('base64url'),
      Buffer.from(`2026-10-01T00:00:00.000Z|${randomUUID()}|x`).toString('base64url'),
    ]) {
      expect(await refused(list(owner, { cursor }))).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});

describe('the counters', () => {
  it('folds DELIVERED into SENT and counts the quick filters', async () => {
    const statuses: EsignRequestStatus[] = [
      'DRAFT',
      'SENT',
      'DELIVERED',
      'VIEWED',
      'COMPLETED',
      'VOIDED',
    ];
    for (const status of statuses) await make({ status });
    await make({ status: 'PARTIALLY_SIGNED', expiresAt: new Date(Date.now() + DAY) });
    await make({ status: 'COMPLETED', completedAt: new Date() });
    await make({ status: 'NEEDS_APPROVAL', recipients: [approverOf(w.users.ownerA)] });
    const summary = EsignSummary.parse(await lists.summary(w.a, owner));
    expect(summary.counts).toEqual({
      DRAFT: 1,
      NEEDS_APPROVAL: 1,
      SENT: 2,
      VIEWED: 1,
      PARTIALLY_SIGNED: 1,
      COMPLETED: 2,
      DECLINED: 0,
      EXPIRED: 0,
      VOIDED: 1,
    });
    expect(summary.quickFilters).toEqual({
      AWAITING_SIGNATURE: 4,
      EXPIRING_SOON: 1,
      RECENTLY_COMPLETED: 1,
      MY_REQUESTS: 9,
      NEEDS_MY_APPROVAL: 1,
    });
    expect(w.audit.entries).toEqual([]);
  });
});

describe('allowedActions and nextAction', () => {
  const sentAt = new Date();
  const actions = (
    status: EsignRequestStatus,
    recipients: EsignRecipientRecord[] = [],
    actor: EsignActor | null = owner,
    approverOnly = false,
  ) =>
    allowedActions(
      { status, sentAt: status === 'DRAFT' || status === 'NEEDS_APPROVAL' ? null : sentAt },
      recipients,
      actor,
      approverOnly,
    );

  it('follows the status and the caller', () => {
    expect(actions('DRAFT')).toEqual(['EDIT', 'DISCARD', 'SEND']);
    expect(actions('DRAFT', [approverOf(w.users.adminA)])).toEqual([
      'EDIT',
      'DISCARD',
      'SUBMIT_FOR_APPROVAL',
    ]);
    expect(actions('DRAFT', [approverOf(w.users.adminA, 'APPROVED')])).toEqual([
      'EDIT',
      'DISCARD',
      'SEND',
    ]);
    expect(actions('NEEDS_APPROVAL', [approverOf(w.users.ownerA)])).toEqual(['APPROVE', 'VOID']);
    expect(actions('NEEDS_APPROVAL', [approverOf(w.users.adminA)])).toEqual(['VOID']);
    expect(actions('DELIVERED')).toEqual(['REMIND', 'VOID', 'CORRECT', 'REPLACE', 'DOWNLOAD']);
    expect(actions('VIEWED', [person('Fake Kiosk', { delivery: 'IN_PERSON' })])).toEqual([
      'REMIND',
      'VOID',
      'CORRECT',
      'REPLACE',
      'DOWNLOAD',
      'START_IN_PERSON',
    ]);
    expect(actions('COMPLETED')).toEqual(['RESEND_COPY', 'DOWNLOAD']);
    expect(actions('EXPIRED')).toEqual(['DOWNLOAD']);
    expect(actions('VOIDED', [], owner)).toEqual(['DOWNLOAD']);
    expect(allowedActions({ status: 'VOIDED', sentAt: null }, [], owner, false)).toEqual([]);
    expect(actions('VIEWED', [], viewer)).toEqual(['DOWNLOAD']);
    expect(actions('DRAFT', [], viewer)).toEqual([]);
    expect(actions('NEEDS_APPROVAL', [approverOf(w.users.managerA)], manager, true)).toEqual([
      'APPROVE',
    ]);
    expect(actions('COMPLETED', [approverOf(w.users.managerA, 'APPROVED')], manager, true)).toEqual(
      ['DOWNLOAD'],
    );
  });

  it('waits on the sender, the approvers left, or the signers whose turn it is', () => {
    const approvers = [
      approverOf(w.users.adminA, 'APPROVED'),
      { ...approverOf(w.users.ownerA), name: 'Fake Owner' },
    ];
    expect(nextAction('DRAFT', approvers)).toEqual({ kind: 'FINISH_DRAFT', waitingOn: [] });
    expect(nextAction('NEEDS_APPROVAL', approvers)).toEqual({
      kind: 'AWAIT_APPROVAL',
      waitingOn: ['Fake Owner'],
    });
    const signers = [
      person('Fake Second', { routingOrder: 2, status: 'VIEWED' }),
      person('Fake First', { routingOrder: 1, status: 'SIGNED' }),
      person('Fake Third', { routingOrder: 3 }),
    ];
    expect(nextAction('PARTIALLY_SIGNED', signers)).toEqual({
      kind: 'AWAIT_SIGNATURE',
      waitingOn: ['Fake Second'],
    });
    expect(nextAction('COMPLETED', signers)).toEqual({ kind: 'NONE', waitingOn: [] });
  });

  it('puts them on the list’s rows', async () => {
    const r = person('Fake Signer', { status: 'SIGNED' });
    await make({
      status: 'PARTIALLY_SIGNED',
      clientId: w.ids.c1,
      recipients: [r, person('Fake Next', { routingOrder: 2, status: 'SENT' })],
    });
    const [row] = (await list(owner)).items;
    expect(row).toMatchObject({
      client: { id: w.ids.c1, displayName: 'Fake Client One' },
      sender: { userId: w.users.ownerA, name: 'owner-a' },
      signerNames: ['Fake Signer', 'Fake Next'],
      signedCount: 1,
      signerCount: 2,
      nextAction: { kind: 'AWAIT_SIGNATURE', waitingOn: ['Fake Next'] },
      allowedActions: ['REMIND', 'VOID', 'CORRECT', 'REPLACE', 'DOWNLOAD'],
    });
  });
});

describe('the timeline', () => {
  const event = (over: Partial<EsignEventRecord> = {}): EsignEventRecord => ({
    id: randomUUID(),
    type: 'SIGNED',
    createdAt: new Date('2026-10-02T10:00:00.000Z'),
    actorKind: 'SIGNER',
    actorName: 'Fake Signer',
    recipient: { id: randomUUID(), name: 'Fake Signer' },
    reason: null,
    authMethod: 'EMAIL_CODE',
    ...over,
  });

  it('answers the events with their auth method and nothing else a row holds', async () => {
    const id = await make({ clientId: w.ids.c1 });
    const stored = [
      event({
        type: 'CREATED',
        actorKind: 'STAFF',
        actorName: 'owner-a',
        recipient: null,
        authMethod: null,
      }),
      // Whatever else a row may carry (a field value, file text) never leaves the API.
      Object.assign(event(), { metadata: { value: 'Fake secret value' }, fieldValues: ['x'] }),
    ];
    w.repo.timelines.of(w.a).set(id, stored);
    const res = EsignEventList.parse(await lists.events(w.a, staff, id));
    expect(res.items.map((e) => [e.type, e.authMethod])).toEqual([
      ['CREATED', null],
      ['SIGNED', 'EMAIL_CODE'],
    ]);
    expect(JSON.stringify(await lists.events(w.a, owner, id))).not.toMatch(
      /secret|fieldValues|metadata/,
    );
  });

  it('is 404 across firms and for a client the caller is not assigned', async () => {
    const id = await make({ clientId: w.ids.c1 });
    w.repo.timelines.of(w.a).set(id, [event()]);
    expect(await refused(lists.events(w.b, { userId: w.users.ownerB, role: 'OWNER' }, id))).toEqual(
      [404, 'NOT_FOUND'],
    );
    expect(await refused(lists.events(w.a, staff2, id))).toEqual([404, 'NOT_FOUND']);
    expect(await refused(lists.events(w.a, owner, randomUUID()))).toEqual([404, 'NOT_FOUND']);
    // An approver reads it whatever the assignment.
    w.repo.seed(w.a, id, (row) => (row.parts.recipients = [approverOf(w.users.managerA)]));
    expect((await lists.events(w.a, manager, id)).items).toHaveLength(1);
    expect(await w.repo.events(w.b, id)).toEqual([]);
  });
});
