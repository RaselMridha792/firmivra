// R13 signer routes, slice 1, on the in-memory ports (esign-fakes.ts) with R18's real link
// tokens, code HMAC and sealed cookie: opening the link (unknown, expired, used, corrected,
// wrong-slug and other firm's tokens all LINK_INVALID), the cookie (missing, other slug, other
// firm, tampered), every step and every out-of-order call (409 WRONG_STEP), the email and access
// codes with their limits, consent, a cross-recipient check and nothing secret in the logs,
// audit or timeline. Slice 2: session/end, the packet, the envelope (VIEWED), adopt, finish with
// the routing hand-off and the completion mark, and decline (the sender's email).
// Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignField, EsignRouting } from '@firmivra/types';
import type {
  EsignDocumentRecord,
  EsignRecipientRecord,
} from '../../src/esign/requests/esign.repository.js';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import {
  HmacCodeHasher,
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import { EsignRequestsService } from '../../src/esign/requests/requests.service.js';
import { EsignSendService } from '../../src/esign/requests/send.service.js';
import type { SignerLink } from '../../src/esign/signer/signer.repository.js';
import { EsignSignerService } from '../../src/esign/signer/signer.service.js';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';
import { png } from './esign-engine-fixtures.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  fakePdf,
  InMemorySignerRepository,
} from './esign-fakes.js';

const secrets = { CLIENT: 'fake-client-secret', STAFF: 'fake-staff-secret' };
const SLUG_A = 'fake-firm-a';
const SLUG_B = 'fake-firm-b';
const ACCESS = 'FAKE1234';
const PACKET = new TextEncoder().encode('%PDF-fake-packet');
const MIN = 60_000;
const PORTAL = 'https://portal.example.test';
const APP = 'https://app.example.test';

