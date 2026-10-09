// R13 step 9, the portal's Signature center on the in-memory ports (esign-fakes.ts) with R18's
// real sealed signer cookie: a client login's own rows by tab and state, never another
// household login's, client's or firm's (404); drafts never show; signing from the portal with
// no email or access code (the portal sign-in is the check, recorded as PORTAL_SESSION) and on
// through the signer routes; the completed files; ids only in the audit log. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { MySignatureList, SignerState } from '@firmivra/types';
import { EsignCenterService, type PortalSigner } from '../../src/esign/center/center.service.js';
import type { CompletedFile } from '../../src/esign/completion/completion.repository.js';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import {
  HmacCodeHasher,
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import type {
  EsignRecipientRecord,
  EsignRequestRecord,
} from '../../src/esign/requests/esign.repository.js';
import type { EsignSendService } from '../../src/esign/requests/send.service.js';
import { EsignSignerService } from '../../src/esign/signer/signer.service.js';
import {
  esignWorld,
  type EsignWorld,
  InMemoryCenterRepository,
  InMemorySignerRepository,
} from './esign-fakes.js';

const secrets = { CLIENT: 'fake-client-secret', STAFF: 'fake-staff-secret' };
const SLUG_A = 'fake-firm-a';
const DAY = 24 * 60 * 60 * 1000;

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
let signer: EsignSignerService;
let svc: EsignCenterService;
let consentId: string;
/** Each request's completed files (the completion repository's `files`). */
let completedFiles: Map<string, { final: CompletedFile; certificate: CompletedFile }>;
let primary: PortalSigner;
let spouse: PortalSigner;
let c2: PortalSigner;
let loginB: PortalSigner;

beforeEach(() => {
  w = esignWorld();
  signers = new InMemorySignerRepository(w.repo);
  completedFiles = new Map();
  const cookie = new SealedSignerCookie(secrets, true);
  const activeFirm = (slug: string) =>
    slug === SLUG_A
      ? Promise.resolve({ id: w.a, slug, name: 'Fake Firm A' })
      : Promise.reject(new NotFoundException());
  signer = new EsignSignerService(
    { activeFirm },
    w.modules,
    signers,
    w.repo,
    w.directory,
    new RandomLinkTokens(),
    new HmacCodeHasher(secrets, false),
    cookie,
    w.store,
    new PngSignatureCheck(),
    esignRules,
    {} as EsignSendService,
    { send: () => Promise.resolve() },
    w.audit,
    { APP_BASE_URL: 'https://app.example.test' },
    {
      complete: () => Promise.resolve('NOT_DUE' as const),
      stampedPacket: (_b, _q, p) => Promise.resolve(p),
    },
  );
  svc = new EsignCenterService(
    new InMemoryCenterRepository(w.repo),
    w.modules,
    w.directory,
    signers,
    signer,
    { files: (_b, requestId) => Promise.resolve(completedFiles.get(requestId) ?? null) },
    w.store,
    w.audit,
  );
  consentId = randomUUID();
  signers.consents.set(w.a, { id: consentId, version: 1, bodyMarkdown: 'Fake consent' });
  primary = { businessId: w.a, clientAccountId: w.ids.primary };
  spouse = { businessId: w.a, clientAccountId: w.ids.spouse };
  c2 = { businessId: w.a, clientAccountId: w.ids.c2Login };
  loginB = { businessId: w.b, clientAccountId: w.ids.loginB };
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

const recipient = (
  login: string | null,
  extra: Partial<EsignRecipientRecord> = {},
): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name: 'Fake Signer',
  email: 'fake@client.test',
  phone: null,
  link: login ? { type: 'CLIENT_LOGIN', clientAccountId: login } : { type: 'EXTERNAL' },
  delivery: 'PORTAL',
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

/** A request of the firm with these recipients, sent `daysAgo` (null: a DRAFT); its id. */
async function request(
  firm: string,
  recipients: EsignRecipientRecord[],
  over: Partial<EsignRequestRecord> = {},
  daysAgo: number | null = 1,
): Promise<string> {
  const record = await w.repo.createRequest(firm, {
    title: `Fake letter ${recipients[0]?.id.slice(0, 4)}`,
    source: 'TAB',
    clientId: firm === w.a ? w.ids.c1 : w.ids.cB,
    engagementId: null,
    senderUserId: firm === w.a ? w.users.staffA : w.users.ownerB,
    internalNote: 'internal only',
    emailSubject: null,
    emailMessage: null,
    routing: 'SEQUENTIAL',
    expiryDays: 30,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
  });
  const sentAt = daysAgo === null ? null : new Date(Date.now() - daysAgo * DAY);
  w.repo.seed(firm, record.id, (row) => {
    Object.assign(row.record, {
      status: sentAt ? 'SENT' : 'DRAFT',
      sentAt,
      expiresAt: sentAt && new Date(sentAt.getTime() + 30 * DAY),
      ...over,
    });
    row.parts.recipients = recipients;
  });
  return record.id;
}

describe('the Signature center list', () => {
  it('shows a login only its own recipients, by tab and state, newest first; never a draft', async () => {
    const turn = recipient(w.ids.primary);
    const waiting = recipient(w.ids.primary, { status: 'WAITING', routingOrder: 2 });
    const signed = recipient(w.ids.primary, { status: 'SIGNED', signedAt: new Date() });
    const cc = recipient(w.ids.primary, { kind: 'CC' });
    const inPerson = recipient(w.ids.primary, { delivery: 'IN_PERSON' });
    const done = recipient(w.ids.primary, { status: 'SIGNED', signedAt: new Date() });
    const declined = recipient(w.ids.primary, { status: 'DECLINED' });
    const voided = recipient(w.ids.primary);
    const expired = recipient(w.ids.primary);
    const late = recipient(w.ids.primary);
    const approver = recipient(w.ids.primary, { kind: 'APPROVER' });
    const draft = recipient(w.ids.primary, { status: 'WAITING' });
    const spouseOwn = recipient(w.ids.spouse);
    await request(w.a, [turn, spouseOwn], {}, 1);
    await request(w.a, [recipient(null, { status: 'SIGNED' }), waiting], {}, 2);
    await request(w.a, [signed, recipient(null)], { status: 'PARTIALLY_SIGNED' }, 3);
    await request(w.a, [recipient(null), cc], {}, 4);
    await request(w.a, [inPerson], {}, 5);
    const completedAt = new Date();
    await request(w.a, [done], { status: 'COMPLETED', completedAt }, 6);
    await request(w.a, [declined], { status: 'DECLINED' }, 7);
    await request(w.a, [voided], { status: 'VOIDED' }, 8);
    await request(w.a, [expired], { status: 'EXPIRED' }, 9);
    await request(w.a, [late], { expiresAt: new Date(Date.now() - 1) }, 10);
    await request(w.a, [approver], {}, 11);
    await request(w.a, [draft], {}, null);

    const pending = MySignatureList.parse(await svc.list(primary, 'PENDING')).items;
    expect(pending.map((r) => [r.recipientId, r.state])).toEqual([
      [turn.id, 'ACTION_NEEDED'],
      [waiting.id, 'WAITING'],
      [signed.id, 'WAITING'],
      [cc.id, 'WAITING'],
      [inPerson.id, 'WAITING'],
    ]);
    expect(pending[0]).toMatchObject({ senderName: 'staff-a', completedAt: null, signedAt: null });
    expect(pending[0]!.expiresAt).not.toBeNull();
    const signedTab = MySignatureList.parse(await svc.list(primary, 'SIGNED')).items;
    expect(signedTab.map((r) => [r.recipientId, r.state])).toEqual([
      [done.id, 'COMPLETED'],
      [declined.id, 'DECLINED'],
      [voided.id, 'VOIDED'],
      [expired.id, 'EXPIRED'],
      [late.id, 'EXPIRED'],
    ]);
    expect(signedTab[0]).toMatchObject({ completedAt: completedAt.toISOString(), expiresAt: null });
    // The spouse sees only the spouse's own; the household's primary rows are not theirs.
    expect((await svc.list(spouse, 'PENDING')).items.map((r) => r.recipientId)).toEqual([
      spouseOwn.id,
    ]);
    // Another client of the firm, and another firm's client, see nothing of these.
    expect((await svc.list(c2, 'PENDING')).items).toEqual([]);
    expect((await svc.list(loginB, 'PENDING')).items).toEqual([]);
    expect((await svc.list(loginB, 'SIGNED')).items).toEqual([]);
  });

  it('audits each list with ids only, never a title or a name', async () => {
    const mine = recipient(w.ids.primary);
    await request(w.a, [mine]);
    await svc.list(primary, 'PENDING');
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.my_signatures_listed',
        entity: { type: 'client_account', id: w.ids.primary },
        metadata: { tab: 'PENDING', recipientIds: [mine.id] },
      },
    ]);
  });

  it('status says whether Firm Sign is on for the firm, never an error', async () => {
    expect(await svc.status(w.a)).toEqual({ enabled: true });
    w.modules.set(w.a, 'esign', false);
    expect(await svc.status(w.a)).toEqual({ enabled: false });
    expect(await svc.status(w.b)).toEqual({ enabled: true });
  });
});

