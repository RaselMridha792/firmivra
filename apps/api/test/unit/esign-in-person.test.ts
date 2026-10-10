// R13 extras (contract 3), in-person signing on the in-memory ports (esign-fakes.ts): start (a
// fresh one-time link, only its hash stored; the staff session locked), its refusals and access
// rules, the lock screen's state, exit with the staff password (wrong ones counted, the fifth
// signs the member out), and the identity provider's password check (AUTH_MODE=local). The
// password, the link and its token never reach the audit or the timeline. Synthetic data only.
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthFlowError, IDENTITY_PROVIDER } from '../../src/auth/identity/identity-provider.js';
import {
  LOCAL_PASSWORD,
  LocalIdentityProvider,
} from '../../src/auth/identity/local-identity.provider.js';
import type { TokenService } from '../../src/auth/token.service.js';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EsignInPersonService } from '../../src/esign/extras/in-person.service.js';
import { IdentityKioskAuth, type KioskAuth } from '../../src/esign/extras/kiosk.js';
import { EsignLifecycleService } from '../../src/esign/lifecycle/lifecycle.service.js';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
} from '../../src/esign/requests/requests.service.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  FakeNotify,
  InMemoryExtrasRepository,
  InMemoryLifecycleRepository,
  sentRecipient,
} from './esign-fakes.js';

const PORTAL = 'https://portal.example.test';
const PASSWORD = 'Fake-staff-password-1';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** The staff password check and sign-out, recorded. */
class FakeKioskAuth implements KioskAuth {
  readonly checked: string[] = [];
  signedOut = 0;
  passwordOk(cognitoSub: string, password: string) {
    this.checked.push(cognitoSub);
    return Promise.resolve(password === PASSWORD);
  }
  signOut() {
    this.signedOut += 1;
    return Promise.resolve();
  }
}

let w: EsignWorld;
let extras: InMemoryExtrasRepository;
let auth: FakeKioskAuth;
let svc: EsignInPersonService;
const as = (userId: string, role: EsignActor['role']): EsignActor => ({ userId, role });
let owner: EsignActor;
const req = {} as Request;
const res = {} as Response;