class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage[] = [];
  fail = false;
  send(message: NotifyMessage): Promise<void> {
    if (this.fail) return Promise.reject(new Error('fake send failure'));
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
  get lastCode(): string {
    const codes = this.sent.filter(
      (m): m is NotifyMessage<'esign.code'> => m.template === 'esign.code',
    );
    return codes.at(-1)!.data.code;
  }
  /** The raw token in the newest invitation to that address. */
  tokenFor(to: string): string {
    const mail = this.sent.filter((m) => m.template === 'esign.request' && m.to === to).at(-1);
    return /#t=([\w-]{43})$/.exec((mail as NotifyMessage<'esign.request'>).data.link)![1]!;
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
  const requests = new EsignRequestsService(
    w.repo,
    w.directory,
    w.modules,
    w.store,
    w.audit,
    fakeHasher,
  );
  const prepare = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
  const sender = new EsignSendService(
    requests,
    prepare,
    w.repo,
    w.directory,
    esignRules,
    fakePdf,
    w.store,
    tokens,
    notify,
    w.audit,
    { PORTAL_BASE_URL: `${PORTAL}/` },
  );
  svc = new EsignSignerService(
    { activeFirm },
    w.modules,
    signers,
    w.repo,
    w.directory,
    tokens,
    hasher,
    new SealedSignerCookie(secrets, true),
    w.store,
    new PngSignatureCheck(),
    esignRules,
    sender,
    notify,
    w.audit,
    { APP_BASE_URL: APP },
    // Both in esign-completion.test.ts and esign-signer-files.test.ts.
    {
      complete: () => Promise.resolve('NOT_DUE' as const),
      stampedPacket: (_b, _q, packet) => Promise.resolve(packet),
    },
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
  end: () => svc.end(slug, b.res),
  packet: async () => svc.packet(await svc.call(slug, b.req, 'SIGN')),
  envelope: async () => svc.envelope(await svc.call(slug, b.req, 'SIGN')),
  adopt: async (body: Parameters<EsignSignerService['adopt']>[1] = TYPED) =>
    svc.adopt(await svc.call(slug, b.req, 'SIGN'), body),
  finish: async (values: { fieldId: string; value: string }[] = []) =>
    svc.finish(await svc.call(slug, b.req, 'SIGN'), values),
  decline: async (reason: string | null = null) =>
    svc.decline(await svc.call(slug, b.req, 'CONSENT', 'SIGN'), reason),
});

const TYPED = {
  signature: {
    printedName: 'Fake Signer',
    method: 'TYPED' as const,
    typedSignature: 'fake signer',
  },
};

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

/** A SENT request of the firm with these recipients and fields, its packet stored; its id. */
async function sent(
  firm: string,
  recipients: EsignRecipientRecord[],
  {
    fields = [] as EsignField[],
    routing = 'PARALLEL' as EsignRouting,
    scan = 'CLEAN' as 'CLEAN' | 'PENDING' | 'INFECTED',
  } = {},
) {
  const record = await w.repo.createRequest(firm, {
    title: 'Fake engagement letter',
    source: 'TAB',
    clientId: null,
    engagementId: null,
    senderUserId: firm === w.a ? w.users.ownerA : w.users.ownerB,
    internalNote: 'internal only',
    emailSubject: null,
    emailMessage: null,
    routing,
    expiryDays: 10,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
  });
  const sha = createHash('sha256').update(PACKET).digest('hex');
  await w.store.put(
    firm,
    w.store.keyFor(firm, record.id, `packet-${sha}.pdf`),
    PACKET,
    'application/pdf',
  );
  const doc = {
    id: randomUUID(),
    scanStatus: scan,
    pageSizes: [
      { width: 612, height: 792 },
      { width: 792, height: 612 },
    ],
  } as EsignDocumentRecord;
  w.repo.seed(firm, record.id, (row) => {
    Object.assign(row.record, {
      status: 'SENT',
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 86_400_000),
      originalSha256: sha,
    });
    row.parts.recipients = structuredClone(recipients);
    row.parts.documents = [doc];
    row.parts.pagePlan = [
      { documentId: doc.id, page: 0, rotation: 0 },
      { documentId: doc.id, page: 1, rotation: 90 },
    ];
    row.parts.fields = structuredClone(fields);
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
      [link(w.a, id, me.id, { purpose: 'COPY' }), SLUG_A], // the copy link: slice 3
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

// ---------- Slice 2 ----------

const field = (
  recipientId: string | null,
  type: EsignField['type'],
  extra: Partial<EsignField> = {},
): EsignField => ({
  id: randomUUID(),
  recipientId,
  type,
  pageIndex: 0,
  ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
  required: true,
  label: null,
  mergeKey: null,
  options: [],
  groupKey: null,
  value: null,
  filled: false,
  ...extra,
});

/** A LINK signer at SIGN (no code to pass), in a browser of their own. */
async function atSign(id: string, me: EsignRecipientRecord, b = new Browser(), firm = w.a) {
  const slug = firm === w.a ? SLUG_A : SLUG_B;
  await api(b, slug).open(link(firm, id, me.id));
  await api(b, slug).accept(consentId(firm));
  return b;
}
const linkSigner = (extra: Partial<EsignRecipientRecord> = {}) =>
  signer({ authMethod: 'LINK', ...extra });
const status = async (id: string, firm = w.a) => (await w.repo.findRequest(firm, id))?.status;
const recipient = async (id: string, rid: string) =>
  (await w.repo.parts(w.a, id)).recipients.find((r) => r.id === rid)!;

describe('session/end and the packet', () => {
  it('session/end clears the cookie', async () => {
    const { b } = await atConsent();
    await api(b).end();
    expect(b.jar.size).toBe(0);
    expect(await refused(api(b).state())).toBe('404 LINK_INVALID');
  });

  it('the packet at SIGN only, while every file is CLEAN', async () => {
    const me = linkSigner();
    const b = await atSign(await sent(w.a, [me]), me);
    expect(Buffer.from(await api(b).packet()).toString()).toBe('%PDF-fake-packet');
    for (const [scan, answer] of [
      ['PENDING', '409 SCAN_PENDING'],
      ['INFECTED', '409 FILE_BLOCKED'],
    ] as const) {
      const other = linkSigner();
      const id = await sent(w.a, [other], { scan });
      expect(await refused(api(await atSign(id, other)).packet())).toBe(answer);
    }
  });
});

describe('the envelope', () => {
  it('shows their own fields only, suggestions, page sizes as shown and progress', async () => {
    const me = linkSigner({ name: 'Fake Signer', email: 'jamie@client.test' });
    const other = linkSigner({ name: 'Fake Other', routingOrder: 2 });
    const mine = [field(me.id, 'PRINTED_NAME'), field(me.id, 'EMAIL'), field(me.id, 'SIGNATURE')];
    const theirs = field(other.id, 'TEXT');
    const bySender = field(null, 'TEXT', { value: 'sender value' });
    const id = await sent(w.a, [me, other], { fields: [...mine, theirs, bySender] });
    const env = await api(await atSign(id, me)).envelope();
    expect(env.fields.map((f) => [f.id, f.value])).toEqual([
      [mine[0]!.id, 'Fake Signer'],
      [mine[1]!.id, 'jamie@client.test'],
      [mine[2]!.id, null],
    ]);
    expect(JSON.stringify(env)).not.toContain('sender value');
    expect(JSON.stringify(env)).not.toContain('internal only');
    expect(env).toMatchObject({
      title: 'Fake engagement letter',
      senderName: 'owner-a',
      me: { recipientId: me.id, kind: 'SIGNER', role: 'CLIENT' },
      packetUrl: `/api/v1/portal/${SLUG_A}/sign/packet`,
      pageCount: 2,
      pageSizes: [
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ],
      autoSignaturePage: false,
      adopted: null,
      progress: [
        { name: 'Fake Signer', role: 'CLIENT', signed: false },
        { name: 'Fake Other', role: 'CLIENT', signed: false },
      ],
    });
  });

  it('the first read records VIEWED once (status and event with authMethod)', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me, linkSigner()]);
    const b = await atSign(id, me);
    await api(b).envelope();
    await api(b).envelope();
    expect(await status(id)).toBe('VIEWED');
    expect((await recipient(id, me.id)).status).toBe('VIEWED');
    const viewed = (await w.repo.events(w.a, id)).filter((e) => e.type === 'VIEWED');
    expect(viewed.map((e) => [e.recipient?.id, e.authMethod])).toEqual([[me.id, 'LINK']]);
    expect(w.audit.entries.filter((e) => e.action === 'esign.signer_viewed')).toHaveLength(1);
  });

  it('no fields placed: the signature page is added', async () => {
    const me = linkSigner();
    const env = await api(await atSign(await sent(w.a, [me]), me)).envelope();
    expect(env).toMatchObject({ fields: [], autoSignaturePage: true });
  });
});

