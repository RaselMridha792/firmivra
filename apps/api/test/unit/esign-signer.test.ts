// R13 signer routes, slice 1, on the in-memory ports (esign-fakes.ts) with R18's real link
// tokens, code HMAC and sealed cookie: opening the link (unknown, expired, used, corrected,
// wrong-slug and other firm's tokens all LINK_INVALID), the cookie (missing, other slug, other
// firm, tampered), every step and every out-of-order call (409 WRONG_STEP), the email and access
// codes with their limits, consent, a cross-recipient check and nothing secret in the logs,
// audit or timeline. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import {
  HmacCodeHasher,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import type { SignerLink } from '../../src/esign/signer/signer.repository.js';
import { EsignSignerService } from '../../src/esign/signer/signer.service.js';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';
import { esignWorld, type EsignWorld, InMemorySignerRepository } from './esign-fakes.js';

const secrets = { CLIENT: 'fake-client-secret', STAFF: 'fake-staff-secret' };
const SLUG_A = 'fake-firm-a';
const SLUG_B = 'fake-firm-b';
const ACCESS = 'FAKE1234';
const MIN = 60_000;

class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage<'esign.code'>[] = [];
  send(message: NotifyMessage): Promise<void> {
    this.sent.push(structuredClone(message) as NotifyMessage<'esign.code'>);
    return Promise.resolve();
  }
  get lastCode(): string {
    return this.sent.at(-1)!.data.code;
  }
}

/** One browser's cookie jar. */
class Browser {
  readonly jar = new Map<string, string>();
  readonly res = {
    cookie: (name: string, value: string) => this.jar.set(name, value),
    clearCookie: (name: string) => this.jar.delete(name),
  } as unknown as Response;
  get req(): Request {
    return { cookies: Object.fromEntries(this.jar) } as unknown as Request;
  }
}

let w: EsignWorld;
let signers: InMemorySignerRepository;
let notify: FakeNotify;
let svc: EsignSignerService;
const tokens = new RandomLinkTokens();
const hasher = new HmacCodeHasher(secrets, false);

beforeEach(() => {
  w = esignWorld();
  signers = new InMemorySignerRepository(w.repo);
  notify = new FakeNotify();
  const firms = new Map([
    [SLUG_A, { id: w.a, slug: SLUG_A, name: 'Fake Firm A' }],
    [SLUG_B, { id: w.b, slug: SLUG_B, name: 'Fake Firm B' }],
  ]);
  const activeFirm = (slug: string) => {
    const firm = firms.get(slug);
    return firm ? Promise.resolve(firm) : Promise.reject(new NotFoundException());
  };
  svc = new EsignSignerService(
    { activeFirm },
    w.modules,
    signers,
    w.directory,
    tokens,
    hasher,
    new SealedSignerCookie(secrets, true),
    notify,
    w.audit,
  );
  for (const [firm, n] of [
    [w.a, 1],
    [w.b, 1],
  ] as const) {
    signers.consents.set(firm, { id: randomUUID(), version: n, bodyMarkdown: 'Fake consent' });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The controller's calls, for one browser at one slug. */
const api = (b: Browser, slug = SLUG_A) => ({
  open: (token: string) => svc.open(slug, token, b.res),
  state: async () => svc.state(await svc.call(slug, b.req)),
  sendCode: async () => svc.sendCode(await svc.call(slug, b.req, 'VERIFY_EMAIL')),
  verifyCode: async (code: string) =>
    svc.verify(await svc.call(slug, b.req, 'VERIFY_EMAIL'), 'EMAIL', code, b.res),
  accessCode: async (code: string) =>
    svc.verify(await svc.call(slug, b.req, 'VERIFY_ACCESS_CODE'), 'ACCESS', code, b.res),
  consent: async () => svc.consent(await svc.call(slug, b.req, 'CONSENT')),
  accept: async (versionId: string) =>
    svc.acceptConsent(await svc.call(slug, b.req, 'CONSENT'), versionId, b.res),
});

async function refused(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return `${error.getStatus()} ${(error.getResponse() as { code: string }).code}`;
  }
  throw new Error('expected a refusal');
}

const signer = (extra: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name: 'Fake Signer',
  email: 'jamie@client.test',
  phone: null,
  link: { type: 'EXTERNAL' },
  delivery: 'EMAIL',
  authMethod: 'EMAIL_CODE',
  accessCodeHash: null,
  colorIndex: 0,
  status: 'SENT',
  sentAt: new Date(),
  viewedAt: null,
  signedAt: null,
  declinedAt: null,
  declineReason: null,
  lastRemindedAt: null,
  reminderCount: 0,
  ...extra,
});

/** A SENT request of the firm with these recipients; answers its id. */
async function sent(firm: string, recipients: EsignRecipientRecord[]) {
  const record = await w.repo.createRequest(firm, {
    title: 'Fake engagement letter',
    source: 'TAB',
    clientId: null,
    engagementId: null,
    senderUserId: firm === w.a ? w.users.ownerA : w.users.ownerB,
    internalNote: 'internal only',
    emailSubject: null,
    emailMessage: null,
    routing: 'PARALLEL',
    expiryDays: 10,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
  });
  w.repo.seed(firm, record.id, (row) => {
    Object.assign(row.record, {
      status: 'SENT',
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 86_400_000),
    });
    row.parts.recipients = structuredClone(recipients);
  });
  return record.id;
}

