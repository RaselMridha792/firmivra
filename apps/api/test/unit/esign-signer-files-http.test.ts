// R13 signer routes, slice 3, over HTTP: EsignModule's signer controller with the in-memory ports
// (no database), R18's real link tokens, code HMAC and sealed cookie, and the cookie parser the
// app uses. Attachments (ticket, confirm, envelope, remove; another signer's is 404), the
// completed-copy link (code, copy, download; a wrong slug is 404) and the pipes. The guards and
// the database-backed answers are in test/e2e/esign-signer.e2e.test.ts. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadLink, SignerCopy, SignerField, SignerState, UploadTicket } from '@firmivra/types';
import type { EsignField } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { COMPLETION_REPOSITORY } from '../../src/esign/completion/completion.repository.js';
import { ESIGN_STORE, PDF_ENGINE } from '../../src/esign/engine/engine.types.js';
import { RandomLinkTokens } from '../../src/esign/engine/signer-security.js';
import { EXTRAS_REPOSITORY } from '../../src/esign/extras/extras.repository.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import type { EsignRecipientRecord } from '../../src/esign/requests/esign.repository.js';
import { ESIGN_REPOSITORY } from '../../src/esign/requests/esign.repository.js';
import { SIGNER_REPOSITORY } from '../../src/esign/signer/signer.repository.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  fakePdf,
  InMemoryCompletionRepository,
  InMemorySignerRepository,
  NO_KIOSK,
  NoDatabaseModule,
} from './esign-fakes.js';

const w = esignWorld();
const signers = new InMemorySignerRepository(w.repo);
const completed = new InMemoryCompletionRepository(w.repo, signers);
const tokens = new RandomLinkTokens();
const SLUG_A = 'fake-firm-a';
const SLUG_B = 'fake-firm-b';
const PACKET = new TextEncoder().encode('%PDF-fake-packet');
const PDF = new TextEncoder().encode('%PDF-1.7 fake attachment');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const mailed: NotifyMessage[] = [];

@Global()
@Module({
  providers: [
    { provide: AuditService, useValue: w.audit },
    { provide: NOTIFY_SERVICE, useValue: { send: (m: NotifyMessage) => mailed.push(m) } },
  ],
  exports: [AuditService, NOTIFY_SERVICE],
})
class FakeGlobalsModule {}

let app: INestApplication;

beforeAll(async () => {
  const firms = new Map([
    [SLUG_A, { id: w.a, slug: SLUG_A, name: 'Fake Firm A' }],
    [SLUG_B, { id: w.b, slug: SLUG_B, name: 'Fake Firm B' }],
  ]);
  const activeFirm = (slug: string) =>
    firms.get(slug) ? Promise.resolve(firms.get(slug)) : Promise.reject(new NotFoundException());
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, NoDatabaseModule, FakeGlobalsModule],
  })
    .overrideProvider(EXTRAS_REPOSITORY)
    .useValue(NO_KIOSK)
    .overrideProvider(PortalInfoService)
    .useValue({ activeFirm })
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(ESIGN_REPOSITORY)
    .useValue(w.repo)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(SIGNER_REPOSITORY)
    .useValue(signers)
    .overrideProvider(COMPLETION_REPOSITORY)
    .useValue(completed)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    .overrideProvider(PDF_ENGINE)
    .useValue(fakePdf)
    .compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  for (const firm of [w.a, w.b]) {
    signers.consents.set(firm, { id: randomUUID(), version: 1, bodyMarkdown: 'Fake consent' });
  }
});

afterAll(async () => {
  await app.close();
});

const person = (extra: Partial<EsignRecipientRecord> = {}): EsignRecipientRecord => ({
  ...{ id: randomUUID(), kind: 'SIGNER', role: 'CLIENT', roleLabel: null, routingOrder: 1 },
  ...{ name: 'Fake Signer', email: `${randomUUID().slice(0, 8)}@client.test`, phone: null },
  ...{ link: { type: 'EXTERNAL' }, delivery: 'EMAIL', authMethod: 'LINK', accessCodeHash: null },
  ...{ colorIndex: 0, status: 'SENT', sentAt: new Date(), viewedAt: null, signedAt: null },
  ...{ declinedAt: null, declineReason: null, lastRemindedAt: null, reminderCount: 0 },
  ...extra,
});
const attachment = (recipientId: string): EsignField => ({
  ...{ id: randomUUID(), recipientId, type: 'ATTACHMENT', pageIndex: 0, x: 0.1, y: 0.1 },
  ...{ w: 0.2, h: 0.05, required: true, label: null, mergeKey: null, options: [] },
  ...{ groupKey: null, value: null, filled: false },
});

