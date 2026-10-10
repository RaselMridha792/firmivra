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
  signerBrowser,
} from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';
const base = `${esign}/requests`;
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;
const step = (res: { body: unknown }) => (res.body as { step?: string }).step;
const MIN = 60_000;

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

  it('in person: the kiosk link signs with no code step, records IN_PERSON and keeps the kiosk awake', async () => {
    const { owner } = w.a.people;
    const d = await sentRequest(w, w.a, 'Fake letter signed in person', {
      delivery: 'IN_PERSON',
      authMethod: 'EMAIL_CODE',
    });
    const started = await w.call('post', `${base}/${d.id}/in-person`, owner, {
      recipientId: d.signer,
    });
    expect(started.status).toBe(200);
    const mailed = w.outbox.length;
    const url = (started.body as { signingUrl: string }).signingUrl;
    const token = url.split('#t=')[1]!;
    const lockOf = () =>
      w.inFirm(w.a.id, (tx) => tx.esignKioskLock.findFirstOrThrow({ where: { userId: owner.id } }));
    const setActive = (minutesAgo: number) =>
      w.inFirm(w.a.id, (tx) =>
        tx.esignKioskLock.updateMany({
          where: { userId: owner.id },
          data: { activeAt: new Date(Date.now() - minutesAgo * MIN) },
        }),
      );

    // Another firm's slug never opens it; the kiosk link skips the email code.
    expect((await signerBrowser(w, w.b).open(token)).status).toBe(404);
    const b = signerBrowser(w, w.a);
    const opened = await b.open(token);
    expect([opened.status, step(opened)]).toEqual([200, 'CONSENT']);
    expect((await b.call('post', '/code/send')).status).toBe(409);

    // Each signer call moves the member's idle timer.
    await setActive(10);
    const consent = await b.call('get', '/consent');
    expect(+(await lockOf()).activeAt).toBeGreaterThan(Date.now() - MIN);
    const versionId = (consent.body as { versionId: string }).versionId;
    expect(step(await b.call('post', '/consent', { versionId, agree: true }))).toBe('SIGN');
    expect((await b.call('get', '/envelope')).status).toBe(200);
    const signature = {
      printedName: 'Fake Signer',
      method: 'TYPED',
      typedSignature: 'Fake Signer',
    };
    expect((await b.call('post', '/adopt', { signature })).status).toBe(200);
    const done = await b.call('post', '/finish', { values: [] });
    expect([done.status, step(done)]).toEqual([200, 'DONE']);
    // The staff session stays locked (the timer was kept fresh); no code was ever emailed.
    expect((await w.call('get', `${esign}/in-person`, owner)).status).toBe(200);
    expect(w.outbox.slice(mailed).map((m) => m.template)).not.toContain('esign.code');

    const events = await w.inFirm(w.a.id, (tx) =>
      tx.esignEvent.findMany({
        where: { requestId: d.id, recipientId: d.signer, actorKind: 'SIGNER' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(events.map((e) => [e.type, e.authMethod])).toEqual([
      ['AUTH_PASSED', 'IN_PERSON'],
      ['CONSENTED', 'IN_PERSON'],
      ['VIEWED', 'IN_PERSON'],
      ['SIGNED', 'IN_PERSON'],
    ]);
    const me = (await request(d.id)).recipients.find((r) => r.id === d.signer)!;
    expect(me.status).toBe('SIGNED');

    expect(
      (await w.call('post', `${esign}/in-person/exit`, owner, { password: KIOSK_PASSWORD })).status,
    ).toBe(200);
  });

  it('in person: an expired link, an idle kiosk or an ended one is LINK_INVALID', async () => {
    const { owner } = w.a.people;
    const d = await sentRequest(w, w.a, 'Fake letter idle in person', { delivery: 'IN_PERSON' });
    const started = await w.call('post', `${base}/${d.id}/in-person`, owner, {
      recipientId: d.signer,
    });
    const token = (started.body as { signingUrl: string }).signingUrl.split('#t=')[1]!;
    const b = signerBrowser(w, w.a);
    expect((await b.open(token)).status).toBe(200);
    // Idle 15 minutes: the signer's calls stop and never move the timer back.
    const idle = new Date(Date.now() - 16 * MIN);
    await w.inFirm(w.a.id, (tx) =>
      tx.esignKioskLock.updateMany({ where: { userId: owner.id }, data: { activeAt: idle } }),
    );
    const late = await b.call('get', '/state');
    expect([late.status, code(late)]).toEqual([404, 'LINK_INVALID']);
    const lock = await w.inFirm(w.a.id, (tx) =>
      tx.esignKioskLock.findFirstOrThrow({ where: { userId: owner.id } }),
    );
    expect(lock.activeAt).toEqual(idle);
    // The link itself after its expiry.
    await w.inFirm(w.a.id, (tx) =>
      tx.esignSigningLink.updateMany({
        where: { recipientId: d.signer, purpose: 'IN_PERSON' },
        data: { expiresAt: new Date(Date.now() - MIN) },
      }),
    );
    expect((await signerBrowser(w, w.a).open(token)).status).toBe(404);
    // The staff member's next call times the kiosk out (401); the link stays dead.
    expect((await w.call('get', `${esign}/in-person`, owner)).status).toBe(401);
    expect(await w.inFirm(w.a.id, (tx) => tx.esignKioskLock.count())).toBe(0);
  });
});