describe('adopt', () => {
  it('typed, drawn and uploaded; replaces until they finish', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me]);
    const b = await atSign(id, me);
    expect((await api(b).adopt()).adopted).toEqual({ method: 'TYPED', hasInitials: false });
    const image = Buffer.from(png(400, 150)).toString('base64');
    const drawn = await api(b).adopt({
      signature: { printedName: 'Fake Signer', method: 'DRAWN', imagePng: image },
      initials: { method: 'TYPED', text: 'FS' },
    });
    expect(drawn.adopted).toEqual({ method: 'DRAWN', hasInitials: true });
    const stored = signers.adoptions.of(w.a).get(me.id)!;
    expect(stored.signature.png).toEqual(png(400, 150));
    expect(stored.initials).toEqual({ method: 'TYPED', text: 'FS', png: null });
    const uploaded = await api(b).adopt({
      signature: { printedName: 'Fake Signer', method: 'UPLOADED', imagePng: image },
      initials: { method: 'DRAWN', imagePng: image },
    });
    expect(uploaded.adopted).toEqual({ method: 'UPLOADED', hasInitials: true });
    expect(w.audit.entries.filter((e) => e.action === 'esign.signer_adopted').at(-1)).toEqual({
      action: 'esign.signer_adopted',
      entity: { type: 'esign_recipient', id: me.id },
      metadata: { requestId: id, method: 'UPLOADED' },
      at: { businessId: w.a },
    });
  });

  it('400 IMAGE_INVALID for a PNG over 1600x600 or not a PNG', async () => {
    const me = linkSigner();
    const b = await atSign(await sent(w.a, [me]), me);
    for (const bytes of [png(1601, 100), png(100, 601), Buffer.from('iVBORw0KGgo-not-really')]) {
      const imagePng = Buffer.from(bytes).toString('base64');
      const signature = { printedName: 'Fake Signer', method: 'DRAWN' as const, imagePng };
      expect(await refused(api(b).adopt({ signature }))).toBe('400 IMAGE_INVALID');
      const initials = { method: 'UPLOADED' as const, imagePng };
      expect(await refused(api(b).adopt({ ...TYPED, initials }))).toBe('400 IMAGE_INVALID');
    }
    expect(signers.adoptions.of(w.a).has(me.id)).toBe(false);
  });
});

