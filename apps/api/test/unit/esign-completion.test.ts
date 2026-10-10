// R13 completion and filing, on the in-memory ports (esign-fakes.ts) with R18's real link tokens
// and sealed cookie and a recording PDF engine: from the last finish to COMPLETED (stamps, hashes,
// files under the request's prefix, vault documents on the firm's client and service, the
// COMPLETED event, audit with ids only, esign.completed with a copy link or the portal), retries
// that complete once, a failure mid-way that stays due, the job (its lock, due times, firms one by
// one) and that one firm's run never touches another's. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EsignField } from '@firmivra/types';
import { EsignCompletionJob } from '../../src/esign/completion/completion.job.js';
import {
  COMPLETION_RETRY_MS,
  EsignCompletionService,
} from '../../src/esign/completion/completion.service.js';
import type {
  CertificateInput,
  FinalizeInput,
  PdfEngine,
} from '../../src/esign/engine/engine.types.js';
import { esignRules } from '../../src/esign/engine/esign-rules.js';
import {
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from '../../src/esign/engine/signer-security.js';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import { EsignPrepareService } from '../../src/esign/requests/prepare.service.js';
import { EsignRequestsService } from '../../src/esign/requests/requests.service.js';
import { EsignSendService } from '../../src/esign/requests/send.service.js';
import { EsignSignerService } from '../../src/esign/signer/signer.service.js';
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
const SLUGS = { a: 'fake-firm-a', b: 'fake-firm-b' };
const PORTAL = 'https://portal.example.test';
const PACKET = new TextEncoder().encode('%PDF-fake-packet');
const FIELD_VALUE = 'Fake secret answer';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage[] = [];
  fail = false;
  send(message: NotifyMessage): Promise<void> {
    if (this.fail && message.template === 'esign.completed') {
      return Promise.reject(new Error(`fake failure for ${message.to}`));
    }
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
  completed() {
    return this.sent.filter(
      (m): m is NotifyMessage<'esign.completed'> => m.template === 'esign.completed',
    );
  }
}

/** Records what it was asked; the "PDFs" are JSON of the input (images by size only). */
class RecordingPdf implements Pick<PdfEngine, 'finalize' | 'certificate'> {
  readonly finalized: FinalizeInput[] = [];
  readonly certificates: CertificateInput[] = [];
  fail = false;
  finalize(packet: Uint8Array, input: FinalizeInput) {
    if (this.fail) return Promise.reject(new Error(`cannot stamp ${FIELD_VALUE}`));
    this.finalized.push(input);
    const stamps = input.stamps.map((s) => (s.kind === 'IMAGE' ? { ...s, png: s.png.length } : s));
    return Promise.resolve(
      new TextEncoder().encode(`final:${sha(packet)}:${JSON.stringify(stamps)}`),
    );
  }
  certificate(input: CertificateInput) {
    this.certificates.push(input);
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
let repo: InMemoryCompletionRepository;
let notify: FakeNotify;
let pdf: RecordingPdf;
let completion: EsignCompletionService;
let job: EsignCompletionJob;
let svc: EsignSignerService;
const tokens = new RandomLinkTokens();

beforeEach(() => {
  w = esignWorld();
  signers = new InMemorySignerRepository(w.repo);
  repo = new InMemoryCompletionRepository(w.repo, signers);
  repo.firmIds.push(w.a, w.b);
  notify = new FakeNotify();
  pdf = new RecordingPdf();
  const env = { PORTAL_BASE_URL: `${PORTAL}/` };
  completion = new EsignCompletionService(
    repo,
    w.repo,
    w.directory,
    pdf,
    w.store,
    tokens,
    notify,
    w.audit,
    env,
  );
  job = new EsignCompletionJob(repo, completion);
  const firms = new Map([
    [SLUGS.a, { id: w.a, slug: SLUGS.a, name: 'Fake Firm A' }],
    [SLUGS.b, { id: w.b, slug: SLUGS.b, name: 'Fake Firm B' }],
  ]);
  const activeFirm = (slug: string) =>
    firms.get(slug) ? Promise.resolve(firms.get(slug)!) : Promise.reject(new NotFoundException());
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
    env,
  );
  svc = new EsignSignerService(
    { activeFirm },
    w.modules,
    signers,
    w.repo,
    w.directory,
    tokens,
    { generate: () => '000000', hash: () => '', verify: () => false },
    new SealedSignerCookie(secrets, true),
    w.store,
    new PngSignatureCheck(),
    esignRules,
    sender,
    notify,
    w.audit,
    { APP_BASE_URL: 'https://app.example.test' },
    completion,
  );
  for (const firm of [w.a, w.b]) {
    signers.consents.set(firm, { id: randomUUID(), version: 1, bodyMarkdown: 'Fake consent' });
  }
});
afterEach(() => vi.restoreAllMocks());

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

/** A SENT request of the firm's client and service, its packet stored; its id. */
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
  const key = w.store.keyFor(firm, record.id, `packet-${sha(PACKET)}.pdf`);
  await w.store.put(firm, key, PACKET, 'application/pdf');
  w.repo.seed(firm, record.id, (row) => {
    const expiresAt = new Date(Date.now() + 10 * 86_400_000);
    Object.assign(row.record, {
      status: 'SENT',
      sentAt: new Date(),
      expiresAt,
      originalSha256: sha(PACKET),
    });
    row.parts.recipients = structuredClone(recipients);
    row.parts.fields = structuredClone(fields);
  });
  return record.id;
}

/** Signs as `me` through the signer routes: link, consent, adopt, finish. */
async function sign(
  firm: string,
  id: string,
  me: EsignRecipientRecord,
  drawn = false,
  values: { fieldId: string; value: string }[] = [],
) {
  const slug = firm === w.a ? SLUGS.a : SLUGS.b;
  const { token, hash } = tokens.issue();
  signers.links
    .of(firm)
    .set(hash, { requestId: id, recipientId: me.id, tokenVersion: 0, purpose: 'SIGN' });
  const b = new Browser();
  await svc.open(slug, token, b.res);
  await svc.acceptConsent(
    await svc.call(slug, b.req, 'CONSENT'),
    signers.consents.get(firm)!.id,
    b.res,
  );
  const signature = drawn
    ? {
        printedName: me.name,
        method: 'DRAWN' as const,
        imagePng: Buffer.from(png(40, 20)).toString('base64'),
      }
    : { printedName: me.name, method: 'TYPED' as const, typedSignature: me.name };
  const initials = { method: 'TYPED' as const, text: 'FS' };
  await svc.adopt(await svc.call(slug, b.req, 'SIGN'), { signature, initials });
  return svc.finish(await svc.call(slug, b.req, 'SIGN'), values);
}

/** A request every signer finished (one drawn signature), due for completion; its id. */
async function allSigned(firm: string) {
  const me = person();
  const id = await sent(firm, [me], [field(me.id, 'SIGNATURE')]);
  repo.failNextComplete = true; // the inline try fails: the job finds it due
  await sign(firm, id, me, true);
  repo.retryAt.delete(id);
  return id;
}

const status = async (firm: string, id: string) => (await w.repo.findRequest(firm, id))?.status;

describe('completion from the last finish', () => {
  it('stamps, hashes, stores, files, records, audits and emails', async () => {
    const drawn = person({ name: 'Fake Drawn' });
    const client = person({
      name: 'Fake Client',
      link: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary },
    });
    const cc = person({ kind: 'CC', name: 'Fake Copy', status: 'WAITING', sentAt: null });
    const text = field(client.id, 'TEXT');
    const fields = [
      field(drawn.id, 'SIGNATURE'),
      field(drawn.id, 'DATE_SIGNED'),
      field(client.id, 'SIGNATURE', { pageIndex: 1 }),
      field(client.id, 'INITIALS'),
      text,
      field(client.id, 'CHECKBOX', { required: false }),
      field(null, 'TEXT', { value: 'Sender value' }),
    ];
    const id = await sent(w.a, [drawn, client, cc], fields);
    const log = vi.spyOn(Logger.prototype, 'log');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    expect((await sign(w.a, id, drawn, true)).step).toBe('DONE');
    expect(await status(w.a, id)).toBe('PARTIALLY_SIGNED');
    expect(pdf.finalized).toEqual([]);
    const done = await sign(w.a, id, client, false, [{ fieldId: text.id, value: FIELD_VALUE }]);
    expect(done.step).toBe('DONE');
    expect(await status(w.a, id)).toBe('COMPLETED');
    expect(signers.completionDue.has(id)).toBe(false);

    // The stamps: the drawn image, the typed marks, the date, the values, the sender's value.
    const [input] = pdf.finalized;
    expect(input!.timeZone).toBe('America/New_York');
    expect(input!.signaturePages).toEqual([]);
    expect(
      input!.stamps.map((s) =>
        s.kind === 'IMAGE' ? 'IMAGE' : s.kind === 'CHECK' ? `CHECK:${s.checked}` : s.text,
      ),
    ).toEqual([
      'IMAGE',
      expect.stringMatching(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/),
      'Fake Client',
      'FS',
      FIELD_VALUE,
      'CHECK:false',
      'Sender value',
    ]);
    expect(input!.stamps[2]).toMatchObject({ pageIndex: 1 });

    // Hashes of what was stored, under the request's final/ and certificate/ folders.
    const done1 = repo.completed.of(w.a).get(id)!;
    const prefix = `tenant/${w.a}/esign/${id}/`;
    const final = await w.store.read(w.a, `${prefix}final/${done1.finalSha256}.pdf`);
    const cert = await w.store.read(w.a, `${prefix}certificate/${done1.certificateSha256}.pdf`);
    expect(sha(final!)).toBe(done1.finalSha256);
    expect(sha(cert!)).toBe(done1.certificateSha256);
    expect(pdf.certificates[0]).toMatchObject({
      originalSha256: sha(PACKET),
      finalSha256: done1.finalSha256,
    });
    expect(
      pdf.certificates[0]!.signers.map((s) => [s.name, s.consentVersion, s.authMethod]),
    ).toEqual([
      ['Fake Drawn', 1, 'LINK'],
      ['Fake Client', 1, 'LINK'],
    ]);
    expect(pdf.certificates[0]!.events.at(-1)).toMatchObject({
      type: 'COMPLETED',
      actor: 'Firmivra',
    });

    // Filed in firm A's vault, on the request's client and service.
    const docs = [...repo.documents.of(w.a).values()];
    expect(docs.map((d) => d.id).sort()).toEqual(
      [done1.finalDocumentId, done1.certificateDocumentId].sort(),
    );
    for (const d of docs) {
      expect(d).toMatchObject({
        clientId: w.ids.c1,
        engagementId: w.ids.e1,
        direction: 'FIRM_TO_CLIENT',
      });
      expect(d).toMatchObject({ scanStatus: 'CLEAN', legalHold: true, retentionUntil: null });
      expect(d.categoryId).toBe(repo.categories.of(w.a).get('Signed Documents'));
      expect(d.key.startsWith(prefix)).toBe(true);
    }
    expect(docs.map((d) => d.fileName).sort()).toEqual([
      'Fake engagement letter - certificate.pdf',
      'Fake engagement letter - signed.pdf',
    ]);
    expect(repo.documents.of(w.b).size).toBe(0);

    const events = await w.repo.events(w.a, id);
    expect(events.at(-1)).toMatchObject({
      type: 'COMPLETED',
      actorKind: 'SYSTEM',
      recipient: null,
    });

    // Emails: copy links for the external signer and the CC, the portal for the client login.
    const mails = notify.completed();
    expect(mails.map((m) => m.to).sort()).toEqual([drawn.email, client.email, cc.email].sort());
    const to = (r: EsignRecipientRecord) => mails.find((m) => m.to === r.email)!.data;
    expect(to(client)).toEqual({
      name: 'Fake Client',
      title: 'Fake engagement letter',
      portalLink: `${PORTAL}/${SLUGS.a}/signatures`,
    });
    for (const r of [drawn, cc]) {
      const link = to(r).copyLink!;
      expect(link).toMatch(new RegExp(`^${PORTAL}/${SLUGS.a}/sign#t=[\\w-]{43}$`));
      const token = link.split('#t=')[1]!;
      expect(signers.links.of(w.a).get(tokens.hash(token))).toEqual({
        requestId: id,
        recipientId: r.id,
        tokenVersion: 0,
        purpose: 'COPY',
      });
      const days = (repo.copyExpiry.of(w.a).get(r.id)!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(JSON.stringify([...signers.links.of(w.a)])).not.toContain(token);
    }
    const outbox = [...w.repo.outbox.of(w.a).values()].filter(
      (e) => e.template === 'esign.completed',
    );
    expect(outbox.map((e) => e.status)).toEqual(['SENT', 'SENT', 'SENT']);

    // Audit: ids only. Logs, audit and timeline never hold a value, a mark or a token.
    const audit = w.audit.entries.find((e) => e.action === 'esign.request_completed')!;
    expect(audit).toEqual({
      action: 'esign.request_completed',
      entity: { type: 'esign_request', id },
      metadata: {
        clientId: w.ids.c1,
        engagementId: w.ids.e1,
        finalDocumentId: done1.finalDocumentId,
        certificateDocumentId: done1.certificateDocumentId,
        emailIds: expect.any(Array),
      },
      at: { businessId: w.a },
    });
    const said = JSON.stringify([log.mock.calls, warn.mock.calls, w.audit.entries, events]);
    for (const secret of [FIELD_VALUE, 'Sender value', '#t=', 'iVBOR'])
      expect(said).not.toContain(secret);
  });

  it('a retry completes nothing twice', async () => {
    const me = person();
    const id = await sent(w.a, [me], [field(me.id, 'SIGNATURE')]);
    await sign(w.a, id, me, true);
    expect(await status(w.a, id)).toBe('COMPLETED');
    expect(await completion.complete(w.a, id)).toBe('ALREADY');
    signers.completionDue.add(id); // a stale due mark
    expect(await job.run({ businessIds: [w.a] })).toEqual({ skipped: false, completed: 0 });
    expect(repo.documents.of(w.a).size).toBe(2);
    expect(notify.completed()).toHaveLength(1);
    expect((await w.repo.events(w.a, id)).filter((e) => e.type === 'COMPLETED')).toHaveLength(1);
  });

  it('two runs at once: the second write finds it completed and files nothing', async () => {
    const id = await allSigned(w.a);
    const [one, two] = await Promise.all([
      completion.complete(w.a, id),
      completion.complete(w.a, id),
    ]);
    expect([one, two].sort()).toEqual(['ALREADY', 'COMPLETED']);
    expect(repo.documents.of(w.a).size).toBe(2);
    expect(notify.completed()).toHaveLength(1);
  });

  it('a failure mid-way leaves it due for the next run; finish still answers DONE', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const me = person();
    const id = await sent(w.a, [me], [field(me.id, 'SIGNATURE')]);
    pdf.fail = true;
    expect((await sign(w.a, id, me, true)).step).toBe('DONE');
    expect(await status(w.a, id)).toBe('PARTIALLY_SIGNED');
    expect(signers.completionDue.has(id)).toBe(true);
    expect(repo.documents.of(w.a).size).toBe(0);
    expect(notify.completed()).toEqual([]);
    expect(warn.mock.calls.flat().join()).toBe(`esign completion ${id} failed (Error)`);
    // Not before the retry time; then it completes.
    pdf.fail = false;
    expect(await job.run({ businessIds: [w.a] })).toEqual({ skipped: false, completed: 0 });
    const later = new Date(Date.now() + COMPLETION_RETRY_MS + 1000);
    expect(await job.run({ businessIds: [w.a], now: later })).toEqual({
      skipped: false,
      completed: 1,
    });
    expect(await status(w.a, id)).toBe('COMPLETED');
  });

  it('a database failure after the files were stored: the retry files once', async () => {
    const id = await allSigned(w.a);
    expect(await status(w.a, id)).toBe('PARTIALLY_SIGNED');
    expect(repo.documents.of(w.a).size).toBe(0);
    expect(await completion.complete(w.a, id)).toBe('COMPLETED');
    expect(repo.documents.of(w.a).size).toBe(2);
    expect(notify.completed()).toHaveLength(1);
  });

  it('an email that fails is FAILED in the outbox; the request is still completed', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const id = await allSigned(w.a);
    notify.fail = true;
    expect(await completion.complete(w.a, id)).toBe('COMPLETED');
    const outbox = [...w.repo.outbox.of(w.a).values()].filter(
      (e) => e.template === 'esign.completed',
    );
    expect(outbox).toEqual([expect.objectContaining({ status: 'FAILED', error: 'Error' })]);
    expect(warn.mock.calls.flat().join()).not.toContain('@client.test');
  });

  it('without fields: a signature page per signer, drawn or typed (R18 #286)', async () => {
    const one = person({ name: 'Fake One', routingOrder: 2 });
    const id = await sent(w.a, [one]);
    await sign(w.a, id, one, true);
    expect(pdf.finalized[0]!.stamps).toEqual([]);
    expect(pdf.finalized[0]!.signaturePages.map((p) => p.name)).toEqual(['Fake One']);
    expect(pdf.finalized[0]!.signaturePages[0]!.signaturePng).toBeInstanceOf(Uint8Array);
    const typed = person({ name: 'Fake Typed' });
    const id2 = await sent(w.a, [typed]);
    await sign(w.a, id2, typed);
    expect(await status(w.a, id2)).toBe('COMPLETED');
    const page = pdf.finalized[1]!.signaturePages[0]!;
    expect([page.typed, page.signaturePng]).toEqual(['Fake Typed', undefined]);
  });

  it('not due: an open signer, another status, or no such request', async () => {
    const one = person();
    const two = person();
    const id = await sent(
      w.a,
      [one, two],
      [field(one.id, 'SIGNATURE'), field(two.id, 'SIGNATURE')],
    );
    await sign(w.a, id, one, true);
    expect(await completion.complete(w.a, id)).toBe('NOT_DUE');
    expect(await completion.complete(w.a, randomUUID())).toBe('NOT_DUE');
    expect(pdf.finalized).toEqual([]);
  });
});

