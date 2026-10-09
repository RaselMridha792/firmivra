// R13 signer routes, slice 3, on the in-memory ports (esign-fakes.ts) with R18's real link
// tokens, code HMAC and sealed cookie and the real completion service over a recording PDF
// engine: attachments (upload ticket, confirm with its checks, replace, remove, the required
// field in finish), the completed-copy link (a SIGNER or a CC: email code, then COPY, the files
// and their 5-minute links; wrong slug, other firm, expired and used links all LINK_INVALID), the
// packet as it stands (earlier signers stamped in), cross-recipient and cross-firm checks, and
// nothing secret in the logs, audit or timeline. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignField } from '@firmivra/types';
import { EsignCompletionService } from '../../src/esign/completion/completion.service.js';
import type {
  CertificateInput,
  FinalizeInput,
  PdfEngine,
} from '../../src/esign/engine/engine.types.js';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import {
  HmacCodeHasher,
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import { EsignRequestsService } from '../../src/esign/requests/requests.service.js';
import { EsignSendService } from '../../src/esign/requests/send.service.js';
import { EsignSignerFilesService } from '../../src/esign/signer/signer-files.service.js';
import { EsignSignerService } from '../../src/esign/signer/signer.service.js';
import type { SignerStep } from '@firmivra/types';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';
import { png } from './esign-engine-fixtures.js';
import {
  esignWorld,
  type EsignWorld,
  fakeHasher,
  fakePdf,
  InMemoryCompletionRepository,
  InMemorySignerRepository,
} from './esign-fakes.js';

const secrets = { CLIENT: 'fake-client-secret', STAFF: 'fake-staff-secret' };
const SLUG_A = 'fake-firm-a';
const SLUG_B = 'fake-firm-b';
const PORTAL = 'https://portal.example.test';
const PACKET = new TextEncoder().encode('%PDF-fake-packet');
const PDF = new TextEncoder().encode('%PDF-1.7 fake attachment');
const SECRET_VALUE = 'Fake secret answer';
const DAY = 86_400_000;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage[] = [];
  send(message: NotifyMessage): Promise<void> {
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
  get lastCode(): string {
    const codes = this.sent.filter(
      (m): m is NotifyMessage<'esign.code'> => m.template === 'esign.code',
    );
    return codes.at(-1)!.data.code;
  }
  /** The raw token in the esign.completed email to that address. */
  copyTokenFor(to: string): string {
    const mail = this.sent.find((m) => m.template === 'esign.completed' && m.to === to);
    const data = (mail as NotifyMessage<'esign.completed'>).data as { copyLink: string };
    return /#t=([\w-]{43})$/.exec(data.copyLink)![1]!;
  }
}

/** The "PDFs" are a line naming the packet and the stamps (images by size only). */
class RecordingPdf implements Pick<PdfEngine, 'finalize' | 'certificate'> {
  readonly finalized: FinalizeInput[] = [];
  finalize(packet: Uint8Array, input: FinalizeInput) {
    this.finalized.push(input);
    const stamps = input.stamps.map((s) => (s.kind === 'IMAGE' ? { ...s, png: s.png.length } : s));
    return Promise.resolve(
      new TextEncoder().encode(`final:${sha(packet)}:${JSON.stringify(stamps)}`),
    );
  }
  certificate(input: CertificateInput) {
    return Promise.resolve(new TextEncoder().encode(`certificate:${input.finalSha256}`));
  }
}

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
let completed: InMemoryCompletionRepository;
let notify: FakeNotify;
let pdf: RecordingPdf;
let svc: EsignSignerService;
let files: EsignSignerFilesService;
const tokens = new RandomLinkTokens();

beforeEach(() => {
  w = esignWorld();
  signers = new InMemorySignerRepository(w.repo);
  completed = new InMemoryCompletionRepository(w.repo, signers);
  notify = new FakeNotify();
  pdf = new RecordingPdf();
  const env = { PORTAL_BASE_URL: `${PORTAL}/` };
  const completion = new EsignCompletionService(
    ...([completed, w.repo, w.directory, pdf, w.store, tokens, notify, w.audit, env] as const),
  );
  const firms = new Map([
    [SLUG_A, { id: w.a, slug: SLUG_A, name: 'Fake Firm A' }],
    [SLUG_B, { id: w.b, slug: SLUG_B, name: 'Fake Firm B' }],
  ]);
  const activeFirm = (slug: string) =>
    firms.get(slug) ? Promise.resolve(firms.get(slug)!) : Promise.reject(new NotFoundException());
  const requests = new EsignRequestsService(
    ...([w.repo, w.directory, w.modules, w.store, w.audit, fakeHasher] as const),
  );
  const prepare = new EsignPrepareService(requests, w.repo, w.directory, esignRules, w.audit);
  const sender = new EsignSendService(
    ...([requests, prepare, w.repo, w.directory, esignRules, fakePdf, w.store] as const),
    ...([tokens, notify, w.audit, env] as const),
  );
  svc = new EsignSignerService(
    ...([{ activeFirm }, w.modules, signers, w.repo, w.directory, tokens] as const),
    new HmacCodeHasher(secrets, false),
    new SealedSignerCookie(secrets, true),
    ...([w.store, new PngSignatureCheck(), esignRules, sender, notify, w.audit] as const),
    ...([{ APP_BASE_URL: 'https://app.example.test' }, completion] as const),
  );
  files = new EsignSignerFilesService(svc, signers, w.repo, completed, w.store);
  for (const firm of [w.a, w.b]) {
    signers.consents.set(firm, { id: randomUUID(), version: 1, bodyMarkdown: 'Fake consent' });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

const person = (extra: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
  ...{ id: randomUUID(), kind: 'SIGNER', role: 'CLIENT', roleLabel: null, routingOrder: 1 },
  ...{ name: 'Fake Signer', email: `${randomUUID().slice(0, 8)}@client.test`, phone: null },
  ...{ link: { type: 'EXTERNAL' }, delivery: 'EMAIL', authMethod: 'LINK', accessCodeHash: null },
  ...{ colorIndex: 0, status: 'SENT', sentAt: new Date(), viewedAt: null, signedAt: null },
  ...{ declinedAt: null, declineReason: null, lastRemindedAt: null, reminderCount: 0 },
  ...extra,
});

const field = (
  recipientId: string | null,
  type: EsignField['type'],
  extra: Partial<EsignField> = {},
): EsignField => ({
  ...{ id: randomUUID(), recipientId, type, pageIndex: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
  ...{ required: true, label: null, mergeKey: null, options: [], groupKey: null, value: null },
  filled: false,
  ...extra,
});

/** A SENT request of the firm's client, its packet stored; its id. */
async function sent(firm: string, recipients: EsignRecipientRecord[], fields: EsignField[] = []) {
  const a = firm === w.a;
  const record = await w.repo.createRequest(firm, {
    ...{ title: 'Fake engagement letter', source: 'CLIENT_RECORD', internalNote: 'internal only' },
    clientId: a ? w.ids.c1 : w.ids.cB,
    engagementId: a ? w.ids.e1 : w.ids.eB,
    senderUserId: a ? w.users.ownerA : w.users.ownerB,
    ...{ emailSubject: null, emailMessage: null, routing: 'PARALLEL', expiryDays: 10 },
    ...{ reminders: { firstAfterDays: 3, everyDays: 3, max: 3 }, expiryWarningDays: 2 },
  });
  await w.store.put(
    firm,
    w.store.keyFor(firm, record.id, `packet-${sha(PACKET)}.pdf`),
    PACKET,
    'application/pdf',
  );
  w.repo.seed(firm, record.id, (row) => {
    Object.assign(row.record, {
      ...{ status: 'SENT', sentAt: new Date(), originalSha256: sha(PACKET) },
      expiresAt: new Date(Date.now() + 10 * DAY),
    });
    row.parts.recipients = structuredClone(recipients);
    row.parts.fields = structuredClone(fields);
  });
  return record.id;
}

const slugOf = (firm: string) => (firm === w.a ? SLUG_A : SLUG_B);

/** The controller's calls for one browser at one slug. */
const api = (b: Browser, slug = SLUG_A) => {
  const at = (...steps: SignerStep[]) => svc.call(slug, b.req, ...steps);
  return {
    open: (token: string) => svc.open(slug, token, b.res),
    state: async () => svc.state(await at()),
    sendCode: async () => svc.sendCode(await at('VERIFY_EMAIL')),
    verifyCode: async (code: string) => svc.verify(await at('VERIFY_EMAIL'), 'EMAIL', code, b.res),
    envelope: async () => svc.envelope(await at('SIGN')),
    packet: async () => svc.packet(await at('SIGN')),
    finish: async (values: { fieldId: string; value: string }[] = []) =>
      svc.finish(await at('SIGN'), values),
    upload: async (fieldId: string, bytes: Uint8Array = PDF, extra = {}) =>
      files.createUpload(await at('SIGN'), {
        ...{ fieldId, fileName: 'id.pdf', contentType: 'application/pdf' as const },
        ...{ sizeBytes: bytes.byteLength, sha256: sha(bytes), ...extra },
      }),
    confirm: async (fieldId: string, uploadToken: string) =>
      files.confirmUpload(await at('SIGN'), fieldId, uploadToken),
    remove: async (fieldId: string) => files.remove(await at('SIGN'), fieldId),
    copy: async () => files.copy(await at('COPY')),
    download: async (file: 'final' | 'certificate') => files.download(await at('COPY'), file),
  };
};

/** A LINK signer through consent and adopt, at SIGN in a browser of their own. */
async function atSign(firm: string, id: string, me: EsignRecipientRecord, drawn = false) {
  const { token, hash } = tokens.issue();
  signers.links
    .of(firm)
    .set(hash, { requestId: id, recipientId: me.id, tokenVersion: 0, purpose: 'SIGN' });
  const b = new Browser();
  const slug = slugOf(firm);
  await svc.open(slug, token, b.res);
  await svc.acceptConsent(
    await svc.call(slug, b.req, 'CONSENT'),
    signers.consents.get(firm)!.id,
    b.res,
  );
  const signature = drawn
    ? { printedName: me.name, method: 'DRAWN' as const, imagePng: PNG_BASE64 }
    : { printedName: me.name, method: 'TYPED' as const, typedSignature: me.name };
  await svc.adopt(await svc.call(slug, b.req, 'SIGN'), { signature });
  return { b, token };
}
const PNG_BASE64 = Buffer.from(png(40, 20)).toString('base64');

/** Stores the bytes where the ticket points, as the browser's PUT would. */
const put = (firm: string, url: string, bytes: Uint8Array = PDF, type = 'application/pdf') =>
  w.store.put(firm, url.replace('memory://', ''), bytes, type);

/** One signer at SIGN with an ATTACHMENT field (required unless said). */
async function withAttachmentField(required = true) {
  const me = person();
  const attach = field(me.id, 'ATTACHMENT', { required });
  const id = await sent(w.a, [me], [field(me.id, 'SIGNATURE'), attach]);
  const { b } = await atSign(w.a, id, me);
  return { me, id, b, attach };
}

describe('attachments', () => {
  it('upload, confirm, list in the envelope, replace, and finish with the required one', async () => {
    const { me, id, b, attach } = await withAttachmentField();
    expect(await refused(api(b).finish())).toBe('409 REQUIRED_FIELDS_MISSING');
    const ticket = await api(b).upload(attach.id);
    const prefix = `memory://tenant/${w.a}/esign/${id}/attachments/`;
    expect(ticket.url.startsWith(prefix)).toBe(true);
    expect(ticket).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/pdf' } });
    await put(w.a, ticket.url);
    const confirmed = await api(b).confirm(attach.id, ticket.uploadToken);
    expect(confirmed).toMatchObject({
      id: attach.id,
      type: 'ATTACHMENT',
      attachmentName: 'id.pdf',
    });
    const listed = (await api(b).envelope()).fields.find((f) => f.id === attach.id);
    expect(listed?.attachmentName).toBe('id.pdf');
    const [stored] = await signers.attachments(w.a, id, me.id);
    expect(stored).toMatchObject({ fieldId: attach.id, scanStatus: 'PENDING', sha256: sha(PDF) });

    // A second file replaces the first, whose object is removed.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const again = await api(b).upload(attach.id, png, {
      fileName: 'id.png',
      contentType: 'image/png',
    });
    await put(w.a, again.url, png, 'image/png');
    expect((await api(b).confirm(attach.id, again.uploadToken)).attachmentName).toBe('id.png');
    expect(await w.store.read(w.a, stored!.key)).toBeNull();
    expect(await signers.attachments(w.a, id, me.id)).toHaveLength(1);

    expect((await api(b).finish()).step).toBe('DONE');
    // Finished: the attachment routes are closed to them.
    expect(await refused(api(b).upload(attach.id))).toBe('409 WRONG_STEP');
    const actions = w.audit.entries.map((e) => e.action);
    expect(actions).toContain('esign.signer_attachment_started');
    expect(actions.filter((a) => a === 'esign.signer_attachment_added')).toHaveLength(2);
    // Ids only: never the upload token, a file name or the file's hash.
    const said = JSON.stringify([w.audit.entries, await w.repo.events(w.a, id)]);
    for (const secret of [ticket.uploadToken, again.uploadToken, 'id.pdf', 'id.png', sha(PDF)]) {
      expect(said).not.toContain(secret);
    }
  });

  it('confirm refuses a used, expired or other-field token (410) and a different file (409)', async () => {
    const me = person();
    const one = field(me.id, 'ATTACHMENT');
    const two = field(me.id, 'ATTACHMENT');
    const id = await sent(w.a, [me], [one, two]);
    const { b } = await atSign(w.a, id, me);
    const t1 = await api(b).upload(one.id);
    await put(w.a, t1.url);
    await api(b).confirm(one.id, t1.uploadToken);
    expect(await refused(api(b).confirm(one.id, t1.uploadToken))).toBe('410 UPLOAD_EXPIRED');
    expect(await refused(api(b).confirm(one.id, 'x'.repeat(43)))).toBe('410 UPLOAD_EXPIRED');
    // A ticket for one field never fills another; it is used up and its object goes.
    const t2 = await api(b).upload(one.id);
    await put(w.a, t2.url);
    expect(await refused(api(b).confirm(two.id, t2.uploadToken))).toBe('410 UPLOAD_EXPIRED');
    expect(await w.store.read(w.a, t2.url.replace('memory://', ''))).toBeNull();
    expect(await refused(api(b).confirm(one.id, t2.uploadToken))).toBe('410 UPLOAD_EXPIRED');

    // Other bytes, another type, or not what its type says: 409, and the object goes.
    const notPdf = new TextEncoder().encode('not a pdf, same size as it');
    const cases: [Uint8Array, Uint8Array, string][] = [
      [PDF, new TextEncoder().encode('%PDF-1.7 other attachment'), 'application/pdf'],
      [PDF, PDF, 'image/png'],
      [notPdf, notPdf, 'application/pdf'],
    ];
    for (const [described, stored, type] of cases) {
      const t = await api(b).upload(two.id, described);
      await put(w.a, t.url, stored, type);
      expect(await refused(api(b).confirm(two.id, t.uploadToken))).toBe('409 UPLOAD_MISMATCH');
      expect(await w.store.read(w.a, t.url.replace('memory://', ''))).toBeNull();
    }
    const shown = (await api(b).envelope()).fields.find((f) => f.id === two.id);
    expect(shown?.attachmentName).toBeNull();

    // Older than 15 minutes.
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const t3 = await api(b).upload(two.id);
    await put(w.a, t3.url);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await refused(api(b).confirm(two.id, t3.uploadToken))).toBe('410 UPLOAD_EXPIRED');
  });

  it('only their own ATTACHMENT fields (400), and only at SIGN (409 WRONG_STEP)', async () => {
    const me = person();
    const attach = field(me.id, 'ATTACHMENT');
    const text = field(me.id, 'TEXT');
    const id = await sent(w.a, [me], [attach, text]);
    const { b } = await atSign(w.a, id, me);
    for (const fieldId of [text.id, randomUUID()]) {
      expect(await refused(api(b).upload(fieldId))).toBe('400 VALIDATION_FAILED');
      expect(await refused(api(b).remove(fieldId))).toBe('404 NOT_FOUND');
    }
    // Before consent.
    const early = person();
    const id2 = await sent(w.a, [early], [field(early.id, 'ATTACHMENT')]);
    const { token, hash } = tokens.issue();
    const link = { requestId: id2, recipientId: early.id, tokenVersion: 0, purpose: 'SIGN' };
    signers.links.of(w.a).set(hash, link as never);
    const fresh = new Browser();
    await api(fresh).open(token);
    expect(await refused(api(fresh).upload(attach.id))).toBe('409 WRONG_STEP');
  });

  it('remove: their file goes until they finish; none there is 404', async () => {
    const { me, id, b, attach } = await withAttachmentField();
    expect(await refused(api(b).remove(attach.id))).toBe('404 NOT_FOUND');
    const t = await api(b).upload(attach.id);
    await put(w.a, t.url);
    await api(b).confirm(attach.id, t.uploadToken);
    const [stored] = await signers.attachments(w.a, id, me.id);
    expect((await api(b).remove(attach.id)).attachmentName).toBeNull();
    expect(await w.store.read(w.a, stored!.key)).toBeNull();
    expect(await signers.attachments(w.a, id, me.id)).toEqual([]);
    expect(await refused(api(b).finish())).toBe('409 REQUIRED_FIELDS_MISSING');
    expect(w.audit.entries.at(-1)).toEqual({
      action: 'esign.signer_attachment_removed',
      entity: { type: 'esign_recipient', id: me.id },
      metadata: { requestId: id, fieldId: attach.id },
    });
  });

  it("one signer never confirms, sees or removes another's attachment (404, 410)", async () => {
    const one = person({ name: 'Fake One' });
    const two = person({ name: 'Fake Two' });
    const mine = field(one.id, 'ATTACHMENT');
    const theirs = field(two.id, 'ATTACHMENT');
    const id = await sent(w.a, [one, two], [mine, theirs]);
    const a = (await atSign(w.a, id, one)).b;
    const other = (await atSign(w.a, id, two)).b;
    const t = await api(a).upload(mine.id);
    await put(w.a, t.url);
    expect(await refused(api(other).confirm(theirs.id, t.uploadToken))).toBe('410 UPLOAD_EXPIRED');
    expect(await refused(api(other).confirm(mine.id, t.uploadToken))).toBe('400 VALIDATION_FAILED');
    await api(a).confirm(mine.id, t.uploadToken);
    expect(await refused(api(other).remove(mine.id))).toBe('404 NOT_FOUND');
    expect(await refused(api(other).upload(mine.id))).toBe('400 VALIDATION_FAILED');
    expect((await api(other).envelope()).fields.map((f) => f.id)).toEqual([theirs.id]);
    expect(await signers.attachments(w.a, id, one.id)).toHaveLength(1);
    expect(await signers.attachments(w.a, id, two.id)).toEqual([]);
  });

  it("another firm's link and cookie are 404 here; its files stay its own", async () => {
    const me = person();
    const attach = field(me.id, 'ATTACHMENT');
    const id = await sent(w.b, [me], [attach]);
    const { b, token } = await atSign(w.b, id, me);
    const t = await api(b, SLUG_B).upload(attach.id);
    expect(t.url).toContain(`tenant/${w.b}/esign/${id}/attachments/`);
    expect(await refused(api(new Browser()).open(token))).toBe('404 LINK_INVALID');
    const moved = new Browser();
    moved.jar.set(`fv_sign_${SLUG_A}`, b.jar.get(`fv_sign_${SLUG_B}`)!);
    expect(await refused(api(moved).upload(attach.id))).toBe('404 LINK_INVALID');
    expect(await refused(api(moved).remove(attach.id))).toBe('404 LINK_INVALID');
    expect(await signers.attachments(w.a, id, me.id)).toEqual([]);
  });
});

/** A completed request: a drawn signer (with a value), a typed one and a CC. */
async function completedRequest(firm = w.a) {
  const drawn = person({ name: 'Fake Drawn' });
  const typed = person({ name: 'Fake Typed' });
  const cc = person({ kind: 'CC', name: 'Fake Copy', status: 'WAITING', sentAt: null });
  const text = field(drawn.id, 'TEXT');
  const fields = [field(drawn.id, 'SIGNATURE'), text, field(typed.id, 'SIGNATURE')];
  const id = await sent(firm, [drawn, typed, cc], fields);
  const first = await atSign(firm, id, drawn, true);
  const value = { fieldId: text.id, value: SECRET_VALUE };
  await svc.finish(await svc.call(slugOf(firm), first.b.req, 'SIGN'), [value]);
  const second = await atSign(firm, id, typed);
  await svc.finish(await svc.call(slugOf(firm), second.b.req, 'SIGN'), []);
  expect((await w.repo.findRequest(firm, id))?.status).toBe('COMPLETED');
  return { id, drawn, typed, cc, signLink: first.token };
}

/** Opens a copy link and passes the email code: at COPY. */
async function atCopy(token: string, slug = SLUG_A) {
  const b = new Browser();
  const opened = await api(b, slug).open(token);
  expect(opened).toMatchObject({ step: 'VERIFY_EMAIL', requestStatus: null });
  await api(b, slug).sendCode();
  const state = await api(b, slug).verifyCode(notify.lastCode);
  return { b, state };
}

describe('the completed-copy link', () => {
  it('a CC and a signer: email code, then the two files and their 5-minute links', async () => {
    const { id, cc, typed } = await completedRequest();
    const events = (await w.repo.events(w.a, id)).length;
    for (const who of [cc, typed]) {
      const { b, state } = await atCopy(notify.copyTokenFor(who.email!));
      expect(state).toMatchObject({
        step: 'COPY',
        requestStatus: 'COMPLETED',
        signerName: who.name,
        expiresAt: signers.copyExpiry.of(w.a).get(who.id)!.toISOString(),
      });
      expect(await api(b).copy()).toMatchObject({
        title: 'Fake engagement letter',
        files: [
          { file: 'final', fileName: 'Fake engagement letter - signed.pdf' },
          { file: 'certificate', fileName: 'Fake engagement letter - certificate.pdf' },
        ],
      });
      const stored = (await completed.files(w.a, id))!;
      for (const file of ['final', 'certificate'] as const) {
        const link = await api(b).download(file);
        const name = encodeURIComponent(stored[file].fileName);
        expect(link.url).toBe(`memory://${stored[file].key}?name=${name}`);
        const minutes = (Date.parse(link.expiresAt) - Date.now()) / 60_000;
        expect(minutes).toBeGreaterThan(4.9);
        expect(minutes).toBeLessThanOrEqual(5);
      }
      // A copy session never signs.
      expect(await refused(api(b).envelope())).toBe('409 WRONG_STEP');
      expect(await refused(api(b).upload(randomUUID()))).toBe('409 WRONG_STEP');
    }
    // The completed request's timeline is left alone; the audit has ids only.
    expect(await w.repo.events(w.a, id)).toHaveLength(events);
    expect(w.audit.entries).toContainEqual({
      action: 'esign.signer_copy_downloaded',
      entity: { type: 'esign_recipient', id: cc.id },
      metadata: { requestId: id, file: 'certificate' },
    });
  });

  it('a signer at SIGN cannot reach the copy (409 WRONG_STEP)', async () => {
    const me = person();
    const id = await sent(w.a, [me], [field(me.id, 'SIGNATURE')]);
    const { b } = await atSign(w.a, id, me);
    expect(await refused(api(b).copy())).toBe('409 WRONG_STEP');
    expect(await refused(api(b).download('final'))).toBe('409 WRONG_STEP');
  });

  it('wrong slug, another firm, used and replaced links are the one 404 LINK_INVALID', async () => {
    const { cc, signLink } = await completedRequest();
    const other = await completedRequest(w.b);
    const token = notify.copyTokenFor(cc.email!);
    expect(await refused(api(new Browser(), SLUG_B).open(token))).toBe('404 LINK_INVALID');
    const tokenB = notify.copyTokenFor(other.cc.email!);
    expect(await refused(api(new Browser()).open(tokenB))).toBe('404 LINK_INVALID');
    // Used: the signing link of someone who signed opens nothing now.
    expect(await refused(api(new Browser()).open(signLink))).toBe('404 LINK_INVALID');
    // A copy cookie moved to the other firm's slug.
    const { b } = await atCopy(token);
    const moved = new Browser();
    moved.jar.set(`fv_sign_${SLUG_B}`, b.jar.get(`fv_sign_${SLUG_A}`)!);
    expect(await refused(api(moved, SLUG_B).copy())).toBe('404 LINK_INVALID');
    // Replaced (a resend issues a fresh link): the old one is gone.
    signers.links.of(w.a).delete(tokens.hash(token));
    expect(await refused(api(new Browser()).open(token))).toBe('404 LINK_INVALID');
  });

  it('after 30 days the link is 404 and an open session shows CLOSED', async () => {
    const { cc } = await completedRequest();
    const token = notify.copyTokenFor(cc.email!);
    const expiry = signers.copyExpiry.of(w.a).get(cc.id)!.getTime();
    expect(Math.round((expiry - Date.now()) / DAY)).toBe(30);
    vi.useFakeTimers({ now: expiry + 1, toFake: ['Date'] });
    expect(await refused(api(new Browser()).open(token))).toBe('404 LINK_INVALID');
    // A session opened shortly before the expiry: the expiry is read on every call.
    vi.setSystemTime(expiry - 10 * 60_000);
    const { b } = await atCopy(token);
    vi.setSystemTime(expiry + 1);
    expect(await api(b).state()).toMatchObject({
      step: 'CLOSED',
      requestStatus: 'COMPLETED',
      expiresAt: null,
    });
    expect(await refused(api(b).copy())).toBe('409 WRONG_STEP');
    expect(await refused(api(b).download('final'))).toBe('409 WRONG_STEP');
  });

  it('no token, code, value, file name or address in the logs, audit or timeline', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      vi.spyOn(Logger.prototype, m),
    );
    const { id, cc } = await completedRequest();
    const token = notify.copyTokenFor(cc.email!);
    const { b } = await atCopy(token);
    await api(b).copy();
    await api(b).download('final');
    const said = JSON.stringify([
      spies.map((s) => s.mock.calls),
      w.audit.entries,
      await w.repo.events(w.a, id),
    ]);
    for (const secret of [token, notify.lastCode, SECRET_VALUE, cc.email!, 'signed.pdf']) {
      expect(said).not.toContain(secret);
    }
    expect(said).not.toContain(b.jar.get(`fv_sign_${SLUG_A}`)!);
  });
});