describe('finish', () => {
  it('checks the adopted signature, their own fields and the required ones', async () => {
    const me = linkSigner();
    const other = linkSigner();
    const fields = [
      field(me.id, 'SIGNATURE'),
      field(me.id, 'INITIALS'),
      field(me.id, 'TEXT'),
      field(me.id, 'CHECKBOX'),
      field(me.id, 'DROPDOWN', { options: ['One', 'Two'] }),
      field(me.id, 'RADIO', { groupKey: 'g', options: ['a'] }),
      field(me.id, 'RADIO', { groupKey: 'g', options: ['b'] }),
      field(me.id, 'TEXT', { required: false }),
      field(other.id, 'TEXT'),
    ];
    const [sig, , text, box, drop, radioA, radioB, optional, theirs] = fields;
    const id = await sent(w.a, [me, other], { fields });
    const b = await atSign(id, me);
    const good = [
      { fieldId: text!.id, value: ' Fake title ' },
      { fieldId: box!.id, value: 'true' },
      { fieldId: drop!.id, value: 'Two' },
      { fieldId: radioA!.id, value: 'true' },
    ];
    expect(await refused(api(b).finish(good))).toBe('409 SIGNATURE_REQUIRED');
    await api(b).adopt(); // no initials, but an INITIALS field
    expect(await refused(api(b).finish(good))).toBe('409 SIGNATURE_REQUIRED');
    await api(b).adopt({ ...TYPED, initials: { method: 'TYPED', text: 'FS' } });
    for (const bad of [
      [{ fieldId: theirs!.id, value: 'x' }], // another signer's field
      [{ fieldId: sig!.id, value: 'x' }], // stamped by the server
      [{ fieldId: randomUUID(), value: 'x' }],
      [{ fieldId: box!.id, value: 'yes' }],
      [{ fieldId: drop!.id, value: 'Three' }],
      [
        { fieldId: radioA!.id, value: 'true' },
        { fieldId: radioB!.id, value: 'true' },
      ], // two choices in one radio group
    ]) {
      expect(await refused(api(b).finish(bad))).toBe('400 VALIDATION_FAILED');
    }
    for (const short of [
      good.filter((v) => v.fieldId !== text!.id),
      good.map((v) => (v.fieldId === box!.id ? { ...v, value: 'false' } : v)),
      good.filter((v) => v.fieldId !== radioA!.id),
      good.map((v) => (v.fieldId === text!.id ? { ...v, value: '   ' } : v)),
    ]) {
      expect(await refused(api(b).finish(short))).toBe('409 REQUIRED_FIELDS_MISSING');
    }
    const done = await api(b).finish([...good, { fieldId: optional!.id, value: '' }]);
    expect(done).toMatchObject({ step: 'DONE', expiresAt: null });
    expect(Object.fromEntries(signers.values.of(w.a))).toEqual({
      [text!.id]: 'Fake title',
      [box!.id]: 'true',
      [drop!.id]: 'Two',
      [radioA!.id]: 'true',
    });
    expect(await status(id)).toBe('PARTIALLY_SIGNED');
    expect(signers.completionDue.has(id)).toBe(false);
    const signed = (await w.repo.events(w.a, id)).filter((e) => e.type === 'SIGNED');
    expect(signed.map((e) => [e.recipient?.id, e.authMethod])).toEqual([[me.id, 'LINK']]);
    // Used: every signing call and the link itself.
    expect(await refused(api(b).finish(good))).toBe('409 WRONG_STEP');
    expect(await refused(api(b).envelope())).toBe('409 WRONG_STEP');
    expect(await refused(api(new Browser()).open(link(w.a, id, me.id)))).toBe('404 LINK_INVALID');
  });

  it('a required attachment blocks finish until uploaded (esign-signer-files.test.ts)', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me], { fields: [field(me.id, 'ATTACHMENT')] });
    const b = await atSign(id, me);
    await api(b).adopt();
    expect(await refused(api(b).finish())).toBe('409 REQUIRED_FIELDS_MISSING');
  });

  it('SEQUENTIAL: the turn passes to the next routing order with a fresh link by email', async () => {
    const first = linkSigner({ name: 'Fake First', email: 'first@client.test' });
    const waiting = { status: 'WAITING' as const, sentAt: null };
    const second = signer({ email: 'second@client.test', routingOrder: 2, ...waiting });
    const third = linkSigner({ email: 'third@client.test', routingOrder: 3, ...waiting });
    const portal = linkSigner({ email: 'p@client.test', routingOrder: 2, delivery: 'PORTAL' });
    Object.assign(portal, waiting);
    const id = await sent(w.a, [first, second, third, portal], { routing: 'SEQUENTIAL' });
    // The second signer's own link opens on WAITING until the first finished.
    expect((await api(new Browser()).open(link(w.a, id, second.id))).step).toBe('WAITING');
    const b = await atSign(id, first);
    await api(b).adopt();
    await api(b).finish();
    expect(await status(id)).toBe('PARTIALLY_SIGNED');
    expect((await recipient(id, second.id)).status).toBe('SENT');
    expect((await recipient(id, portal.id)).status).toBe('SENT');
    expect((await recipient(id, third.id)).status).toBe('WAITING');
    const invites = notify.sent.filter((m) => m.template === 'esign.request');
    expect(invites.map((m) => m.to).sort()).toEqual(['p@client.test', 'second@client.test']);
    expect(invites.find((m) => m.to === 'p@client.test')).toMatchObject({
      data: { link: `${PORTAL}/${SLUG_A}/signatures`, senderName: 'owner-a' },
    });
    expect([...w.repo.outbox.of(w.a).values()].map((e) => e.status)).toEqual(['SENT', 'SENT']);
    // The new link works and starts at the email code; only its hash is stored.
    const token = notify.tokenFor('second@client.test');
    expect(JSON.stringify([...signers.links.of(w.a).entries()])).not.toContain(token);
    expect((await api(new Browser()).open(token)).step).toBe('VERIFY_EMAIL');
    expect(signers.completionDue.has(id)).toBe(false);
  });

  it('PARALLEL: no hand-off; the last signer marks the request for completion', async () => {
    const one = linkSigner({ email: 'one@client.test' });
    const two = linkSigner({ email: 'two@client.test' });
    const cc = linkSigner({ kind: 'CC', status: 'WAITING' });
    const id = await sent(w.a, [one, two, cc]);
    const b1 = await atSign(id, one);
    const b2 = await atSign(id, two);
    await api(b1).adopt();
    await api(b2).adopt();
    // two's call is read before one finishes: its write is stale and is retried from a new read.
    const call = await svc.call(SLUG_A, b2.req, 'SIGN');
    await api(b1).finish();
    expect(notify.sent.filter((m) => m.template === 'esign.request')).toEqual([]);
    expect(signers.completionDue.has(id)).toBe(false);
    expect((await svc.finish(call, [])).step).toBe('DONE');
    expect(signers.completionDue.has(id)).toBe(true);
    // COMPLETED comes with the final PDF (the completion slice).
    expect(await status(id)).toBe('PARTIALLY_SIGNED');
    expect((await api(b2).state()).step).toBe('DONE');
  });

  it('a single signer goes straight to the completion mark', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me]);
    const b = await atSign(id, me);
    await api(b).envelope();
    await api(b).adopt();
    await api(b).finish();
    expect(signers.completionDue.has(id)).toBe(true);
    expect(await status(id)).toBe('PARTIALLY_SIGNED');
  });

  it('409 REQUEST_CLOSED when the request closed between the read and the write', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me]);
    const b = await atSign(id, me);
    await api(b).adopt();
    const call = await svc.call(SLUG_A, b.req, 'SIGN');
    w.repo.seed(w.a, id, (row) => (row.record.status = 'VOIDED'));
    expect(await refused(svc.finish(call, []))).toBe('409 REQUEST_CLOSED');
    expect(await refused(svc.adopt(call, TYPED))).toBe('409 REQUEST_CLOSED');
  });
});

