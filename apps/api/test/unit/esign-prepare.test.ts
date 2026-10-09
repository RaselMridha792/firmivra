// R13 step 6, requests API part 2a: a DRAFT's fields (PUT), its merge values and its readiness
// on the in-memory ports (esign-fakes.ts): each field rule (kept and unknown ids, signers only,
// pages of the plan, merge keys on text-like types), approvals cleared by an edit, the client's
// merge values only while the caller still sees the client, every readiness code through R18's
// rules plus APPROVER_MISSING, and the access rules (cross-firm and unassigned Staff 404, an
// approver reads). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type EsignField,
  EsignMergeKey,
  EsignMergeValues,
  type EsignPutField,
  EsignPutFieldsBody,
  EsignReadiness,
  type EsignReadinessCode,
} from '@firmivra/types';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
} from '../../src/esign/requests/esign.repository.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { ESIGN_TEST_DEFAULTS, esignWorld, type EsignWorld, fakeHasher } from './esign-fakes.js';

let w: EsignWorld;
let requests: EsignRequestsService;
let svc: EsignPrepareService;
let owner: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;
let manager: EsignActor;

beforeEach(() => {
  w = esignWorld();
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  svc = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  staff2 = { userId: w.users.staffA2, role: 'STAFF' };
  manager = { userId: w.users.managerA, role: 'MANAGER' };
});

async function refused(work: Promise<unknown>): Promise<[number, string, string?]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code: string; details?: { path: string }[] };
    return [error.getStatus(), body.code, body.details?.[0]?.path];
  }
  throw new Error('expected a refusal');
}

const doc = (pageCount = 2): EsignDocumentRecord => ({
  id: randomUUID(),
  position: 0,
  fileName: 'letter.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  pageCount,
  pageSizes: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })),
  sourceDocumentId: null,
  scanStatus: 'CLEAN',
  createdAt: new Date(),
  s3Key: `tenant/${w.a}/esign/x/0`,
  sha256: '0'.repeat(64),
});

const recipient = (extra: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
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

const field = (recipientId: string | null, extra: Partial<EsignField> = {}): EsignField => ({
  id: randomUUID(),
  recipientId,
  type: recipientId ? 'SIGNATURE' : 'TEXT',
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
  value: recipientId ? null : 'prefilled',
  filled: false,
  ...extra,
});

/** A DRAFT for c1 (assigned to staff) that is ready to send: one file, one signer, one field. */
async function readyDraft(actor: EsignActor = owner, clientId = w.ids.c1, service = w.ids.e1) {
  const { id } = await requests.create(w.a, actor, {
    title: 'Engagement letter 2025',
    source: 'CLIENT_RECORD',
    clientId,
    engagementId: service,
  });
  const signer = recipient();
  const file = doc();
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [file];
    row.parts.pagePlan = [0, 1].map((page) => ({ documentId: file.id, page, rotation: 0 }));
    row.parts.recipients = [signer];
    row.parts.fields = [field(signer.id)];
  });
  return { id, signer, file };
}

const put = (fields: EsignPutField[]) => EsignPutFieldsBody.parse({ fields });
const signatureFor = (recipientId: string, extra: Partial<EsignPutField> = {}): EsignPutField => ({
  recipientId,
  type: 'SIGNATURE',
  pageIndex: 1,
  x: 0.5,
  y: 0.5,
  w: 0.2,
  h: 0.05,
  ...extra,
});
const senderText = (extra: Partial<EsignPutField> = {}): EsignPutField => ({
  recipientId: null,
  type: 'TEXT',
  pageIndex: 0,
  x: 0.1,
  y: 0.8,
  w: 0.3,
  h: 0.05,
  mergeKey: 'CLIENT_FULL_NAME',
  ...extra,
});

