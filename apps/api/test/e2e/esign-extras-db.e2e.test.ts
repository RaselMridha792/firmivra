// End-to-end over the real database: Firm Sign extras: Firm Sign roles, approvals, the report and
// in-person signing (PrismaExtrasRepository), r0_esign, through the real guards, row-level security
// and database rules. Only the file store and the email sender are in memory. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type EsignDbWorld,
  esignDbWorld,
  KIOSK_PASSWORD,
  readyDraft,
  sentRequest,
} from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';
const base = `${esign}/requests`;
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  w = await esignDbWorld('r13-extras-db');
});
afterAll(async () => {
  await w?.close();
});

const request = (id: string) =>
  w.inFirm(w.a.id, (tx) =>
    tx.esignRequest.findUniqueOrThrow({ where: { id }, include: { recipients: true } }),
  );

describe('Firm Sign extras on PostgreSQL', () => {
  it('a Firm Sign role, an approval that sends, and the report', async () => {
    const { owner, staff } = w.a.people;
    const role = await w.call('put', `${esign}/roles/${staff.id}`, owner, {
      esignRole: 'MANAGER',
    });
    expect(role.status).toBe(200);
    const roles = await w.call('get', `${esign}/roles`, owner);
    expect(JSON.stringify(roles.body)).toContain('MANAGER');
    expect(
      (
        await w.call('put', `${esign}/roles/${staff.id}`, w.b.people.owner, {
          esignRole: 'VIEWER',
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);

    const d = await readyDraft(w, w.a, 'Fake letter to approve', {
      sender: staff,
      approverUserId: owner.id,
    });
    const submitted = await w.call('post', `${base}/${d.id}/submit-for-approval`, staff, {
      confirm: true,
    });
    expect(submitted.status).toBe(200);
    expect((await request(d.id)).status).toBe('NEEDS_APPROVAL');
    const approved = await w.call('post', `${base}/${d.id}/approval`, owner, {
      decision: 'APPROVE',
    });
    expect(approved.status).toBe(200);
    expect((await request(d.id)).status).toBe('SENT');
    const notes = await w.inFirm(w.a.id, (tx) =>
      tx.esignApprovalNote.findMany({ where: { requestId: d.id } }),
    );
    expect(notes.map((n) => [n.decision, n.note])).toEqual([['APPROVE', null]]);

    const today = new Date().toISOString().slice(0, 10);
    const report = await w.call('get', `${esign}/reports?from=${today}&to=${today}`, owner);
    expect(report.status).toBe(200);
    expect(JSON.stringify(report.body)).toContain(staff.id);
  });

  it('in person: the member is locked to the kiosk, wrong passwords counted, the exit ends it', async () => {
    const { owner } = w.a.people;
    const d = await sentRequest(w, w.a, 'Fake letter in person', { delivery: 'IN_PERSON' });
    const before = (await request(d.id)).recipients[0]!.tokenVersion;
    const started = await w.call('post', `${base}/${d.id}/in-person`, owner, {
      recipientId: d.signer,
    });
    expect(started.status).toBe(200);
    const again = await w.call('post', `${base}/${d.id}/in-person`, owner, {
      recipientId: d.signer,
    });
    // The member's session is locked to the kiosk until they exit.
    expect([again.status, code(again)]).toEqual([403, 'KIOSK_LOCKED']);
    const lock = await w.call('get', `${esign}/in-person`, owner);
    expect(lock.status).toBe(200);
    const wrong = await w.call('post', `${esign}/in-person/exit`, owner, { password: 'nope' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const held = await w.inFirm(w.a.id, (tx) =>
      tx.esignKioskLock.findFirstOrThrow({ where: { userId: owner.id } }),
    );
    expect(held.wrongPasswords).toBe(1);
    const exit = await w.call('post', `${esign}/in-person/exit`, owner, {
      password: KIOSK_PASSWORD,
    });
    expect(exit.status).toBe(200);
    expect(
      await w.inFirm(w.a.id, (tx) => tx.esignKioskLock.count({ where: { userId: owner.id } })),
    ).toBe(0);
    // Every link of the in-person session stopped (token_version raised twice: start and exit).
    expect((await request(d.id)).recipients[0]!.tokenVersion).toBe(before + 2);
  });

  it('in person: the exit still ends the signer session after the request closed', async () => {
    const { owner } = w.a.people;
    const d = await sentRequest(w, w.a, 'Fake letter closed in person', { delivery: 'IN_PERSON' });
    const before = (await request(d.id)).recipients[0]!.tokenVersion;
    const started = await w.call('post', `${base}/${d.id}/in-person`, owner, {
      recipientId: d.signer,
    });
    expect(started.status).toBe(200);
    // Voided meanwhile (from another session of the firm).
    await w.inFirm(w.a.id, (tx) =>
      tx.esignRequest.update({
        where: { id: d.id },
        data: {
          ...{ status: 'VOIDED', voidedAt: new Date(), voidReason: 'Fake reason' },
          voidedByUserId: owner.id,
        },
      }),
    );
    const exit = await w.call('post', `${esign}/in-person/exit`, owner, {
      password: KIOSK_PASSWORD,
    });
    expect(exit.status).toBe(200);
    expect((await request(d.id)).recipients[0]!.tokenVersion).toBe(before + 2);
  });
});
