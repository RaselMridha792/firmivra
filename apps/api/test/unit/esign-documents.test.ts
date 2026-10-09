// R13 step 6, requests API part 1d: a DRAFT's files on the in-memory ports (esign-fakes.ts),
// R18's in-memory store and a fake PDF engine: uploads (ticket, confirm and its refusals) and
// removal; access (cross-firm, cross-client and approver-only 404s) and an audit of ids only.
// Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EsignDocument, type EsignField, UploadTicket } from '@firmivra/types';
import { EsignDocumentsService } from '../../src/esign/requests/documents.service.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import { esignWorld, type EsignWorld, fakeHasher, fakePdf } from './esign-fakes.js';

let w: EsignWorld;
let requests: EsignRequestsService;
let docs: EsignDocumentsService;
let owner: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;
const ownerB = (): EsignActor => ({ userId: w.users.ownerB, role: 'OWNER' });

beforeEach(() => {
  w = esignWorld();
  requests = new EsignRequestsService(w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher);
  docs = new EsignDocumentsService(requests, w.repo, w.store, fakePdf, w.audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  staff2 = { userId: w.users.staffA2, role: 'STAFF' };
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

const bytesOf = (text: string) => new Uint8Array(Buffer.from(text));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const draft = async (actor: EsignActor = owner, clientId: string | null = w.ids.c1) =>
  (
    await requests.create(w.a, actor, {
      title: 'Fake letter',
      source: 'TAB',
      clientId: clientId ?? undefined,
    })
  ).id;

/** Step 1 for `content`, as a PDF unless named otherwise. */
async function start(id: string, content: Uint8Array, actor = owner, type = 'application/pdf') {
  const contentType = type as 'application/pdf';
  const fileName = type === 'image/png' ? 'scan.png' : 'letter.pdf';
  const body = { fileName, contentType, sizeBytes: content.byteLength, sha256: sha(content) };
  const ticket = UploadTicket.parse(await docs.createUpload(w.a, actor, id, body));
  return { ticket, key: ticket.url.replace('memory://', ''), contentType };
}

/** Steps 1 and 2: the PUT stores `stored` (the described file unless given). */
async function uploaded(
  id: string,
  content: Uint8Array,
  stored = content,
  type?: string,
  actor = owner,
) {
  const s = await start(id, content, actor, type);
  await w.store.put(w.a, s.key, stored, s.contentType);
  return s;
}

const confirm = (id: string, token: string, actor = owner) =>
  docs.confirmUpload(w.a, actor, id, token);

describe('uploads', () => {
  it('tickets a PUT under the request’s folder and confirms a PDF as PENDING with its pages', async () => {
    const id = await draft();
    const before = Date.now();
    const { ticket, key } = await uploaded(id, bytesOf('pdf:3'));
    expect(key).toMatch(new RegExp(`^tenant/${w.a}/esign/${id}/source/[0-9a-f-]{36}$`));
    expect(ticket.method).toBe('PUT');
    expect(ticket.headers['content-type']).toBe('application/pdf');
    const expires = Date.parse(ticket.expiresAt) - before;
    expect(expires).toBeGreaterThanOrEqual(240_000);
    expect(expires).toBeLessThan(250_000);

    const doc = EsignDocument.parse(await confirm(id, ticket.uploadToken));
    expect(doc).toMatchObject({
      id: key.slice(key.lastIndexOf('/') + 1),
      position: 0,
      fileName: 'letter.pdf',
      pageCount: 3,
      scanStatus: 'PENDING',
      sourceDocumentId: null,
    });
    const image = await uploaded(id, bytesOf('fake png'), undefined, 'image/png');
    expect(await confirm(id, image.ticket.uploadToken)).toMatchObject({
      position: 1,
      pageCount: 1,
    });
    const detail = await requests.get(w.a, owner, id);
    expect(detail.pagePlan.map((p) => [p.documentId === doc.id, p.page])).toEqual([
      [true, 0],
      [true, 1],
      [true, 2],
      [false, 0],
    ]);
    // A token is used once.
    expect(await refused(confirm(id, ticket.uploadToken))).toEqual([410, 'UPLOAD_EXPIRED']);
    // Ids only: never the file name or the token.
    const audit = JSON.stringify(w.audit.entries);
    expect(audit).not.toContain('letter.pdf');
    expect(audit).not.toContain(ticket.uploadToken);
    expect(w.audit.entries.map((e) => e.action)).toEqual([
      'esign.request_created',
      'esign.upload_started',
      'esign.document_added',
      'esign.upload_started',
      'esign.document_added',
      'esign.request_viewed',
    ]);
  });

  it('refuses a stored file that is not the described one (409 UPLOAD_MISMATCH) and deletes it', async () => {
    const id = await draft();
    const content = bytesOf('pdf:2');
    const missing = await start(id, content);
    expect(await refused(confirm(id, missing.ticket.uploadToken))).toEqual([
      409,
      'UPLOAD_MISMATCH',
    ]);
    const cases = [
      { stored: bytesOf('pdf:20') }, // another size
      { stored: bytesOf('pdf:3') }, // same size, other bytes
      { stored: content, type: 'image/png' }, // another type
    ];
    for (const c of cases) {
      const s = await start(id, content);
      await w.store.put(w.a, s.key, c.stored, c.type ?? 'application/pdf');
      expect(await refused(confirm(id, s.ticket.uploadToken))).toEqual([409, 'UPLOAD_MISMATCH']);
      expect(await w.store.head(w.a, s.key)).toBeNull();
    }
    expect((await requests.get(w.a, owner, id)).documents).toEqual([]);
  });

  it('answers 410 UPLOAD_EXPIRED for an old, unknown, other firm’s, request’s or person’s token', async () => {
    const id = await draft();
    const other = await draft();
    const content = bytesOf('pdf:1');
    const old = await uploaded(id, content);
    for (const u of w.repo.uploads.of(w.a).values()) u.createdAt = new Date(Date.now() - 901_000);
    expect(await refused(confirm(id, old.ticket.uploadToken))).toEqual([410, 'UPLOAD_EXPIRED']);
    expect(await w.store.head(w.a, old.key)).toBeNull();
    expect(await refused(confirm(id, 'no-such-token'))).toEqual([410, 'UPLOAD_EXPIRED']);

    const s = await uploaded(id, content);
    expect(await refused(confirm(other, s.ticket.uploadToken))).toEqual([410, 'UPLOAD_EXPIRED']);
    const otherPerson: EsignActor = { userId: w.users.adminA, role: 'ADMIN' };
    expect(await refused(confirm(id, s.ticket.uploadToken, otherPerson))).toEqual([
      410,
      'UPLOAD_EXPIRED',
    ]);
    // Firm B's token on firm B's request never opens firm A's, and the reverse.
    const idB = (await requests.create(w.b, ownerB(), { title: 'B', source: 'TAB' })).id;
    const ticketB = await docs.createUpload(w.b, ownerB(), idB, {
      fileName: 'b.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.byteLength,
      sha256: sha(content),
    });
    expect(await refused(confirm(id, ticketB.uploadToken))).toEqual([410, 'UPLOAD_EXPIRED']);
    expect(await refused(docs.confirmUpload(w.b, ownerB(), idB, s.ticket.uploadToken))).toEqual([
      410,
      'UPLOAD_EXPIRED',
    ]);
    // Still good for its own request and person.
    expect(await confirm(id, s.ticket.uploadToken)).toMatchObject({ pageCount: 1 });
  });

  it('refuses encrypted and unreadable PDFs and a packet over 100 pages, deleting the file', async () => {
    const id = await draft();
    const cases: [string, string][] = [
      ['encrypted', 'PDF_ENCRYPTED'],
      ['garbage!!', 'PDF_UNREADABLE'],
      ['pdf:101', 'TOO_MANY_PAGES'],
    ];
    for (const [text, code] of cases) {
      const s = await uploaded(id, bytesOf(text));
      expect(await refused(confirm(id, s.ticket.uploadToken))).toEqual([409, code]);
      expect(await w.store.head(w.a, s.key)).toBeNull();
    }
    // The total counts: 98 pages, then 3 more is too many; 2 more fits.
    await confirm(id, (await uploaded(id, bytesOf('pdf:98'))).ticket.uploadToken);
    const three = await uploaded(id, bytesOf('pdf:3'));
    expect(await refused(confirm(id, three.ticket.uploadToken))).toEqual([409, 'TOO_MANY_PAGES']);
    await confirm(id, (await uploaded(id, bytesOf('pdf:2'))).ticket.uploadToken);
    expect((await requests.get(w.a, owner, id)).pagePlan).toHaveLength(100);
  });

  it('works on DRAFTs the caller reaches only, and resets approvals', async () => {
    const id = await draft(staff);
    const content = bytesOf('pdf:1');
    expect(await refused(start(id, content, staff2))).toEqual([404, 'NOT_FOUND']);
    expect(
      await refused(
        docs.createUpload(w.b, ownerB(), id, {
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 5,
          sha256: sha(content),
        }),
      ),
    ).toEqual([404, 'NOT_FOUND']);
    await requests.putRecipients(w.a, staff, id, {
      recipients: [
        {
          kind: 'APPROVER',
          role: 'MANAGER',
          routingOrder: 1,
          who: { type: 'STAFF', userId: w.users.managerA },
          delivery: 'EMAIL',
          authMethod: 'EMAIL_CODE',
        },
      ],
    });
    w.repo.seed(w.a, id, (row) => {
      for (const r of row.parts.recipients) r.status = 'APPROVED';
    });
    const s = await uploaded(id, content, content, undefined, staff);
    await docs.confirmUpload(w.a, staff, id, s.ticket.uploadToken);
    const { recipients, documents } = await requests.get(w.a, staff, id);
    expect(recipients[0]?.status).toBe('WAITING');
    // The approver may read the request, but uploads, confirm and remove are writes: 404.
    const manager: EsignActor = { userId: w.users.managerA, role: 'MANAGER' };
    const token = (await start(id, content, staff)).ticket.uploadToken;
    for (const work of [
      start(id, content, manager),
      docs.confirmUpload(w.a, manager, id, token),
      docs.removeDocument(w.a, manager, id, documents[0]!.id),
    ]) {
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    w.repo.seed(w.a, id, (row) => {
      row.record.status = 'SENT';
    });
    expect(await refused(start(id, content, staff))).toEqual([409, 'INVALID_STATE']);
  });
});

describe('removing a file', () => {
  it('drops its pages and their fields, re-indexes the rest and deletes the stored file', async () => {
    const id = await draft();
    const first = await confirm(id, (await uploaded(id, bytesOf('pdf:2'))).ticket.uploadToken);
    const second = await confirm(id, (await uploaded(id, bytesOf('pdf:1'))).ticket.uploadToken);
    const field = (pageIndex: number): EsignField => ({
      id: randomUUID(),
      recipientId: null,
      type: 'TEXT',
      pageIndex,
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.05,
      required: false,
      label: null,
      mergeKey: null,
      options: [],
      groupKey: null,
      value: 'prefilled',
      filled: false,
    });
    const kept = field(2);
    w.repo.seed(w.a, id, (row) => {
      row.parts.fields = [field(0), field(1), kept];
    });
    const detail = await docs.removeDocument(w.a, owner, id, first.id);
    expect(detail.documents.map((d) => d.id)).toEqual([second.id]);
    expect(detail.pagePlan).toEqual([{ documentId: second.id, page: 0, rotation: 0 }]);
    expect(detail.fields).toEqual([{ ...kept, pageIndex: 0 }]);
    expect(w.store.removed).toEqual([
      { businessId: w.a, key: `tenant/${w.a}/esign/${id}/source/${first.id}` },
    ]);
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.document_removed',
      entity: { type: 'esign_request', id },
      metadata: { documentId: first.id, pagesRemoved: 2, fieldsRemoved: 2 },
    });
    expect(await refused(docs.removeDocument(w.a, owner, id, first.id))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(docs.removeDocument(w.a, staff2, id, second.id))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(docs.removeDocument(w.b, ownerB(), id, second.id))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    w.repo.seed(w.a, id, (row) => {
      row.record.status = 'SENT';
    });
    expect(await refused(docs.removeDocument(w.a, owner, id, second.id))).toEqual([
      409,
      'INVALID_STATE',
    ]);
  });
});