describe('PUT /esign/requests/{id}/fields', () => {
  it('replaces the list, keeping existing ids and giving new fields new ones', async () => {
    const { id, signer } = await readyDraft();
    const [old] = (await w.repo.parts(w.a, id)).fields;
    const detail = await svc.putFields(
      w.a,
      owner,
      id,
      put([signatureFor(signer.id, { id: old!.id }), senderText()]),
    );
    expect(detail.fields).toHaveLength(2);
    expect(detail.fields[0]).toMatchObject({ id: old!.id, pageIndex: 1, required: true });
    expect(detail.fields[1]).toMatchObject({
      recipientId: null,
      mergeKey: 'CLIENT_FULL_NAME',
      value: null,
      label: null,
      filled: false,
    });
    expect(detail.fields[1]!.id).not.toBe(old!.id);
    // An empty list removes every field.
    expect((await svc.putFields(w.a, owner, id, put([]))).fields).toEqual([]);
  });

  it('answers 400 VALIDATION_FAILED for an unknown id, a non-signer, a page off the plan', async () => {
    const { id, signer } = await readyDraft();
    const cc = recipient({ kind: 'CC', id: randomUUID() });
    const approver = recipient({
      kind: 'APPROVER',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    w.repo.seed(w.a, id, (row) => row.parts.recipients.push(cc, approver));
    const cases: [EsignPutField, string][] = [
      [signatureFor(signer.id, { id: randomUUID() }), 'fields.0.id'],
      [signatureFor(cc.id), 'fields.0.recipientId'],
      [signatureFor(approver.id), 'fields.0.recipientId'],
      [signatureFor(randomUUID()), 'fields.0.recipientId'],
      [signatureFor(signer.id, { pageIndex: 2 }), 'fields.0.pageIndex'],
    ];
    for (const [input, path] of cases) {
      expect(await refused(svc.putFields(w.a, owner, id, put([input])))).toEqual([
        400,
        'VALIDATION_FAILED',
        path,
      ]);
    }
    // Nothing changed.
    expect((await w.repo.parts(w.a, id)).fields).toHaveLength(1);
  });

  it('takes merge keys on text-like fields only', async () => {
    const { id } = await readyDraft();
    for (const type of ['TEXT', 'PRINTED_NAME', 'EMAIL', 'PHONE', 'ADDRESS'] as const) {
      const detail = await svc.putFields(w.a, owner, id, put([senderText({ type })]));
      expect(detail.fields[0]).toMatchObject({ type, mergeKey: 'CLIENT_FULL_NAME' });
    }
    const checkbox = senderText({ type: 'CHECKBOX' });
    const dropdown = senderText({ type: 'DROPDOWN', options: ['A', 'B'] });
    const radio = senderText({ type: 'RADIO', options: ['A'], groupKey: 'g1' });
    for (const input of [checkbox, dropdown, radio]) {
      expect(await refused(svc.putFields(w.a, owner, id, put([input])))).toEqual([
        400,
        'VALIDATION_FAILED',
        'fields.0.mergeKey',
      ]);
    }
    // A sender's checkbox with a value is fine.
    const ticked = senderText({ type: 'CHECKBOX', mergeKey: undefined, value: 'true' });
    expect((await svc.putFields(w.a, owner, id, put([ticked]))).fields[0]?.value).toBe('true');
  });

  it('clears approvals like every DRAFT edit, and audits counts only', async () => {
    const { id, signer } = await readyDraft();
    const approver = recipient({
      kind: 'APPROVER',
      status: 'APPROVED',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    w.repo.seed(w.a, id, (row) => row.parts.recipients.push(approver));
    const label = 'Synthetic label';
    await svc.putFields(w.a, owner, id, put([signatureFor(signer.id, { label })]));
    const after = (await w.repo.parts(w.a, id)).recipients.find((r) => r.id === approver.id);
    expect(after?.status).toBe('WAITING');
    const entry = w.audit.entries.at(-1)!;
    expect(entry).toMatchObject({
      action: 'esign.fields_updated',
      entity: { type: 'esign_request', id },
      metadata: { fieldCount: 1, fieldsRemoved: 1 },
    });
    expect(JSON.stringify(entry)).not.toContain(label);
  });

  it('is DRAFT only (409 INVALID_STATE, also when a send wins the race)', async () => {
    const { id, signer } = await readyDraft();
    w.repo.loseNextWrite = true;
    const body = put([signatureFor(signer.id)]);
    expect(await refused(svc.putFields(w.a, owner, id, body))).toEqual([
      409,
      'INVALID_STATE',
      undefined,
    ]);
    w.repo.seed(w.a, id, (row) => (row.record.status = 'SENT'));
    expect(await refused(svc.putFields(w.a, owner, id, body))).toEqual([
      409,
      'INVALID_STATE',
      undefined,
    ]);
  });

  it('is 404 for another firm and for Staff on an unassigned client', async () => {
    const { id, signer } = await readyDraft();
    const body = put([signatureFor(signer.id)]);
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    expect((await refused(svc.putFields(w.b, ownerB, id, body)))[0]).toBe(404);
    expect((await refused(svc.putFields(w.a, staff2, id, body)))[0]).toBe(404);
    // The assigned Staff member may.
    expect((await svc.putFields(w.a, staff, id, body)).fields).toHaveLength(1);
  });
});

describe('GET /esign/requests/{id}/merge-values', () => {
  it('gives all 17 values from the client, the sender and the firm', async () => {
    const { id } = await readyDraft(staff);
    const merge = EsignMergeValues.parse(await svc.mergeValues(w.a, owner, id));
    expect(Object.keys(merge.values).sort()).toEqual([...EsignMergeKey.options].sort());
    expect(merge.values).toMatchObject({
      CLIENT_FIRST_NAME: 'Fake',
      CLIENT_LAST_NAME: 'Client One',
      CLIENT_FULL_NAME: 'Fake Client One',
      CLIENT_ADDRESS: '1 Sample St, Testville, NY 10001',
      BUSINESS_NAME: null,
      SPOUSE_NAME: null,
      STAFF_NAME: 'staff-a',
      STAFF_EMAIL: 'staff-a@firm.test',
      STAFF_PHONE: '+15555550100',
      STAFF_TITLE: null,
      FIRM_NAME: 'Fake Firm A',
      FIRM_ADDRESS: '2 Example Ave, Testville, NY 10002',
      FIRM_PHONE: '+15555550123',
      FIRM_EMAIL: 'office@firm.test',
    });
    expect(merge.values.CLIENT_EMAIL).toMatch(/@client\.test$/);
    expect(merge.values.CURRENT_DATE).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    // No field uses a merge key yet.
    expect(merge.missing).toEqual([]);
  });

  it('flags the keys the fields use that have no value', async () => {
    const { id } = await readyDraft();
    w.repo.seed(w.a, id, (row) => {
      row.parts.fields.push(
        field(null, { mergeKey: 'BUSINESS_NAME', value: null }),
        field(null, { mergeKey: 'STAFF_TITLE', value: null }),
        field(null, { mergeKey: 'CLIENT_EMAIL', value: null }),
      );
    });
    expect((await svc.mergeValues(w.a, owner, id)).missing).toEqual([
      'BUSINESS_NAME',
      'STAFF_TITLE',
    ]);
  });

  it('derives business and spouse names, and full name from the display name', async () => {
    const { id } = await readyDraft();
    const contact = w.directory.contacts.of(w.a).get(w.ids.c1)!;
    Object.assign(contact, {
      accountType: 'BUSINESS',
      firstName: null,
      lastName: null,
      spouseName: 'Fake Spouse',
    });
    const { values } = await svc.mergeValues(w.a, owner, id);
    expect(values).toMatchObject({
      CLIENT_FULL_NAME: 'Fake Client One',
      BUSINESS_NAME: 'Fake Client One',
      SPOUSE_NAME: 'Fake Spouse',
      CLIENT_FIRST_NAME: null,
    });
  });

  it('gives the client’s values only while the caller still sees the client', async () => {
    const { id } = await readyDraft(staff);
    w.repo.seed(w.a, id, (row) => {
      row.parts.fields.push(field(null, { mergeKey: 'CLIENT_FULL_NAME', value: null }));
    });
    expect((await svc.mergeValues(w.a, staff, id)).values.CLIENT_FULL_NAME).toBe('Fake Client One');
    // c1 is reassigned: staff still reaches the request they sent, but not the client.
    w.directory.clients.of(w.a).get(w.ids.c1)!.assignedUserId = w.users.staffA2;
    const merge = await svc.mergeValues(w.a, staff, id);
    const clientKeys = EsignMergeKey.options.filter(
      (k) => k.startsWith('CLIENT_') || k === 'BUSINESS_NAME' || k === 'SPOUSE_NAME',
    );
    for (const key of clientKeys) expect(merge.values[key]).toBeNull();
    expect(merge.values.STAFF_NAME).toBe('staff-a');
    expect(merge.missing).toEqual(['CLIENT_FULL_NAME']);
    // The new assignee and the Owner still get them.
    expect((await svc.mergeValues(w.a, owner, id)).missing).toEqual([]);
  });

  it('has no client values without a client, and is 404 across firms and for unassigned Staff', async () => {
    const { id } = await requests.create(w.a, owner, { title: 'Fake', source: 'TAB' });
    const { values } = await svc.mergeValues(w.a, owner, id);
    expect([values.CLIENT_FULL_NAME, values.FIRM_NAME]).toEqual([null, 'Fake Firm A']);
    const ready = await readyDraft();
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    expect((await refused(svc.mergeValues(w.b, ownerB, ready.id)))[0]).toBe(404);
    expect((await refused(svc.mergeValues(w.a, staff2, ready.id)))[0]).toBe(404);
  });
});

describe('GET /esign/requests/{id}/readiness', () => {
  const codes = async (id: string, actor = owner) => {
    const result = EsignReadiness.parse(await svc.readiness(w.a, actor, id));
    return result.problems.map((p) => p.code);
  };

  it('is ready for a complete draft, and lists what blocks an empty one', async () => {
    const { id } = await readyDraft();
    expect(await svc.readiness(w.a, owner, id)).toEqual({
      ready: true,
      problems: [],
      autoSignaturePage: false,
    });
    const empty = await requests.create(w.a, owner, { title: 'Fake', source: 'TAB' });
    const result = await svc.readiness(w.a, owner, empty.id);
    expect(result.ready).toBe(false);
    expect(result.autoSignaturePage).toBe(true);
    expect(result.problems.map((p) => p.code)).toEqual([
      'NO_DOCUMENTS',
      'NO_CLIENT',
      'NO_ENGAGEMENT',
      'NO_SIGNERS',
    ]);
  });

  it('finds every rule’s code on the stored request', async () => {
    const cases: [EsignReadinessCode, (ctx: Awaited<ReturnType<typeof readyDraft>>) => void][] = [
      ['NO_DOCUMENTS', ({ id }) => w.repo.seed(w.a, id, (r) => (r.parts.documents = []))],
      [
        'SCAN_PENDING',
        ({ id }) => w.repo.seed(w.a, id, (r) => (r.parts.documents[0]!.scanStatus = 'PENDING')),
      ],
      [
        'SCAN_BLOCKED',
        ({ id }) => w.repo.seed(w.a, id, (r) => (r.parts.documents[0]!.scanStatus = 'INFECTED')),
      ],
      ['NO_CLIENT', ({ id }) => w.repo.seed(w.a, id, (r) => (r.record.clientId = null))],
      ['NO_ENGAGEMENT', ({ id }) => w.repo.seed(w.a, id, (r) => (r.record.engagementId = null))],
      [
        'NO_SIGNERS',
        ({ id }) =>
          w.repo.seed(w.a, id, (r) => {
            r.parts.recipients = [];
            r.parts.fields = [];
          }),
      ],
      [
        'RECIPIENT_NO_CONTACT',
        ({ id }) => w.repo.seed(w.a, id, (r) => (r.parts.recipients[0]!.email = 'not-an-email')),
      ],
      [
        'ACCESS_CODE_MISSING',
        ({ id }) =>
          w.repo.seed(w.a, id, (r) => (r.parts.recipients[0]!.authMethod = 'ACCESS_CODE')),
      ],
      [
        'SIGNATURE_UNASSIGNED',
        ({ id }) => w.repo.seed(w.a, id, (r) => r.parts.fields.push(field(randomUUID()))),
      ],
      [
        'SIGNER_NO_FIELDS',
        ({ id }) => w.repo.seed(w.a, id, (r) => r.parts.recipients.push(recipient())),
      ],
      [
        'MERGE_MISSING',
        ({ id }) =>
          w.repo.seed(w.a, id, (r) =>
            r.parts.fields.push(field(null, { mergeKey: 'SPOUSE_NAME', value: null })),
          ),
      ],
      ['REMINDER_AFTER_EXPIRY', ({ id }) => w.repo.seed(w.a, id, (r) => (r.record.expiryDays = 3))],
      [
        'APPROVAL_PENDING',
        ({ id }) =>
          w.repo.seed(w.a, id, (r) =>
            r.parts.recipients.push(
              recipient({ kind: 'APPROVER', link: { type: 'STAFF', userId: w.users.managerA } }),
            ),
          ),
      ],
      [
        'APPROVER_MISSING',
        () =>
          w.repo.firmDefaults.set(w.a, {
            ...structuredClone(ESIGN_TEST_DEFAULTS),
            requireApproval: true,
          }),
      ],
      ['NO_CONSENT', () => w.repo.consent.delete(w.a)],
    ];
    for (const [code, change] of cases) {
      w = esignWorld();
      requests = new EsignRequestsService(
        w.repo,
        w.directory,
        w.modules,
        w.store,
        w.audit,
        fakeHasher,
      );
      svc = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
      owner = { userId: w.users.ownerA, role: 'OWNER' };
      const ctx = await readyDraft();
      change(ctx);
      const found = await codes(ctx.id);
      expect(found, code).toEqual([code]);
    }
  });

  it('adds APPROVER_MISSING only while Signing Settings ask for approval and no approver is on it', async () => {
    const { id } = await readyDraft();
    w.repo.firmDefaults.set(w.a, {
      ...structuredClone(ESIGN_TEST_DEFAULTS),
      requireApproval: true,
    });
    const result = await svc.readiness(w.a, owner, id);
    expect(result.ready).toBe(false);
    expect(result.problems).toEqual([
      {
        code: 'APPROVER_MISSING',
        recipientId: null,
        fieldId: null,
        documentId: null,
        mergeKey: null,
      },
    ]);
    const approver = recipient({
      kind: 'APPROVER',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    w.repo.seed(w.a, id, (r) => r.parts.recipients.push(approver));
    expect(await codes(id)).toEqual(['APPROVAL_PENDING']);
    w.repo.seed(w.a, id, (r) => (r.parts.recipients.at(-1)!.status = 'APPROVED'));
    expect((await svc.readiness(w.a, owner, id)).ready).toBe(true);
    // Another firm's setting is its own.
    expect(w.repo.firmDefaults.has(w.b)).toBe(false);
  });

  it('flags MERGE_MISSING for a Staff sender who no longer sees the client', async () => {
    const { id } = await readyDraft(staff);
    w.repo.seed(w.a, id, (r) =>
      r.parts.fields.push(field(null, { mergeKey: 'CLIENT_EMAIL', value: null })),
    );
    expect(await codes(id, staff)).toEqual([]);
    w.directory.clients.of(w.a).get(w.ids.c1)!.assignedUserId = null;
    const result = await svc.readiness(w.a, staff, id);
    expect(result.problems).toEqual([
      expect.objectContaining({ code: 'MERGE_MISSING', mergeKey: 'CLIENT_EMAIL' }),
    ]);
  });

  it('lets an approver read it; another firm and unassigned Staff get 404', async () => {
    // c2 is assigned to nobody: the Manager reaches it only as its approver.
    const { id } = await readyDraft(owner, w.ids.c2, w.ids.e2);
    expect((await refused(svc.readiness(w.a, manager, id)))[0]).toBe(404);
    const approver = recipient({
      kind: 'APPROVER',
      link: { type: 'STAFF', userId: w.users.managerA },
    });
    w.repo.seed(w.a, id, (r) => r.parts.recipients.push(approver));
    expect(await codes(id, manager)).toEqual(['APPROVAL_PENDING']);
    const ownerB: EsignActor = { userId: w.users.ownerB, role: 'OWNER' };
    expect((await refused(svc.readiness(w.b, ownerB, id)))[0]).toBe(404);
    expect((await refused(svc.readiness(w.a, staff2, id)))[0]).toBe(404);
    expect((await refused(svc.readiness(w.a, staff, id)))[0]).toBe(404);
  });
});