beforeEach(() => {
  w = esignWorld();
  extras = new InMemoryExtrasRepository(w.repo);
  auth = new FakeKioskAuth();
  const requests = new EsignRequestsService(
    w.repo,
    w.directory,
    w.modules,
    w.store,
    w.audit,
    fakeHasher,
  );
  const tokens = new RandomLinkTokens();
  const env = { PORTAL_BASE_URL: `${PORTAL}/`, APP_BASE_URL: 'https://app.example.test' };
  const lifecycle = new EsignLifecycleService(
    requests,
    w.repo,
    new InMemoryLifecycleRepository(w.repo),
    w.directory,
    w.store,
    tokens,
    new FakeNotify(),
    w.audit,
    env,
  );
  svc = new EsignInPersonService(
    requests,
    lifecycle,
    w.repo,
    extras,
    w.directory,
    tokens,
    auth,
    w.audit,
    env,
  );
  owner = as(w.users.ownerA, 'OWNER');
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

/** A SENT request for c1 (assigned to staffA) with an IN_PERSON signer whose turn it is. */
async function sent(extra: Partial<EsignRecipientRecord> = {}) {
  const { id } = await new EsignRequestsService(
    w.repo,
    w.directory,
    w.modules,
    w.store,
    w.audit,
    fakeHasher,
  ).create(w.a, owner, { title: 'Fake in person', source: 'TAB', clientId: w.ids.c1 });
  const signer = sentRecipient(w, { delivery: 'IN_PERSON', name: 'Fake signer', ...extra });
  w.repo.seed(w.a, id, (row) => {
    Object.assign(row.record, { status: 'SENT', sentAt: new Date(), expiresAt: new Date() });
    row.parts.recipients = [signer];
  });
  return { id, signerId: signer.id };
}

describe('starting an in-person signing', () => {
  it('gives a fresh one-time link (its hash stored) and locks the caller', async () => {
    const { id, signerId } = await sent();
    const before = Date.now();
    const session = await svc.start(w.a, owner, id, signerId);
    const token = /^https:\/\/portal\.example\.test\/fake-firm-a\/sign#t=(.+)$/.exec(
      session.signingUrl,
    )?.[1];
    expect(token).toBeDefined();
    expect(extras.inPersonLinks.of(w.a).get(sha(token!))?.recipientId).toBe(signerId);
    expect(extras.versionRaises.of(w.a).get(signerId)).toBe(1);
    expect(session).toMatchObject({
      requestId: id,
      recipientId: signerId,
      signerName: 'Fake signer',
    });
    expect(Date.parse(session.expiresAt) - Date.parse(session.startedAt)).toBe(15 * 60_000);
    expect(Date.parse(session.startedAt)).toBeGreaterThanOrEqual(before);
    expect((await extras.kioskLock(w.a, w.users.ownerA))?.requestId).toBe(id);
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.actorName, e.recipient?.id])).toEqual([
      ['IN_PERSON_STARTED', 'owner-a', signerId],
    ]);
    const audit = w.audit.entries.at(-1)!;
    expect([audit.action, audit.metadata]).toEqual([
      'esign.in_person_started',
      { clientId: w.ids.c1, recipientId: signerId },
    ]);
    expect(JSON.stringify([w.audit.entries, events])).not.toContain(token!);
    // The lock screen's state: the sign page, never the token again.
    const state = await svc.state(w.a, owner);
    expect(state.session?.signingUrl).toBe(`${PORTAL}/fake-firm-a/sign`);
    expect(await svc.state(w.a, as(w.users.staffA, 'STAFF'))).toEqual({ session: null });
    // One kiosk at a time per member.
    expect(await refused(svc.start(w.a, owner, id, signerId))).toEqual([409, 'INVALID_STATE']);
  });

  it('refuses another delivery, a finished signer, one whose turn is not yet, a closed request', async () => {
    const email = await sent({ delivery: 'EMAIL' });
    expect(await refused(svc.start(w.a, owner, email.id, email.signerId))).toEqual([
      409,
      'NOT_IN_PERSON',
    ]);
    const signed = await sent({ status: 'SIGNED' });
    expect(await refused(svc.start(w.a, owner, signed.id, signed.signerId))).toEqual([
      409,
      'RECIPIENT_DONE',
    ]);
    const waiting = await sent({ status: 'WAITING' });
    expect(await refused(svc.start(w.a, owner, waiting.id, waiting.signerId))).toEqual([
      409,
      'NOT_YOUR_TURN',
    ]);
    const closed = await sent();
    w.repo.seed(w.a, closed.id, (row) => (row.record.status = 'VOIDED'));
    expect(await refused(svc.start(w.a, owner, closed.id, closed.signerId))).toEqual([
      409,
      'REQUEST_CLOSED',
    ]);
    w.repo.seed(w.a, closed.id, (row) => (row.record.status = 'DRAFT'));
    expect(await refused(svc.start(w.a, owner, closed.id, closed.signerId))).toEqual([
      409,
      'INVALID_STATE',
    ]);
    expect(await refused(svc.start(w.a, owner, closed.id, email.signerId))).toEqual([
      409,
      'INVALID_STATE',
    ]);
  });

  it('is a write: 404 across firms, for unassigned Staff and an unknown signer; Viewer 403', async () => {
    const { id, signerId } = await sent();
    expect(await refused(svc.start(w.b, as(w.users.ownerB, 'OWNER'), id, signerId))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.start(w.a, as(w.users.staffA2, 'STAFF'), id, signerId))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(await refused(svc.start(w.a, owner, id, w.users.staffA))).toEqual([404, 'NOT_FOUND']);
    expect(await refused(svc.start(w.a, as(w.users.staffA, 'VIEWER'), id, signerId))).toEqual([
      403,
      'FORBIDDEN',
    ]);
    // The client's assigned member may start it.
    const session = await svc.start(w.a, as(w.users.staffA, 'STAFF'), id, signerId);
    expect(session.recipientId).toBe(signerId);
  });
});