/** A link token for the recipient (only its hash is stored). */
function link(
  firm: string,
  requestId: string,
  recipientId: string,
  extra: Partial<SignerLink> = {},
) {
  const { token, hash } = tokens.issue();
  signers.links.of(firm).set(hash, {
    requestId,
    recipientId,
    tokenVersion: 0,
    purpose: 'SIGN',
    ...extra,
  });
  return token;
}

/** A signer at the step after the email code. */
async function atConsent(b = new Browser(), me = signer()) {
  const id = await sent(w.a, [me]);
  await api(b).open(link(w.a, id, me.id));
  await api(b).sendCode();
  await api(b).verifyCode(notify.lastCode);
  return { b, id, me };
}

const consentId = (firm = w.a) => signers.consents.get(firm)!.id;

describe('open the link', () => {
  it('trades the token for the sealed cookie at the first step, the address masked', async () => {
    const me = signer();
    const id = await sent(w.a, [me]);
    const b = new Browser();
    const token = link(w.a, id, me.id);
    const state = await api(b).open(token);
    expect(state).toMatchObject({
      step: 'VERIFY_EMAIL',
      title: 'Fake engagement letter',
      senderName: 'owner-a',
      firmName: 'Fake Firm A',
      signerName: 'Fake Signer',
      codeSentTo: 'j***@client.test',
      requestStatus: null,
    });
    expect([...b.jar.keys()]).toEqual([`fv_sign_${SLUG_A}`]);
    expect(b.jar.get(`fv_sign_${SLUG_A}`)).not.toContain(token);
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.signer_link_opened',
      entity: { type: 'esign_recipient', id: me.id },
      metadata: { requestId: id },
      at: { businessId: w.a },
    });
  });

  it('starts an ACCESS_CODE signer at the access code and a LINK signer at consent', async () => {
    const access = signer({ authMethod: 'ACCESS_CODE' });
    const plain = signer({ authMethod: 'LINK' });
    const id = await sent(w.a, [access, plain]);
    expect((await api(new Browser()).open(link(w.a, id, access.id))).step).toBe(
      'VERIFY_ACCESS_CODE',
    );
    expect((await api(new Browser()).open(link(w.a, id, plain.id))).step).toBe('CONSENT');
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.authMethod, e.recipient?.id])).toEqual([
      ['AUTH_PASSED', 'LINK', plain.id],
    ]);
  });

  it('answers the one 404 LINK_INVALID for unknown, expired, used, corrected, other-firm and wrong-slug tokens', async () => {
    const me = signer();
    const done = signer({ status: 'SIGNED' });
    const declined = signer({ status: 'DECLINED' });
    const id = await sent(w.a, [me, done, declined]);
    const expired = await sent(w.a, [signer()]);
    w.repo.seed(w.a, expired, (row) => (row.record.expiresAt = new Date(Date.now() - 1)));
    const voided = await sent(w.a, [signer()]);
    w.repo.seed(w.a, voided, (row) => (row.record.status = 'VOIDED'));
    const corrected = link(w.a, id, me.id);
    signers.versions.of(w.a).set(me.id, 1);
    const bMe = signer();
    const bId = await sent(w.b, [bMe]);
    const firmB = link(w.b, bId, bMe.id);
    const cases: [string, string][] = [
      [tokens.issue().token, SLUG_A], // unknown
      [link(w.a, expired, (await w.repo.parts(w.a, expired)).recipients[0]!.id), SLUG_A],
      [link(w.a, voided, (await w.repo.parts(w.a, voided)).recipients[0]!.id), SLUG_A],
      [link(w.a, id, done.id), SLUG_A], // used: signed
      [link(w.a, id, declined.id), SLUG_A], // used: declined
      [corrected, SLUG_A],
      [link(w.a, id, me.id, { purpose: 'COPY' }), SLUG_A], // the copy link: slice 2
      [firmB, SLUG_A], // another firm's token on this firm's slug
      [link(w.a, id, me.id, { tokenVersion: 1 }), SLUG_B], // this firm's token on another slug
      [link(w.a, id, me.id, { tokenVersion: 1 }), 'no-such-firm'],
    ];
    for (const [token, slug] of cases) {
      expect(await refused(api(new Browser(), slug).open(token))).toBe('404 LINK_INVALID');
    }
    // Firm Sign off: the same answer, even for a good token.
    w.modules.set(w.b, 'esign', false);
    expect(await refused(api(new Browser(), SLUG_B).open(firmB))).toBe('404 LINK_INVALID');
    expect(w.audit.entries).toEqual([]);
  });
});

