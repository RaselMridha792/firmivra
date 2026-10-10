// End-to-end over the real database: Firm Sign lifecycle: remind, void, replace and the
// expiry job (PrismaLifecycleRepository), r0_esign, through the real guards, row-level security and
// database rules. Only the file store and the email sender are in memory. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignLifecycleJob } from '../../src/esign/lifecycle/lifecycle.job.js';
import { type EsignDbWorld, esignDbWorld, sentRequest } from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';
const base = `${esign}/requests`;
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;
const DAY_MS = 86_400_000;

beforeAll(async () => {
  w = await esignDbWorld('r13-lifecycle-db');
});
afterAll(async () => {
  await w?.close();
});

const request = (id: string) =>
  w.inFirm(w.a.id, (tx) =>
    tx.esignRequest.findUniqueOrThrow({ where: { id }, include: { recipients: true } }),
  );

describe('Firm Sign lifecycle on PostgreSQL', () => {
  it('reminds once an hour and voids', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter to remind');
    const owner = w.a.people.owner;
    const reminded = await w.call('post', `${base}/${d.id}/remind`, owner, {});
    expect(reminded.status).toBe(200);
    const again = await w.call('post', `${base}/${d.id}/remind`, owner, {});
    expect([again.status, code(again)]).toEqual([409, 'REMIND_TOO_SOON']);
    let q = await request(d.id);
    const me = q.recipients.find((r) => r.id === d.signer)!;
    expect([me.reminderCount, me.lastRemindedAt]).toEqual([1, expect.any(Date)]);
    const links = await w.inFirm(w.a.id, (tx) =>
      tx.esignSigningLink.count({ where: { requestId: d.id, purpose: 'SIGN' } }),
    );
    expect(links).toBe(2);

    const voided = await w.call('post', `${base}/${d.id}/void`, owner, { reason: 'Fake reason' });
    expect(voided.status).toBe(200);
    q = await request(d.id);
    expect([q.status, q.voidReason, q.voidedByUserId]).toEqual(['VOIDED', 'Fake reason', owner.id]);
    // Closed: no reminder, and its recipients never change.
    expect((await w.call('post', `${base}/${d.id}/remind`, owner, {})).status).toBe(409);
  });

  it('replaces a sent request with a new draft and voids the old one', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter to replace');
    const res = await w.call('post', `${base}/${d.id}/replace`, w.a.people.owner, {
      reason: 'Fake fix',
    });
    expect(res.status).toBe(201);
    const newId = (res.body as { id: string }).id;
    const [old, next] = [await request(d.id), await request(newId)];
    expect([old.status, old.replacedByRequestId]).toEqual(['VOIDED', newId]);
    expect([next.status, next.replacesRequestId, next.recipients.length]).toEqual([
      'DRAFT',
      d.id,
      1,
    ]);
    const fields = await w.inFirm(w.a.id, (tx) =>
      tx.esignField.findMany({ where: { requestId: newId } }),
    );
    expect(fields).toHaveLength(2);
  });

  it('the job expires an overdue request (and only in its own firm)', async () => {
    const d = await sentRequest(w, w.a, 'Fake letter to expire');
    const theirs = await sentRequest(w, w.b, 'Fake letter of firm B');
    const job = w.app.get(EsignLifecycleJob);
    const later = new Date(Date.now() + 400 * DAY_MS);
    const run = await job.run({ businessIds: [w.a.id], now: later });
    expect(run).toMatchObject({ skipped: false });
    expect((await request(d.id)).status).toBe('EXPIRED');
    const b = await w.inFirm(w.b.id, (tx) =>
      tx.esignRequest.findUniqueOrThrow({ where: { id: theirs.id } }),
    );
    expect(b.status).toBe('SENT');
  });
});