describe('decline', () => {
  it('declines the recipient and the request; the sender is emailed, never the reason', async () => {
    const { b, id, me } = await atConsent();
    const state = await api(b).decline('Fake reason');
    expect(state).toMatchObject({ step: 'DECLINED', expiresAt: null });
    expect(await status(id)).toBe('DECLINED');
    expect((await w.repo.events(w.a, id)).at(-1)).toMatchObject({
      type: 'DECLINED',
      reason: 'Fake reason',
      authMethod: 'EMAIL_CODE',
    });
    expect(notify.sent.at(-1)).toEqual({
      template: 'esign.declined',
      to: 'owner-a@firm.test',
      businessId: w.a,
      data: {
        name: 'owner-a',
        title: 'Fake engagement letter',
        signerName: 'Fake Signer',
        link: `${APP}/firm-sign/requests/${id}`,
      },
    });
    expect(JSON.stringify([w.audit.entries, notify.sent])).not.toContain('Fake reason');
    expect(await refused(api(b).decline())).toBe('409 WRONG_STEP');
    expect(await refused(api(new Browser()).open(link(w.a, id, me.id)))).toBe('404 LINK_INVALID');
  });

  it('a failed email still declines; another signer then sees CLOSED', async () => {
    const one = linkSigner();
    const two = linkSigner();
    const id = await sent(w.a, [one, two]);
    const b2 = await atSign(id, two);
    const b1 = await atSign(id, one);
    notify.fail = true;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect((await api(b1).decline()).step).toBe('DECLINED');
    expect(await api(b2).state()).toMatchObject({ step: 'CLOSED', requestStatus: 'DECLINED' });
    expect(await refused(api(b2).finish())).toBe('409 WRONG_STEP');
  });

  it('409 REQUEST_CLOSED when the request closed between the read and the write', async () => {
    const { b, id } = await atConsent();
    const call = await svc.call(SLUG_A, b.req, 'CONSENT', 'SIGN');
    w.repo.seed(w.a, id, (row) => (row.record.status = 'VOIDED'));
    expect(await refused(svc.decline(call, null))).toBe('409 REQUEST_CLOSED');
  });
});