describe('the cookie', () => {
  it('is refused when missing, under another slug, tampered or from an older token version', async () => {
    const { b, me } = await atConsent();
    expect(await refused(api(new Browser()).state())).toBe('404 LINK_INVALID');
    const value = b.jar.get(`fv_sign_${SLUG_A}`)!;
    const moved = new Browser();
    moved.jar.set(`fv_sign_${SLUG_B}`, value);
    expect(await refused(api(moved, SLUG_B).state())).toBe('404 LINK_INVALID');
    const tampered = new Browser();
    tampered.jar.set(`fv_sign_${SLUG_A}`, `${value.slice(0, -4)}AAAA`);
    expect(await refused(api(tampered).state())).toBe('404 LINK_INVALID');
    expect((await api(b).state()).step).toBe('CONSENT');
    signers.versions.of(w.a).set(me.id, 1); // the sender corrected the recipient
    expect(await refused(api(b).state())).toBe('404 LINK_INVALID');
  });

  it('answers 404 once Firm Sign is turned off', async () => {
    const { b } = await atConsent();
    w.modules.set(w.a, 'esign', false);
    expect(await refused(api(b).state())).toBe('404 LINK_INVALID');
  });

  it('shows CLOSED with EXPIRED once the request runs out', async () => {
    const { b, id } = await atConsent();
    w.repo.seed(w.a, id, (row) => (row.record.expiresAt = new Date(Date.now() - 1)));
    expect(await api(b).state()).toMatchObject({
      step: 'CLOSED',
      requestStatus: 'EXPIRED',
      expiresAt: null,
    });
    expect(await refused(api(b).accept(consentId()))).toBe('409 WRONG_STEP');
  });
});

