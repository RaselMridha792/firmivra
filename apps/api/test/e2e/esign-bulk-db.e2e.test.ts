// End-to-end over the real database: Firm Sign bulk send (PrismaBulkRepository, r0_esign) through
// the real guards, row-level security and database rules. Only the file store and the email sender
// are in memory. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignBulkJob } from '../../src/esign/bulk/bulk.job.js';
import { type EsignDbWorld, esignDbWorld, readyDraft } from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';
const base = `${esign}/requests`;
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  w = await esignDbWorld('r13-bulk-db');
});
afterAll(async () => {
  await w?.close();
});

const request = (id: string) =>
  w.inFirm(w.a.id, (tx) =>
    tx.esignRequest.findUniqueOrThrow({
      where: { id },
      include: { recipients: true },
    }),
  );

describe('Firm Sign bulk send on PostgreSQL', () => {
  it("makes and sends one request per client; another firm's client is 404", async () => {
    const owner = w.a.people.owner;
    const d = await readyDraft(w, w.a, 'Fake bulk source', { upload: true });
    const saved = await w.call('post', `${base}/${d.id}/save-as-template`, owner, {
      name: 'Fake bulk template',
      visibility: 'FIRM',
    });
    expect(saved.status).toBe(201);
    const templateId = (saved.body as { id: string }).id;
    const bulk = await w.call('post', `${esign}/templates/${templateId}/bulk-send`, owner, {
      clients: [{ clientId: w.a.ids.client, engagementId: w.a.ids.engagement }],
      confirm: true,
    });
    expect(bulk.status).toBe(202);
    const batchId = (bulk.body as { id: string }).id;
    const ran = await w.app.get(EsignBulkJob).run({ businessIds: [w.a.id] });
    expect(ran).toMatchObject({ skipped: false });
    const batch = await w.call('get', `${esign}/bulk/${batchId}`, owner);
    expect(batch.status).toBe(200);
    const items = (batch.body as { items: { state: string; requestId: string | null }[] }).items;
    expect(items.map((i) => i.state)).toEqual(['SENT']);
    expect((await request(items[0]!.requestId!)).status).toBe('SENT');
    // Another firm's client is refused (the firm's own clients only, and a foreign key).
    const foreign = await w.call('post', `${esign}/templates/${templateId}/bulk-send`, owner, {
      clients: [{ clientId: w.b.ids.client }],
      confirm: true,
    });
    expect([foreign.status, code(foreign)]).toEqual([404, 'NOT_FOUND']);

    const theirs = await w.call('post', `${esign}/templates/${templateId}/bulk-send`, owner, {
      clients: [{ clientId: w.a.ids.client, engagementId: w.b.ids.engagement }],
      confirm: true,
    });
    expect([theirs.status, code(theirs)]).toEqual([409, 'ENGAGEMENT_MISMATCH']);
  });
});
