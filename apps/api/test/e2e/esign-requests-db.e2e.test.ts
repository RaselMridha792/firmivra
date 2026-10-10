// End-to-end over the real database: Firm Sign's requests, documents, recipients and fields
// (PrismaEsignRepository, r0_esign) through the real guards, row-level security and database
// rules. Only the file store is in memory. Synthetic data only.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EsignDbWorld, esignDbWorld, readyDraft } from './esign-db.js';

let w: EsignDbWorld;
const base = '/api/v1/esign/requests';
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  w = await esignDbWorld('r13-req-db');
});
afterAll(async () => {
  await w?.close();
});

describe('Firm Sign requests on PostgreSQL', () => {
  it('builds a draft: vault file, page plan, recipient and fields, with the sender value sealed', async () => {
    const d = await readyDraft(w, w.a);
    expect([d.created.status, d.doc.status, d.recipients.status, d.fields.status]).toEqual([
      201, 201, 200, 200,
    ]);
    const detail = await w.call('get', `${base}/${d.id}`, w.a.people.owner);
    expect(detail.status).toBe(200);
    const body = detail.body as {
      status: string;
      pagePlan: unknown[];
      documents: { scanStatus: string }[];
      fields: { recipientId: string | null; value: string | null }[];
    };
    expect(body.status).toBe('DRAFT');
    expect(body.pagePlan).toHaveLength(2);
    expect(body.documents.map((x) => x.scanStatus)).toEqual(['CLEAN']);
    expect(body.fields.find((f) => f.recipientId === null)?.value).toBe('Fake sender note');
    // Stored as the firm key's ciphertext, never the value.
    const rows = await w.inFirm(w.a.id, (tx) =>
      tx.esignField.findMany({ where: { requestId: d.id, recipientId: null } }),
    );
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]!.valueEnc!).toString('latin1')).not.toContain('Fake sender note');
  });

  it('sends once: status, link hash, queued email and event; then refuses draft writes', async () => {
    const d = await readyDraft(w, w.a, 'Fake letter to send');
    const ready = await w.call('get', `${base}/${d.id}/readiness`, w.a.people.owner);
    expect([ready.status, (ready.body as { ready: boolean }).ready]).toEqual([200, true]);
    const sent = await w.call('post', `${base}/${d.id}/send`, w.a.people.owner, { confirm: true });
    expect([sent.status, (sent.body as { status: string }).status]).toEqual([200, 'SENT']);
    const again = await w.call('post', `${base}/${d.id}/send`, w.a.people.owner, { confirm: true });
    expect(again.status).toBe(409);
    const stored = await w.inFirm(w.a.id, async (tx) => ({
      links: await tx.esignSigningLink.findMany({ where: { requestId: d.id } }),
      emails: await tx.esignEmail.findMany({ where: { requestId: d.id } }),
      request: await tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
    }));
    expect(stored.links.map((l) => [l.purpose, l.recipientId])).toEqual([['SIGN', d.signer]]);
    expect(stored.links[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.emails.map((e) => e.template)).toEqual(['esign.request']);
    expect(stored.request.originalSha256).toMatch(/^[0-9a-f]{64}$/);
    const events = await w.call('get', `${base}/${d.id}/events`, w.a.people.owner);
    expect((events.body as { items: { type: string }[] }).items.map((e) => e.type)).toContain(
      'SENT',
    );
    const patch = await w.call('patch', `${base}/${d.id}`, w.a.people.owner, { title: 'Late' });
    expect([patch.status, code(patch)]).toEqual([409, 'INVALID_STATE']);
    const list = await w.call('get', `${base}?status=SENT`, w.a.people.owner);
    expect((list.body as { items: { id: string }[] }).items.map((i) => i.id)).toContain(d.id);
    // The search is a substring of the title (and names); % and _ are plain characters.
    const ids = async (q: string) =>
      (
        (await w.call('get', `${base}?q=${encodeURIComponent(q)}`, w.a.people.owner)).body as {
          items: { id: string }[];
        }
      ).items.map((i) => i.id);
    expect(await ids('letter to SEND')).toContain(d.id);
    expect(await ids('Fake%send')).not.toContain(d.id);
    expect(await ids('Fake_letter')).not.toContain(d.id);
    const summary = await w.call('get', `${base}/summary`, w.a.people.owner);
    expect((summary.body as { counts: { SENT: number } }).counts.SENT).toBeGreaterThan(0);
  });

  it('keeps the client while a portal login is a recipient (RECIPIENTS_LINKED, nothing written)', async () => {
    const d = await readyDraft(w, w.a, 'Fake linked letter');
    const before = await w.inFirm(w.a.id, (tx) =>
      tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
    );
    const res = await w.call('patch', `${base}/${d.id}`, w.a.people.owner, { clientId: null });
    expect([res.status, code(res)]).toEqual([409, 'RECIPIENTS_LINKED']);
    const after = await w.inFirm(w.a.id, (tx) =>
      tx.esignRequest.findUniqueOrThrow({ where: { id: d.id } }),
    );
    expect(after.lastActivityAt).toEqual(before.lastActivityAt);
  });

  it('takes an upload once and adds it PENDING; deletes a draft with its parts and files', async () => {
    const d = await readyDraft(w, w.a, 'Fake letter to delete');
    const bytes = w.a.pdf;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const ticket = await w.call('post', `${base}/${d.id}/documents/uploads`, w.a.people.owner, {
      fileName: 'Fake upload.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256,
    });
    expect(ticket.status).toBe(201);
    const { url, uploadToken } = ticket.body as { url: string; uploadToken: string };
    const key = url.replace('memory://', '');
    await w.store.put(w.a.id, key, bytes, 'application/pdf');
    const confirm = () =>
      w.call('post', `${base}/${d.id}/documents/uploads/confirm`, w.a.people.owner, {
        uploadToken,
      });
    const first = await confirm();
    expect([first.status, (first.body as { scanStatus: string }).scanStatus]).toEqual([
      201,
      'PENDING',
    ]);
    expect((await confirm()).status).toBe(410);
    const keys = await w.inFirm(w.a.id, (tx) =>
      tx.esignDocument.findMany({ where: { requestId: d.id }, select: { s3Key: true } }),
    );
    expect(keys).toHaveLength(2);
    const del = await w.call('delete', `${base}/${d.id}`, w.a.people.owner);
    expect(del.status).toBeLessThan(300);
    const left = await w.inFirm(w.a.id, async (tx) => ({
      requests: await tx.esignRequest.count({ where: { id: d.id } }),
      documents: await tx.esignDocument.count({ where: { requestId: d.id } }),
      recipients: await tx.esignRecipient.count({ where: { requestId: d.id } }),
      fields: await tx.esignField.count({ where: { requestId: d.id } }),
    }));
    expect(left).toEqual({ requests: 0, documents: 0, recipients: 0, fields: 0 });
    for (const { s3Key } of keys) expect(await w.store.read(w.a.id, s3Key)).toBeNull();
  });

  it("answers 404 to another firm's staff and lists none of its requests", async () => {
    const d = await readyDraft(w, w.a, 'Fake letter of firm A');
    for (const [method, path, body] of [
      ['get', `${base}/${d.id}`, undefined],
      ['patch', `${base}/${d.id}`, { title: 'Taken' }],
      ['put', `${base}/${d.id}/fields`, { fields: [] }],
      ['delete', `${base}/${d.id}`, undefined],
    ] as const) {
      const res = await w.call(method, path, w.b.people.owner, body);
      expect([path, res.status]).toEqual([path, 404]);
    }
    const list = await w.call('get', base, w.b.people.owner);
    expect(JSON.stringify(list.body)).not.toContain(d.id);
    const still = await w.call('get', `${base}/${d.id}`, w.a.people.owner);
    expect((still.body as { title: string }).title).toBe('Fake letter of firm A');
  });
});