describe('the steps, in order', () => {
  it('email code, consent (version pinned), then SIGN; events record authMethod', async () => {
    const { b, id, me } = await atConsent();
    expect(notify.sent[0]).toMatchObject({
      template: 'esign.code',
      to: 'jamie@client.test',
      businessId: w.a,
      data: { title: 'Fake engagement letter' },
    });
    expect(await api(b).consent()).toEqual({
      versionId: consentId(),
      version: 1,
      bodyMarkdown: 'Fake consent',
    });
    const state = await api(b).accept(consentId());
    expect(state.step).toBe('SIGN');
    expect(signers.pinned.of(w.a).get(me.id)).toBe(consentId());
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.actorKind, e.authMethod])).toEqual([
      ['AUTH_PASSED', 'SIGNER', 'EMAIL_CODE'],
      ['CONSENTED', 'SIGNER', 'EMAIL_CODE'],
    ]);
    expect(w.audit.entries.map((e) => e.action)).toEqual([
      'esign.signer_link_opened',
      'esign.signer_code_sent',
      'esign.signer_auth_passed',
      'esign.signer_consented',
    ]);
  });

  it('a reopened link keeps the pinned consent but asks for a new code', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { b: first, id, me } = await atConsent();
    await api(first).accept(consentId());
    const b = new Browser();
    expect((await api(b).open(link(w.a, id, me.id))).step).toBe('VERIFY_EMAIL');
    vi.setSystemTime(Date.now() + MIN + 1);
    await api(b).sendCode();
    expect((await api(b).verifyCode(notify.lastCode)).step).toBe('SIGN');
  });

  it('access code: wrong is 400 CODE_INVALID, right moves on to consent', async () => {
    const me = signer({
      authMethod: 'ACCESS_CODE',
      accessCodeHash: null,
    });
    me.accessCodeHash = hasher.hash(me.id, 'ACCESS', ACCESS);
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    expect(await refused(api(b).accessCode('WRONG123'))).toBe('400 CODE_INVALID');
    expect((await api(b).accessCode(ACCESS)).step).toBe('CONSENT');
    const events = await w.repo.events(w.a, id);
    expect(events.map((e) => [e.type, e.authMethod])).toEqual([
      ['AUTH_FAILED', 'ACCESS_CODE'],
      ['AUTH_PASSED', 'ACCESS_CODE'],
    ]);
  });

  it('every call out of order answers 409 WRONG_STEP', async () => {
    const me = signer();
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    const c = api(b);
    // VERIFY_EMAIL
    for (const call of [
      () => c.accessCode(ACCESS),
      () => c.consent(),
      () => c.accept(consentId()),
    ]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
    await c.sendCode();
    await c.verifyCode(notify.lastCode);
    // CONSENT
    for (const call of [
      () => c.sendCode(),
      () => c.verifyCode('123456'),
      () => c.accessCode(ACCESS),
    ]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
    await c.accept(consentId());
    // SIGN
    for (const call of [
      () => c.sendCode(),
      () => c.verifyCode('123456'),
      () => c.consent(),
      () => c.accept(consentId()),
    ]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
  });

  it('a WAITING signer can do nothing yet', async () => {
    const me = signer({ status: 'WAITING' });
    const id = await sent(w.a, [me]);
    const b = new Browser();
    expect((await api(b).open(link(w.a, id, me.id))).step).toBe('WAITING');
    for (const call of [() => api(b).sendCode(), () => api(b).consent()]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
  });

  it('409 CONSENT_OUTDATED when the firm published a newer version meanwhile', async () => {
    const { b } = await atConsent();
    const old = consentId();
    signers.consents.set(w.a, { id: randomUUID(), version: 2, bodyMarkdown: 'Fake v2' });
    expect(await refused(api(b).accept(old))).toBe('409 CONSENT_OUTDATED');
    expect((await api(b).accept(consentId())).step).toBe('SIGN');
  });
});

describe('code limits', () => {
  it('5 wrong tries lock the code, even the right one after; a new code works again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const me = signer();
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    await api(b).sendCode();
    const code = notify.lastCode;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++)
      expect(await refused(api(b).verifyCode(wrong))).toBe('400 CODE_INVALID');
    expect(await refused(api(b).verifyCode(wrong))).toBe('429 CODE_LOCKED');
    expect(await refused(api(b).verifyCode(code))).toBe('429 CODE_LOCKED');
    // A fresh cookie does not reset the tries: they live on the server.
    const again = new Browser();
    await api(again).open(link(w.a, id, me.id));
    expect(await refused(api(again).verifyCode(code))).toBe('429 CODE_LOCKED');
    expect(await refused(api(b).sendCode())).toBe('429 CODE_TOO_SOON');
    vi.setSystemTime(Date.now() + MIN + 1);
    await api(b).sendCode();
    expect((await api(b).verifyCode(notify.lastCode)).step).toBe('CONSENT');
    const failed = (await w.repo.events(w.a, id)).filter((e) => e.type === 'AUTH_FAILED');
    expect(failed).toHaveLength(5);
  });

  it('a code expires after 15 minutes; with no code sent nothing passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const me = signer();
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    expect(await refused(api(b).verifyCode('123456'))).toBe('400 CODE_INVALID');
    await api(b).sendCode();
    vi.setSystemTime(Date.now() + 15 * MIN + 1);
    expect(await refused(api(b).verifyCode(notify.lastCode))).toBe('400 CODE_INVALID');
  });

  it('one code a minute and 5 an hour per recipient', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const me = signer();
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    const sent1 = await api(b).sendCode();
    expect(sent1.sentTo).toBe('j***@client.test');
    expect(Date.parse(sent1.resendAfter) - Date.now()).toBe(MIN);
    expect(await refused(api(b).sendCode())).toBe('429 CODE_TOO_SOON');
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + MIN + 1);
      await api(b).sendCode();
    }
    vi.setSystemTime(Date.now() + MIN + 1);
    expect(await refused(api(b).sendCode())).toBe('429 CODE_TOO_SOON');
    expect(notify.sent).toHaveLength(5);
  });

  it('5 wrong access codes lock it', async () => {
    const me = signer({ authMethod: 'ACCESS_CODE' });
    me.accessCodeHash = hasher.hash(me.id, 'ACCESS', ACCESS);
    const id = await sent(w.a, [me]);
    const b = new Browser();
    await api(b).open(link(w.a, id, me.id));
    for (let i = 0; i < 4; i++)
      expect(await refused(api(b).accessCode('WRONG123'))).toBe('400 CODE_INVALID');
    expect(await refused(api(b).accessCode('WRONG123'))).toBe('429 CODE_LOCKED');
    expect(await refused(api(b).accessCode(ACCESS))).toBe('429 CODE_LOCKED');
  });
});