describe('the job', () => {
  it('skips while another task holds the lock', async () => {
    const id = await allSigned(w.a);
    repo.lockedElsewhere = true;
    expect(await job.run()).toEqual({ skipped: true });
    expect(await status(w.a, id)).toBe('PARTIALLY_SIGNED');
  });

  it('completes every firm’s due requests, each under its own firm', async () => {
    const a = await allSigned(w.a);
    const b = await allSigned(w.b);
    expect(await job.run()).toEqual({ skipped: false, completed: 2 });
    for (const [firm, id, client] of [
      [w.a, a, w.ids.c1],
      [w.b, b, w.ids.cB],
    ] as const) {
      expect(await status(firm, id)).toBe('COMPLETED');
      const docs = [...repo.documents.of(firm).values()];
      expect(docs.map((d) => d.clientId)).toEqual([client, client]);
      expect(docs.every((d) => d.key.startsWith(`tenant/${firm}/esign/${id}/`))).toBe(true);
    }
  });
});

describe('cross-firm', () => {
  it('one firm’s run never touches another firm’s request', async () => {
    const a = await allSigned(w.a);
    const b = await allSigned(w.b);
    const firmB = () => [...w.store.objects.keys()].filter((k) => k.includes(w.b));
    const before = firmB();
    expect(await job.run({ businessIds: [w.a] })).toEqual({ skipped: false, completed: 1 });
    expect(await status(w.b, b)).toBe('PARTIALLY_SIGNED');
    expect(repo.documents.of(w.b).size).toBe(0);
    expect(firmB()).toEqual(before);
    expect(signers.completionDue.has(b)).toBe(true);
    expect(notify.completed().map((m) => m.businessId)).toEqual([w.a]);
    expect(
      w.audit.entries.filter((e) => e.action === 'esign.request_completed').map((e) => e.entity.id),
    ).toEqual([a]);
  });

  it('a request id under the wrong firm is not due and writes nothing', async () => {
    const a = await allSigned(w.a);
    const tries = pdf.finalized.length;
    expect(await completion.complete(w.b, a)).toBe('NOT_DUE');
    expect(await repo.due(w.b, new Date(), 20)).toEqual([]);
    expect(await status(w.a, a)).toBe('PARTIALLY_SIGNED');
    expect(repo.documents.of(w.a).size + repo.documents.of(w.b).size).toBe(0);
    expect(pdf.finalized).toHaveLength(tries);
  });
});