/** A request of firm A in this status with these recipients and fields; its id. */
async function seeded(
  status: 'SENT' | 'COMPLETED',
  recipients: EsignRecipientRecord[],
  fields: EsignField[] = [],
) {
  const record = await w.repo.createRequest(w.a, {
    ...{ title: 'Fake letter', source: 'TAB', clientId: null, engagementId: null },
    ...{ senderUserId: w.users.ownerA, internalNote: null, emailSubject: null },
    ...{ emailMessage: null, routing: 'PARALLEL', expiryDays: 10, expiryWarningDays: 2 },
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
  });
  const packet = w.store.keyFor(w.a, record.id, `packet-${sha(PACKET)}.pdf`);
  await w.store.put(w.a, packet, PACKET, 'application/pdf');
  w.repo.seed(w.a, record.id, (row) => {
    const now = new Date();
    Object.assign(row.record, { status, sentAt: now, originalSha256: sha(PACKET) });
    row.record.expiresAt = new Date(now.getTime() + 86_400_000);
    row.record.completedAt = status === 'COMPLETED' ? now : null;
    row.parts.recipients = recipients;
    row.parts.fields = fields;
  });
  return record.id;
}

/** A link token (only its hash stored). */
function link(id: string, recipientId: string, purpose: 'SIGN' | 'COPY' = 'SIGN') {
  const { token, hash } = tokens.issue();
  signers.links.of(w.a).set(hash, { requestId: id, recipientId, tokenVersion: 0, purpose });
  return token;
}

const base = (slug = SLUG_A) => `/api/v1/portal/${slug}/sign`;
const server = () => request(app.getHttpServer());
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

/** Opens the link; answers the signer cookie as a header. */
async function open(token: string, slug = SLUG_A) {
  const res = await server()
    .post(`${base(slug)}/session`)
    .send({ token });
  expect(res.status).toBe(200);
  const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return set.map((c) => c.split(';')[0]).join('; ');
}

describe('attachments over HTTP', () => {
  it('ticket, confirm, the envelope, remove; another signer gets 404', async () => {
    const me = person();
    const other = person();
    const field = attachment(me.id);
    const id = await seeded('SENT', [me, other], [field, attachment(other.id)]);
    let cookie = await open(link(id, me.id));
    const consent = { versionId: signers.consents.get(w.a)!.id, agree: true };
    const accepted = await server().post(`${base()}/consent`).set('cookie', cookie).send(consent);
    expect(SignerState.parse(accepted.body).step).toBe('SIGN');
    cookie = String(accepted.headers['set-cookie']).split(';')[0]!;

    const facts = {
      ...{ fieldId: field.id, fileName: 'id.pdf', contentType: 'application/pdf' },
      ...{ sizeBytes: PDF.byteLength, sha256: sha(PDF) },
    };
    const started = await server()
      .post(`${base()}/attachments/uploads`)
      .set('cookie', cookie)
      .send(facts);
    expect(started.status).toBe(200);
    const ticket = UploadTicket.parse(started.body);
    await w.store.put(w.a, ticket.url.replace('memory://', ''), PDF, 'application/pdf');
    const confirmed = await server()
      .post(`${base()}/attachments/uploads/confirm`)
      .set('cookie', cookie)
      .send({ fieldId: field.id, uploadToken: ticket.uploadToken });
    expect([confirmed.status, SignerField.parse(confirmed.body).attachmentName]).toEqual([
      200,
      'id.pdf',
    ]);
    const envelope = await server().get(`${base()}/envelope`).set('cookie', cookie);
    const shown = (envelope.body as { fields: SignerField[] }).fields;
    expect(shown.map((f) => [f.id, f.attachmentName])).toEqual([[field.id, 'id.pdf']]);

    // Another signer of the same request at SIGN: not their field (404); no cookie: 404 too.
    const theirs = await open(link(id, other.id));
    const signing = await server().post(`${base()}/consent`).set('cookie', theirs).send(consent);
    const theirCookie = String(signing.headers['set-cookie']).split(';')[0]!;
    const del = (c?: string) => {
      const req = server().delete(`${base()}/attachments/${field.id}`);
      return c ? req.set('cookie', c) : req;
    };
    expect(errorOf(await del(theirCookie))).toEqual([404, 'NOT_FOUND']);
    expect(errorOf(await del())).toEqual([404, 'LINK_INVALID']);
    expect(await signers.attachments(w.a, id, me.id)).toHaveLength(1);

    const removed = await server()
      .delete(`${base()}/attachments/${field.id}`)
      .set('cookie', cookie);
    expect([removed.status, (removed.body as SignerField).attachmentName]).toEqual([200, null]);
    const again = await server().delete(`${base()}/attachments/${field.id}`).set('cookie', cookie);
    expect(errorOf(again)).toEqual([404, 'NOT_FOUND']);
    // The same cookie under firm B's slug.
    const moved = await server()
      .delete(`${base(SLUG_B)}/attachments/${field.id}`)
      .set('cookie', cookie.replace(`fv_sign_${SLUG_A}`, `fv_sign_${SLUG_B}`));
    expect(errorOf(moved)).toEqual([404, 'LINK_INVALID']);
  });
});