describe('the packet as it stands', () => {
  it("the sender's values and earlier signers' marks; never a later signer's adoption", async () => {
    const first = person({ name: 'Fake First' });
    const second = person({ name: 'Fake Second' });
    const text = field(first.id, 'TEXT');
    const fields = [
      field(first.id, 'SIGNATURE'),
      text,
      field(second.id, 'SIGNATURE'),
      field(second.id, 'CHECKBOX', { required: false }),
      field(null, 'TEXT', { value: 'Sender value' }),
    ];
    const id = await sent(w.a, [first, second], fields);
    const one = await atSign(w.a, id, first, true);
    const two = await atSign(w.a, id, second);
    // No one signed yet: the sender's value only.
    await api(one.b).packet();
    expect(pdf.finalized.at(-1)!.stamps).toEqual([
      expect.objectContaining({ kind: 'TEXT', text: 'Sender value' }),
    ]);
    await api(one.b).finish([{ fieldId: text.id, value: SECRET_VALUE }]);
    const bytes = Buffer.from(await api(two.b).packet()).toString();
    expect(bytes.startsWith(`final:${sha(PACKET)}:`)).toBe(true);
    const input = pdf.finalized.at(-1)!;
    expect(input.signaturePages).toEqual([]);
    expect(input.stamps.map((s) => (s.kind === 'TEXT' ? s.text : s.kind))).toEqual([
      'IMAGE',
      SECRET_VALUE,
      'Sender value',
    ]);
  });

  it('with nothing to stamp it is the packet as sent', async () => {
    const me = person();
    const id = await sent(w.a, [me], [field(me.id, 'SIGNATURE')]);
    const { b } = await atSign(w.a, id, me);
    expect(Buffer.from(await api(b).packet()).toString()).toBe('%PDF-fake-packet');
    expect(pdf.finalized).toEqual([]);
  });
});
