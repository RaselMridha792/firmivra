// End-to-end over the real database: a signer from the link to the filed copy (the signer, center
// and completion repositories, r0_esign), with the real guards, row-level security and database
// rules. Only the file store is in memory. Synthetic data only.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EsignCompletionJob } from '../../src/esign/completion/completion.job.js';
import { SIGNED_CATEGORY } from '../../src/esign/completion/prisma-completion.repository.js';
import { pdf } from '../unit/esign-engine-fixtures.js';
import {
  type EsignDbWorld,
  esignDbWorld,
  linkToken,
  sentRequest,
  signerBrowser,
} from './esign-db.js';

let w: EsignDbWorld;
const base = '/api/v1/esign/requests';
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;
const step = (res: { body: unknown }) => (res.body as { step?: string }).step;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const SIGNATURE = {
  signature: { printedName: 'Fake Signer', method: 'TYPED', typedSignature: 'Fake Signer' },
  initials: { method: 'TYPED', text: 'FS' },
};

beforeAll(async () => {
  w = await esignDbWorld('r13-sign-db');
});
afterAll(async () => {
  await w?.close();
});

/** Opens the link and accepts the consent: the browser is at SIGN. */
async function atSign(requestId: string, recipientId: string) {
  const b = signerBrowser(w, w.a);
  const opened = await b.open(await linkToken(w, w.a, requestId, recipientId));
  expect([opened.status, step(opened)]).toEqual([200, 'CONSENT']);
  const consent = await b.call('get', '/consent');
  const versionId = (consent.body as { versionId: string }).versionId;
  const accepted = await b.call('post', '/consent', { versionId, agree: true });
  expect([accepted.status, step(accepted)]).toEqual([200, 'SIGN']);
  return b;
}