describe('slice 2 routes: wrong order, slug, firm and recipient', () => {
  it('every new signing call before SIGN answers 409 WRONG_STEP', async () => {
    const { b } = await atConsent();
    for (const call of [
      () => api(b).envelope(),
      () => api(b).packet(),
      () => api(b).adopt(),
      () => api(b).finish(),
    ]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
    const waiting = linkSigner({ status: 'WAITING' });
    const id = await sent(w.a, [waiting]);
    const bw = new Browser();
    await api(bw).open(link(w.a, id, waiting.id));
    for (const call of [
      () => api(bw).envelope(),
      () => api(bw).decline(),
      () => api(bw).finish(),
    ]) {
      expect(await refused(call())).toBe('409 WRONG_STEP');
    }
  });

  it('404 LINK_INVALID under another slug, from another firm, with no cookie or Firm Sign off', async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me]);
    const b = await atSign(id, me);
    const bMe = linkSigner();
    const bId = await sent(w.b, [bMe]);
    const bB = await atSign(bId, bMe, new Browser(), w.b);
    const moved = new Browser();
    moved.jar.set(`fv_sign_${SLUG_A}`, bB.jar.get(`fv_sign_${SLUG_B}`)!);
    const calls = (x: ReturnType<typeof api>) => [
      () => x.envelope(),
      () => x.packet(),
      () => x.adopt(),
      () => x.finish(),
      () => x.decline(),
    ];
    for (const x of [api(b, SLUG_B), api(b, 'no-such-firm'), api(moved), api(new Browser())]) {
      for (const call of calls(x)) expect(await refused(call())).toBe('404 LINK_INVALID');
    }
    w.modules.set(w.a, 'esign', false);
    for (const call of calls(api(b))) expect(await refused(call())).toBe('404 LINK_INVALID');
    expect(await status(id)).toBe('SENT');
    expect(await status(bId, w.b)).toBe('SENT');
    expect(signers.adoptions.of(w.b).size).toBe(0);
  });

  it("an expired request's cookie can no longer sign; its link is 404", async () => {
    const me = linkSigner();
    const id = await sent(w.a, [me]);
    const b = await atSign(id, me);
    await api(b).adopt();
    w.repo.seed(w.a, id, (row) => (row.record.expiresAt = new Date(Date.now() - 1)));
    expect(await refused(api(b).finish())).toBe('409 WRONG_STEP');
    expect(await refused(api(new Browser()).open(link(w.a, id, me.id)))).toBe('404 LINK_INVALID');
  });

  it("one signer's cookie never touches another's fields, signature or status", async () => {
    const one = linkSigner();
    const two = linkSigner();
    const twos = field(two.id, 'TEXT');
    const id = await sent(w.a, [one, two], { fields: [field(one.id, 'SIGNATURE'), twos] });
    const b1 = await atSign(id, one);
    await api(b1).adopt();
    expect((await api(b1).envelope()).fields.map((f) => f.id)).not.toContain(twos.id);
    expect(await refused(api(b1).finish([{ fieldId: twos.id, value: 'x' }]))).toBe(
      '400 VALIDATION_FAILED',
    );
    await api(b1).finish();
    expect(signers.adoptions.of(w.a).has(two.id)).toBe(false);
    expect(signers.values.of(w.a).has(twos.id)).toBe(false);
    expect((await recipient(id, two.id)).status).toBe('SENT');
  });
});