describe('signing from the Signature center', () => {
  it('opens at consent with no email or access code, records PORTAL_SESSION, then signs on', async () => {
    const mine = recipient(w.ids.primary, { authMethod: 'ACCESS_CODE', accessCodeHash: 'x' });
    const requestId = await request(w.a, [mine]);
    const b = new Browser();
    const state = SignerState.parse(await svc.startSigning(primary, mine.id, b.res));
    expect(state).toMatchObject({ step: 'CONSENT', signerName: 'Fake Signer', codeSentTo: null });
    expect([...b.jar.keys()]).toEqual([`fv_sign_${SLUG_A}`]);
    // The cookie works on the signer routes from consent on.
    const call = await signer.call(SLUG_A, b.req, 'CONSENT');
    expect((await signer.consent(call)).versionId).toBe(consentId);
    const after = await signer.acceptConsent(call, consentId, b.res);
    expect(after.step).toBe('SIGN');
    expect((await signer.call(SLUG_A, b.req, 'SIGN')).signer.consentVersionId).toBe(consentId);
    const events = await w.repo.events(w.a, requestId);
    expect(events.map((e) => [e.type, e.authMethod])).toEqual([
      ['AUTH_PASSED', 'PORTAL_SESSION'],
      ['CONSENTED', 'ACCESS_CODE'],
    ]);
    const opened = w.audit.entries.find((e) => e.action === 'esign.signer_portal_opened');
    expect(opened).toEqual({
      action: 'esign.signer_portal_opened',
      entity: { type: 'esign_recipient', id: mine.id },
      metadata: { requestId, authMethod: 'PORTAL_SESSION' },
      at: { businessId: w.a },
    });
  });

  it('opens at SIGN when the recipient already consented', async () => {
    const mine = recipient(w.ids.primary, { status: 'VIEWED' });
    await request(w.a, [mine]);
    signers.pinned.of(w.a).set(mine.id, consentId);
    expect((await svc.startSigning(primary, mine.id, new Browser().res)).step).toBe('SIGN');
  });

  it("refuses another login's, client's or firm's recipient (404 NOT_FOUND), setting no cookie", async () => {
    const mine = recipient(w.ids.primary);
    await request(w.a, [mine]);
    const theirs = recipient(w.ids.loginB);
    await request(w.b, [theirs]);
    const b = new Browser();
    expect(await refused(svc.startSigning(spouse, mine.id, b.res))).toBe('404 NOT_FOUND');
    expect(await refused(svc.startSigning(c2, mine.id, b.res))).toBe('404 NOT_FOUND');
    expect(await refused(svc.startSigning(loginB, mine.id, b.res))).toBe('404 NOT_FOUND');
    expect(await refused(svc.startSigning(primary, theirs.id, b.res))).toBe('404 NOT_FOUND');
    expect(await refused(svc.startSigning(primary, randomUUID(), b.res))).toBe('404 NOT_FOUND');
    expect(b.jar.size).toBe(0);
  });

  it('refuses a row that is not ACTION_NEEDED (404 LINK_INVALID), and a draft (404)', async () => {
    const b = new Browser();
    const cases: [Partial<EsignRecipientRecord>, Partial<EsignRequestRecord>][] = [
      [{ status: 'WAITING' }, {}],
      [{ status: 'SIGNED' }, {}],
      [{ kind: 'CC' }, {}],
      [{ delivery: 'IN_PERSON' }, {}],
      [{}, { status: 'VOIDED' }],
      [{}, { status: 'COMPLETED' }],
      [{}, { expiresAt: new Date(Date.now() - 1) }],
    ];
    for (const [r, q] of cases) {
      const mine = recipient(w.ids.primary, r);
      await request(w.a, [mine], q);
      expect(await refused(svc.startSigning(primary, mine.id, b.res))).toBe('404 LINK_INVALID');
    }
    const draft = recipient(w.ids.primary);
    await request(w.a, [draft], {}, null);
    expect(await refused(svc.startSigning(primary, draft.id, b.res))).toBe('404 NOT_FOUND');
    expect(b.jar.size).toBe(0);
  });
});