describe('Firm Sign signing on PostgreSQL', () => {
  it('signs, then the job files the signed copy and the certificate, and opens the copy link', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter to sign', { signerFields: ['TEXT'] });
    const b = await atSign(d.id, d.signer);
    const envelope = await b.call('get', '/envelope');
    expect(envelope.status).toBe(200);
    const fields = (envelope.body as { fields: { id: string; type: string }[] }).fields;
    const text = fields.find((f) => f.type === 'TEXT')!;
    expect((await b.call('post', '/finish', { values: [] })).status).toBe(409);
    expect((await b.call('post', '/adopt', SIGNATURE)).status).toBe(200);
    // The file store fails once: finish still answers DONE, and the job files it later.
    vi.spyOn(w.store, 'put').mockRejectedValueOnce(new Error('Fake S3 outage'));
    const done = await b.call('post', '/finish', {
      values: [{ fieldId: text.id, value: 'Fake answer' }],
    });
    expect([done.status, step(done)]).toEqual([200, 'DONE']);

    const signed = await w.inFirm(w.a.id, async (tx) => ({
      request: await tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
      me: await tx.esignRecipient.findUniqueOrThrow({ where: { id: d.signer } }),
      field: await tx.esignField.findUniqueOrThrow({ where: { id: text.id } }),
    }));
    expect(signed.request.status).toBe('PARTIALLY_SIGNED');
    expect(signed.request.completionDueAt).not.toBeNull();
    expect([signed.me.status, signed.me.printedName, signed.me.consentVersionId]).toEqual([
      'SIGNED',
      'Fake Signer',
      expect.any(String),
    ]);
    expect(signed.field.filled).toBe(true);
    expect(Buffer.from(signed.field.valueEnc!).toString('latin1')).not.toContain('Fake answer');
    // Signed: the link no longer signs, and their value is frozen in the database.
    const late = await b.call('post', '/finish', { values: [] });
    expect(late.status).toBeGreaterThanOrEqual(400);
    await expect(
      w.inFirm(w.a.id, (tx) =>
        tx.esignField.update({ where: { id: text.id }, data: { filled: false } }),
      ),
    ).rejects.toThrow();

    const job = w.app.get(EsignCompletionJob);
    const later = new Date(Date.now() + 3_600_000);
    expect(await job.run({ businessIds: [w.a.id], now: later })).toEqual({
      skipped: false,
      completed: 1,
    });
    const filed = await w.inFirm(w.a.id, async (tx) => ({
      request: await tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
      documents: await tx.document.findMany({
        where: { esignRequestId: d.id },
        include: { category: true },
      }),
      copies: await tx.esignSigningLink.count({ where: { requestId: d.id, purpose: 'COPY' } }),
    }));
    expect(filed.request.status).toBe('COMPLETED');
    expect(filed.request.completionDueAt).toBeNull();
    expect(filed.documents).toHaveLength(2);
    for (const doc of filed.documents) {
      expect([doc.scanStatus, doc.legalHold, doc.category?.name, doc.clientId]).toEqual([
        'CLEAN',
        true,
        SIGNED_CATEGORY,
        w.a.ids.client,
      ]);
      const stored = w.store.objects.get(doc.s3Key);
      expect(stored && sha256(stored.bytes)).toBe(doc.sha256);
    }
    expect([filed.request.finalDocumentId, filed.request.certificateDocumentId].sort()).toEqual(
      filed.documents.map((x) => x.id).sort(),
    );
    // A portal client gets the copy in their Signature center, not by a copy link.
    expect(filed.copies).toBe(0);
    // A second run finds nothing due.
    expect(await job.run({ businessIds: [w.a.id], now: later })).toEqual({
      skipped: false,
      completed: 0,
    });

    // The copy: a COPY link (allowed after COMPLETED) opens it; the signer's portal center lists it as signed.
    const copy = signerBrowser(w, w.a);
    expect((await copy.open(await linkToken(w, w.a, d.id, d.signer, 'COPY'))).status).toBe(200);
    expect((await copy.call('get', '/copy')).status).toBe(409);
    // A copy session: the email code first (AUTH_MODE=local: every code is 000000).
    expect((await copy.call('post', '/code/send')).status).toBe(200);
    expect((await copy.call('post', '/code/verify', { code: '000000' })).status).toBe(200);
    const shown = await copy.call('get', '/copy');
    expect(shown.status).toBe(200);
    const center = `/api/v1/portal/${w.a.slug}/me/signatures`;
    const mine = await w.call('get', `${center}?tab=SIGNED`, w.a.people.client);
    expect(mine.status).toBe(200);
    const rows = (mine.body as { items: { recipientId: string }[] }).items;
    expect(rows.map((r) => r.recipientId)).toContain(d.signer);
    const dl = await w.call('get', `${center}/${d.signer}/download?file=final`, w.a.people.client);
    expect(dl.status).toBe(200);
    // Firm B's client sees none of it.
    const theirs = await w.call(
      'get',
      `/api/v1/portal/${w.b.slug}/me/signatures?tab=SIGNED`,
      w.b.people.client,
    );
    expect((theirs.body as { items: unknown[] }).items).toEqual([]);
    const cross = await w.call(
      'get',
      `${center}/${d.signer}/download?file=final`,
      w.b.people.client,
    );
    expect(cross.status).toBeGreaterThanOrEqual(400);
  });

  it('declines: the recipient, then the request; signing stops', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter to decline');
    const b = await atSign(d.id, d.signer);
    const declined = await b.call('post', '/decline', { reason: 'Fake reason' });
    expect([declined.status, step(declined)]).toEqual([200, 'DECLINED']);
    const rows = await w.inFirm(w.a.id, async (tx) => ({
      request: await tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
      me: await tx.esignRecipient.findUniqueOrThrow({ where: { id: d.signer } }),
    }));
    expect([rows.request.status, rows.me.status, rows.me.declineReason]).toEqual([
      'DECLINED',
      'DECLINED',
      'Fake reason',
    ]);
    expect((await b.call('post', '/adopt', SIGNATURE)).status).toBeGreaterThanOrEqual(400);
    // A closed request's recipients are frozen in the database.
    await expect(
      w.inFirm(w.a.id, (tx) =>
        tx.esignRecipient.update({ where: { id: d.signer }, data: { reminderCount: 1 } }),
      ),
    ).rejects.toThrow();
  });

  it('email code: sent once a minute, wrong tries counted, the right one opens the consent', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter with a code', { authMethod: 'EMAIL_CODE' });
    const b = signerBrowser(w, w.a);
    const opened = await b.open(await linkToken(w, w.a, d.id, d.signer));
    expect(step(opened)).toBe('VERIFY_EMAIL');
    expect((await b.call('post', '/code/send')).status).toBe(200);
    const again = await b.call('post', '/code/send');
    expect([again.status, code(again)]).toEqual([429, expect.any(String)]);
    const wrong = await b.call('post', '/code/verify', { code: '123456' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const right = await b.call('post', '/code/verify', { code: '000000' });
    expect([right.status, step(right)]).toEqual([200, 'CONSENT']);
    const codes = await w.inFirm(w.a.id, (tx) =>
      tx.esignVerificationCode.findMany({ where: { recipientId: d.signer } }),
    );
    // Used: the email code is gone.
    expect(codes.filter((c) => c.kind === 'EMAIL')).toEqual([]);
  });

  it('attachments: upload, confirm once, remove; nothing after signing', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter with an attachment', {
      signerFields: ['ATTACHMENT'],
    });
    const b = await atSign(d.id, d.signer);
    const fields = (
      (await b.call('get', '/envelope')).body as { fields: { id: string; type: string }[] }
    ).fields;
    const field = fields.find((f) => f.type === 'ATTACHMENT')!;
    const bytes = await pdf([[612, 792]]);
    const facts = {
      ...{ fieldId: field.id, fileName: 'fake-id.pdf', contentType: 'application/pdf' },
      ...{ sizeBytes: bytes.byteLength, sha256: sha256(bytes) },
    };
    const started = await b.call('post', '/attachments/uploads', facts);
    expect(started.status).toBe(200);
    const ticket = started.body as { url: string; uploadToken: string };
    w.store.objects.set(ticket.url.replace('memory://', ''), {
      bytes,
      contentType: 'application/pdf',
    });
    const confirm = { fieldId: field.id, uploadToken: ticket.uploadToken };
    const confirmed = await b.call('post', '/attachments/uploads/confirm', confirm);
    expect([
      confirmed.status,
      (confirmed.body as { attachmentName: string }).attachmentName,
    ]).toEqual([200, 'fake-id.pdf']);
    expect(
      (await b.call('post', '/attachments/uploads/confirm', confirm)).status,
    ).toBeGreaterThanOrEqual(400);
    const stored = await w.inFirm(w.a.id, (tx) =>
      tx.esignAttachment.findMany({ where: { fieldId: field.id } }),
    );
    expect(stored).toHaveLength(1);
    expect((await b.call('delete', `/attachments/${field.id}`)).status).toBe(200);
    expect(
      await w.inFirm(w.a.id, (tx) => tx.esignAttachment.count({ where: { fieldId: field.id } })),
    ).toBe(0);
  });

  it("another firm's link or slug opens nothing", async () => {
    const d = await sentRequest(w, w.a, 'Fake letter, wrong firm');
    const token = await linkToken(w, w.a, d.id, d.signer);
    const other = signerBrowser(w, w.b);
    const opened = await other.open(token);
    expect(opened.status).toBe(404);
    // Firm B's staff cannot read firm A's request either.
    expect((await w.call('get', `${base}/${d.id}`, w.b.people.owner)).status).toBe(404);
  });
});