describe('slice 2: nothing secret leaves', () => {
  it('no field value, signature, token or address in the logs, audit or timeline', async () => {
    const said: unknown[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        said.push(args);
      });
    }
    const one = linkSigner({ email: 'one@client.test' });
    const two = signer({ email: 'two@client.test', routingOrder: 2, status: 'WAITING' });
    const text = field(one.id, 'TEXT');
    const id = await sent(w.a, [one, two], { routing: 'SEQUENTIAL', fields: [text] });
    const b = await atSign(id, one);
    await api(b).envelope();
    const imagePng = Buffer.from(png(300, 100)).toString('base64');
    await api(b).adopt({ signature: { printedName: 'Fake Signer', method: 'DRAWN', imagePng } });
    await api(b).finish([{ fieldId: text.id, value: 'Fake secret value' }]);
    const token = notify.tokenFor('two@client.test');
    const out = JSON.stringify([said, w.audit.entries, await w.repo.events(w.a, id)]);
    for (const secret of ['Fake secret value', imagePng.slice(0, 40), token, 'two@client.test']) {
      expect(out).not.toContain(secret);
    }
    for (const entry of w.audit.entries) {
      const keys = Object.keys(entry.metadata as object).filter((k) => k !== 'requestId');
      expect(keys.every((k) => ['authMethod', 'consentVersionId', 'method'].includes(k))).toBe(
        true,
      );
    }
  });
});