describe('the completed files', () => {
  const stored = (requestId: string, name: string): CompletedFile => ({
    key: w.store.keyFor(w.a, requestId, `final/${randomUUID()}.pdf`),
    fileName: name,
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
  });

  it('gives a 5-minute link to its own COMPLETED request’s files, audited by id', async () => {
    const mine = recipient(w.ids.primary, { status: 'SIGNED' });
    const id = await request(w.a, [mine], { status: 'COMPLETED', completedAt: new Date() });
    completedFiles.set(id, {
      final: stored(id, 'Fake letter (signed).pdf'),
      certificate: stored(id, 'Fake letter (certificate).pdf'),
    });
    const link = await svc.download(primary, mine.id, 'certificate');
    expect(link.url).toContain(encodeURIComponent('Fake letter (certificate).pdf'));
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.my_signature_downloaded',
        entity: { type: 'esign_recipient', id: mine.id },
        metadata: { requestId: id, clientAccountId: w.ids.primary, file: 'certificate' },
      },
    ]);
    // A CC login gets the files too; the household's other login and other firms do not.
    const cc = recipient(w.ids.spouse, { kind: 'CC' });
    const ccId = await request(w.a, [cc], { status: 'COMPLETED' });
    completedFiles.set(ccId, completedFiles.get(id)!);
    expect((await svc.download(spouse, cc.id, 'final')).url).toContain('signed');
    expect(await refused(svc.download(spouse, mine.id, 'final'))).toBe('404 NOT_FOUND');
    expect(await refused(svc.download(c2, mine.id, 'final'))).toBe('404 NOT_FOUND');
    expect(await refused(svc.download(loginB, mine.id, 'final'))).toBe('404 NOT_FOUND');
  });

  it('refuses a request that is not completed, or whose files are missing (409 INVALID_STATE)', async () => {
    const open = recipient(w.ids.primary);
    await request(w.a, [open]);
    expect(await refused(svc.download(primary, open.id, 'final'))).toBe('409 INVALID_STATE');
    const done = recipient(w.ids.primary, { status: 'SIGNED' });
    await request(w.a, [done], { status: 'COMPLETED' });
    expect(await refused(svc.download(primary, done.id, 'final'))).toBe('409 INVALID_STATE');
    expect(w.audit.entries).toEqual([]);
  });
});