describe('the completed-copy link over HTTP', () => {
  it('a CC passes the email code, reads the copy and gets a 5-minute link', async () => {
    const cc = person({ kind: 'CC', status: 'WAITING', sentAt: null });
    const id = await seeded('COMPLETED', [person({ status: 'SIGNED' }), cc]);
    const file = (folder: string) => ({
      key: w.store.keyFor(w.a, id, `${folder}/${sha(PDF)}.pdf`),
      fileName: `Fake letter - ${folder}.pdf`,
      sizeBytes: PDF.byteLength,
      sha256: sha(PDF),
    });
    completed.stored.of(w.a).set(id, { final: file('final'), certificate: file('certificate') });
    signers.copyExpiry.of(w.a).set(cc.id, new Date(Date.now() + 30 * 86_400_000));
    const token = link(id, cc.id, 'COPY');
    expect(
      errorOf(
        await server()
          .post(`${base(SLUG_B)}/session`)
          .send({ token }),
      ),
    ).toEqual([404, 'LINK_INVALID']);
    let cookie = await open(token);
    expect(errorOf(await server().get(`${base()}/copy`).set('cookie', cookie))).toEqual([
      409,
      'WRONG_STEP',
    ]);
    expect((await server().post(`${base()}/code/send`).set('cookie', cookie)).status).toBe(200);
    const mail = mailed.at(-1) as NotifyMessage<'esign.code'>;
    expect(mail.to).toBe(cc.email);
    const verified = await server()
      .post(`${base()}/code/verify`)
      .set('cookie', cookie)
      .send({ code: mail.data.code });
    expect(SignerState.parse(verified.body)).toMatchObject({
      step: 'COPY',
      requestStatus: 'COMPLETED',
    });
    cookie = String(verified.headers['set-cookie']).split(';')[0]!;
    const copy = SignerCopy.parse(
      (await server().get(`${base()}/copy`).set('cookie', cookie)).body,
    );
    expect(copy.files.map((f) => f.fileName)).toEqual([
      'Fake letter - final.pdf',
      'Fake letter - certificate.pdf',
    ]);
    const res = await server().get(`${base()}/copy/download?file=final`).set('cookie', cookie);
    expect(DownloadLink.parse(res.body).url).toContain(`tenant/${w.a}/esign/${id}/final/`);
    const bad = await server().get(`${base()}/copy/download?file=original`).set('cookie', cookie);
    expect(errorOf(bad)).toEqual([400, 'VALIDATION_FAILED']);
  });
});