describe('leaving the kiosk', () => {
  const me = () => ({ ...owner, cognitoSub: 'fake-sub-owner' });

  it('unlocks with the staff password and ends the signer’s session', async () => {
    const { id, signerId } = await sent();
    await svc.start(w.a, owner, id, signerId);
    expect(await svc.exit(req, res, w.a, me(), PASSWORD)).toEqual({ ok: true });
    expect(auth.checked).toEqual(['fake-sub-owner']);
    expect(await extras.kioskLock(w.a, w.users.ownerA)).toBeNull();
    expect(extras.versionRaises.of(w.a).get(signerId)).toBe(2);
    expect((await w.repo.events(w.a, id)).map((e) => e.type)).toEqual([
      'IN_PERSON_STARTED',
      'IN_PERSON_ENDED',
    ]);
    expect(w.audit.entries.at(-1)!.metadata).toEqual({ recipientId: signerId, reason: 'EXIT' });
    expect(auth.signedOut).toBe(0);
    // Nothing to unlock: no password check.
    expect(await svc.exit(req, res, w.a, me(), 'anything')).toEqual({ ok: true });
    expect(auth.checked).toHaveLength(1);
  });

  it('answers 400 PASSWORD_WRONG four times, then signs the member out (401)', async () => {
    const { id, signerId } = await sent();
    await svc.start(w.a, owner, id, signerId);
    for (let i = 0; i < 4; i++) {
      expect(await refused(svc.exit(req, res, w.a, me(), 'Wrong-password-1'))).toEqual([
        400,
        'PASSWORD_WRONG',
      ]);
      expect(await extras.kioskLock(w.a, w.users.ownerA)).not.toBeNull();
    }
    expect(await refused(svc.exit(req, res, w.a, me(), 'Wrong-password-1'))).toEqual([
      401,
      'UNAUTHENTICATED',
    ]);
    expect(auth.signedOut).toBe(1);
    expect(await extras.kioskLock(w.a, w.users.ownerA)).toBeNull();
    expect(w.audit.entries.at(-1)!.metadata).toEqual({
      recipientId: signerId,
      reason: 'PASSWORD_TRIES',
    });
    expect(JSON.stringify(w.audit.entries)).not.toContain('Wrong-password');
  });

  it('times out an idle kiosk: ended and signed out', async () => {
    const { id, signerId } = await sent();
    await svc.start(w.a, owner, id, signerId);
    const lock = (await extras.kioskLock(w.a, w.users.ownerA))!;
    await svc.timeOut(req, res, w.a, lock);
    expect(auth.signedOut).toBe(1);
    expect(await extras.kioskLock(w.a, w.users.ownerA)).toBeNull();
    expect(w.audit.entries.at(-1)!.metadata).toEqual({ recipientId: signerId, reason: 'IDLE' });
  });
});

describe('the staff password check (identity provider)', () => {
  const sub = 'fake-sub-staff';
  const kioskAuth = (identity: object) =>
    new IdentityKioskAuth({ get: () => identity } as unknown as ModuleRef);

  it('checks the password with the staff pool’s sign-in (AUTH_MODE=local)', async () => {
    const local = new LocalIdentityProvider({} as TokenService);
    const ref = { get: (t: unknown) => (t === IDENTITY_PROVIDER ? local : null) };
    const check = new IdentityKioskAuth(ref as unknown as ModuleRef);
    expect(await check.passwordOk(sub, LOCAL_PASSWORD)).toBe(true);
    expect(await check.passwordOk(sub, 'Not-the-password-1')).toBe(false);
  });

  it('revokes the tokens of a sign-in that completed, and passes on a rate limit (429)', async () => {
    const revoked: string[] = [];
    const done = kioskAuth({
      signIn: () =>
        Promise.resolve({
          kind: 'tokens',
          tokens: { accessToken: 'a', refreshToken: 'fake-refresh', expiresIn: 60 },
          username: sub,
        }),
      revoke: (_pool: string, token: string) => {
        revoked.push(token);
        return Promise.resolve();
      },
    });
    expect(await done.passwordOk(sub, PASSWORD)).toBe(true);
    expect(revoked).toEqual(['fake-refresh']);
    const limited = kioskAuth({
      signIn: () => Promise.reject(new AuthFlowError('RATE_LIMITED')),
    });
    expect(await refused(limited.passwordOk(sub, PASSWORD))).toEqual([429, 'RATE_LIMITED']);
  });
});