describe('isolation', () => {
  it("one signer's cookie never acts for another, and the codes are bound to the recipient", async () => {
    const one = signer({ name: 'Fake One', email: 'one@client.test' });
    const two = signer({ name: 'Fake Two', email: 'two@client.test' });
    const id = await sent(w.a, [one, two]);
    const b1 = new Browser();
    const b2 = new Browser();
    await api(b1).open(link(w.a, id, one.id));
    await api(b2).open(link(w.a, id, two.id));
    await api(b2).sendCode();
    const twosCode = notify.lastCode;
    await api(b1).sendCode();
    if (notify.lastCode !== twosCode) {
      expect(await refused(api(b1).verifyCode(twosCode))).toBe('400 CODE_INVALID');
    }
    // Two's tries are untouched by one's.
    expect((await api(b2).verifyCode(twosCode)).signerName).toBe('Fake Two');
    expect((await api(b1).state()).step).toBe('VERIFY_EMAIL');
    await api(b2).accept(consentId());
    expect(signers.pinned.of(w.a).has(one.id)).toBe(false);
  });

  it("another firm's cookie or token is 404 here, and its rows stay untouched", async () => {
    const bMe = signer();
    const bId = await sent(w.b, [bMe]);
    const b = new Browser();
    await api(b, SLUG_B).open(link(w.b, bId, bMe.id));
    const moved = new Browser();
    moved.jar.set(`fv_sign_${SLUG_A}`, b.jar.get(`fv_sign_${SLUG_B}`)!);
    expect(await refused(api(moved).sendCode())).toBe('404 LINK_INVALID');
    expect(notify.sent).toEqual([]);
    expect(await w.repo.events(w.a, bId)).toEqual([]);
  });
});

describe('nothing secret leaves', () => {
  it('no token, code, access code, cookie or address in the logs, audit or timeline', async () => {
    const said: unknown[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        said.push(args);
      });
    }
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void said.push(args));
    const me = signer({ authMethod: 'EMAIL_CODE' });
    const id = await sent(w.a, [me]);
    const b = new Browser();
    const token = link(w.a, id, me.id);
    await api(b).open(token);
    await api(b).sendCode();
    const code = notify.lastCode;
    await api(b)
      .verifyCode(code === '999999' ? '999998' : '999999')
      .catch(() => null);
    await api(b).verifyCode(code);
    await api(b).accept(consentId());
    const cookie = b.jar.get(`fv_sign_${SLUG_A}`)!;
    const out = JSON.stringify([said, w.audit.entries, await w.repo.events(w.a, id)]);
    for (const secret of [token, code, cookie, 'jamie@client.test', ...b.jar.values()]) {
      expect(out).not.toContain(secret);
    }
    for (const entry of w.audit.entries) {
      expect(Object.keys(entry.metadata as object).sort()).toEqual(
        entry.action.endsWith('auth_failed') || entry.action.endsWith('auth_passed')
          ? ['authMethod', 'requestId']
          : entry.action.endsWith('consented')
            ? ['consentVersionId', 'requestId']
            : ['requestId'],
      );
    }
  });
});
