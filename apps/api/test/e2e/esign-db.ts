// A Firm Sign firm in the real test database (r0_esign) for the e2e tests that run the Prisma
// repositories: Firm Sign on, an Owner and a Staff member, a client with an ACTIVE service and a
// PRIMARY portal login (assigned to the Staff member), a published consent version and a CLEAN vault PDF. The app runs with the
// real guards and repositories; only the file store and the email sender are in memory. Synthetic data only.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { createPrismaClient, type PrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { ESIGN_STORE } from '../../src/esign/engine/engine.types.js';
import { MemoryEsignStore } from '../../src/esign/engine/esign-store.js';
import { KIOSK_AUTH } from '../../src/esign/extras/kiosk.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { pdf } from '../unit/esign-engine-fixtures.js';

/** The staff members' own password at the kiosk's exit (the sign-in check is faked). */
export const KIOSK_PASSWORD = 'Fake-Kiosk-Pass-1';

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
type Person = { id: string; email: string };

/** One firm of `tag` with Firm Sign on, in the owner client's own transactions. */
async function seedFirm(owner: PrismaClient, store: MemoryEsignStore, tag: string, consent = true) {
  const id = () => randomUUID();
  const person = (role: string): Person => ({
    id: id(),
    email: `${tag}-${role}-${id().slice(0, 8)}@esign.test`,
  });
  const people = { owner: person('owner'), staff: person('staff'), client: person('client') };
  const slug = `${tag}-${id().slice(0, 8)}`;
  const firm = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [k, p] of Object.entries(people)) {
      const pool = k === 'client' ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${k} ${tag}` },
      });
    }
    return tx.business.create({ data: { slug, name: `Fake Firm ${tag}`, status: 'ACTIVE' } });
  });
  const businessId = firm.id;
  const bytes = await pdf([
    [612, 792],
    [612, 792],
  ]);
  const ids = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    await tx.membership.create({
      data: { businessId, userId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { businessId, userId: people.staff.id, role: 'STAFF', status: 'ACTIVE' },
    });
    await tx.$queryRaw`SELECT app_set_business_module(${businessId}::uuid, 'esign', true, 'e2e test')`;
    const client = await tx.client.create({
      data: {
        ...{ businessId, displayName: `Fake Client ${tag}`, email: people.client.email },
        assignedUserId: people.staff.id,
      },
    });
    const login = await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.client.id,
        clientId: client.id,
        email: people.client.email,
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake annual tax' },
    });
    const engagement = await tx.engagement.create({
      data: {
        businessId,
        clientId: client.id,
        serviceId: service.id,
        title: 'Fake tax return',
        status: 'ACTIVE',
      },
    });
    const body = 'I agree to sign electronically (fake consent).';
    if (consent) {
      await tx.esignConsentVersion.create({
        data: { businessId, version: 1, bodyMarkdown: body, sha256: sha256(body) },
      });
    }
    const vault = await vaultPdf(tx, businessId, client.id, engagement.id, bytes);
    return { client: client.id, login: login.id, engagement: engagement.id, vault };
  });
  const vaultKey = `tenant/${businessId}/documents/${ids.vault}.pdf`;
  // A vault file (tests may seed the store's objects directly).
  store.objects.set(vaultKey, { bytes, contentType: 'application/pdf' });
  return { id: businessId, slug, people, ids, pdf: bytes };
}

/** A CLEAN PDF in the client's vault (a new document starts PENDING; the scan sets it once). */
async function vaultPdf(
  tx: TxClient,
  businessId: string,
  clientId: string,
  engagementId: string,
  bytes: Uint8Array,
): Promise<string> {
  const id = randomUUID();
  await tx.document.create({
    data: {
      ...{ id, businessId, clientId, engagementId, direction: 'FIRM_TO_CLIENT' },
      ...{ fileName: 'Fake engagement letter.pdf', contentType: 'application/pdf' },
      ...{ sizeBytes: bytes.byteLength, sha256: sha256(bytes) },
      s3Key: `tenant/${businessId}/documents/${id}.pdf`,
    },
  });
  await tx.document.update({
    where: { id },
    data: { scanStatus: 'CLEAN', scannedAt: new Date() },
  });
  return id;
}

export type EsignFirm = Awaited<ReturnType<typeof seedFirm>>;

/**
 * Two firms (A and B) and the app over the real database, with an in-memory file store. With
 * `bareB`, firm B has no consent version (as a firm that never opened Signing Settings).
 */
export async function esignDbWorld(tag: string, { bareB = false } = {}) {
  const fx = inject('fixtures');
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const store = new MemoryEsignStore();
  /** What would have been emailed or texted. */
  const outbox: NotifyMessage[] = [];
  const a = await seedFirm(owner, store, `${tag}-a`);
  const b = await seedFirm(owner, store, `${tag}-b`, !bareB);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.E2E_LOG ? 'error' : 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(ESIGN_STORE)
    .useValue(store)
    .overrideProvider(KIOSK_AUTH)
    .useValue({
      passwordOk: (_sub: string, password: string) => Promise.resolve(password === KIOSK_PASSWORD),
      signOut: () => Promise.resolve(),
    })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({
    logger: process.env.E2E_LOG ? ['error', 'warn'] : false,
  });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  const app: INestApplication = nest;

  const tokens = new Map<string, string>();
  const tokenFor = async (email: string) => {
    let token = tokens.get(email);
    if (!token) {
      const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
      token = (res.body as { token: string }).token;
      tokens.set(email, token);
    }
    return token;
  };
  type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** A call as `who` (a person's email), with a JSON body for writes. */
  const call = async (method: Method, path: string, who: Person, body?: object) => {
    const req = request(app.getHttpServer())
      [method](path)
      .set('authorization', `Bearer ${await tokenFor(who.email)}`);
    return body ? req.send(body) : req;
  };
  /** Reads (or changes) firm `firmId`'s rows directly, in its own scope (owner client). */
  const inFirm = <T>(firmId: string, fn: (tx: TxClient) => Promise<T>) =>
    runInScope(owner, { kind: 'business', businessId: firmId }, fn);
  const close = async () => {
    await app.close();
    await owner.$disconnect();
  };
  return { app, store, outbox, a, b, call, inFirm, close };
}
export type EsignDbWorld = Awaited<ReturnType<typeof esignDbWorld>>;

type DraftOptions = {
  authMethod?: 'LINK' | 'EMAIL_CODE' | 'ACCESS_CODE';
  accessCode?: string;
  /** More of the signer's fields (besides the SIGNATURE), by type. */
  signerFields?: ('TEXT' | 'ATTACHMENT')[];
  delivery?: 'EMAIL' | 'IN_PERSON';
  /** Who builds it (the Owner when left out). */
  sender?: Person;
  /** An uploaded blank file (CLEAN once scanned) in place of the client's vault file. */
  upload?: boolean;
  /** A staff member who approves it first. */
  approverUserId?: string;
};

/** A draft of firm `f` for its client, with the vault PDF, one signer and two fields. */
export async function readyDraft(
  w: EsignDbWorld,
  f: EsignFirm,
  title = 'Fake engagement letter',
  opts: DraftOptions = {},
) {
  const base = '/api/v1/esign/requests';
  const sender = opts.sender ?? f.people.owner;
  const created = await w.call('post', base, sender, {
    title,
    clientId: f.ids.client,
    engagementId: f.ids.engagement,
  });
  const id = (created.body as { id: string }).id;
  const doc = opts.upload
    ? await uploaded(w, f, sender, id)
    : await w.call('post', `${base}/${id}/documents/from-vault`, sender, {
        documentId: f.ids.vault,
      });
  const recipients = await w.call('put', `${base}/${id}/recipients`, sender, {
    recipients: [
      {
        role: 'CLIENT',
        routingOrder: 1,
        who: { type: 'CLIENT_LOGIN', clientAccountId: f.ids.login },
        authMethod: opts.authMethod ?? 'LINK',
        ...(opts.accessCode && { accessCode: opts.accessCode }),
        ...(opts.delivery && { delivery: opts.delivery }),
      },
      ...(opts.approverUserId
        ? [
            {
              kind: 'APPROVER',
              role: 'MANAGER',
              routingOrder: 1,
              who: { type: 'STAFF', userId: opts.approverUserId },
            },
          ]
        : []),
    ],
  });
  const signer = (
    recipients.body as { recipients: { id: string; kind: string }[] }
  ).recipients.find((r) => r.kind === 'SIGNER')!.id;
  const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.05 };
  const fields = await w.call('put', `${base}/${id}/fields`, sender, {
    fields: [
      { recipientId: signer, type: 'SIGNATURE', pageIndex: 1, ...box },
      { recipientId: null, type: 'TEXT', pageIndex: 0, ...box, value: 'Fake sender note' },
      ...(opts.signerFields ?? []).map((type, i) => ({
        recipientId: signer,
        type,
        pageIndex: 0,
        ...box,
        y: 0.3 + i * 0.1,
      })),
    ],
  });
  return { id, signer, created, doc, recipients, fields };
}

/** Uploads the firm's PDF to the draft and marks it scanned CLEAN (as the scanner would). */
async function uploaded(w: EsignDbWorld, f: EsignFirm, sender: Person, id: string) {
  const base = `/api/v1/esign/requests/${id}/documents`;
  const ticket = await w.call('post', `${base}/uploads`, sender, {
    fileName: 'Fake blank form.pdf',
    contentType: 'application/pdf',
    sizeBytes: f.pdf.byteLength,
    sha256: sha256(f.pdf),
  });
  const { url, uploadToken } = ticket.body as { url: string; uploadToken: string };
  await w.store.put(f.id, url.replace('memory://', ''), f.pdf, 'application/pdf');
  const doc = await w.call('post', `${base}/uploads/confirm`, sender, { uploadToken });
  const docId = (doc.body as { id: string }).id;
  await w.inFirm(f.id, (tx) =>
    tx.esignDocument.update({
      where: { id: docId },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    }),
  );
  return doc;
}

/** A sent request (readyDraft, then send). */
export async function sentRequest(
  w: EsignDbWorld,
  f: EsignFirm,
  title = 'Fake letter to sign',
  opts: DraftOptions = {},
) {
  const d = await readyDraft(w, f, title, opts);
  const sent = await w.call(
    'post',
    `/api/v1/esign/requests/${d.id}/send`,
    opts.sender ?? f.people.owner,
    {
      confirm: true,
    },
  );
  if (sent.status !== 200) throw new Error(`send: ${sent.status} ${JSON.stringify(sent.body)}`);
  return d;
}

/**
 * A fresh link token for the recipient (the emailed one is never stored): its hash at their
 * current token_version, as the API writes one.
 */
export async function linkToken(
  w: EsignDbWorld,
  f: EsignFirm,
  requestId: string,
  recipientId: string,
  purpose: 'SIGN' | 'COPY' = 'SIGN',
) {
  const token = randomBytes(32).toString('base64url');
  await w.inFirm(f.id, async (tx) => {
    const r = await tx.esignRecipient.findUniqueOrThrow({ where: { id: recipientId } });
    await tx.esignSigningLink.create({
      data: {
        ...{ businessId: f.id, requestId, recipientId, purpose, tokenHash: sha256(token) },
        ...{ tokenVersion: r.tokenVersion },
        expiresAt: purpose === 'SIGN' ? null : new Date(Date.now() + 86_400_000),
      },
    });
  });
  return token;
}

/** The signer pages of firm `f` as one browser: the cookie it holds, kept up to date. */
export function signerBrowser(w: EsignDbWorld, f: EsignFirm) {
  const base = `/api/v1/portal/${f.slug}/sign`;
  let cookie = '';
  const keep = (res: request.Response) => {
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const next = set.map((c) => c.split(';')[0]!).filter((c) => !c.endsWith('='));
    if (next.length > 0) cookie = next.join('; ');
    return res;
  };
  type Method = 'get' | 'post' | 'delete';
  const call = async (method: Method, path: string, body?: object) => {
    const req = request(w.app.getHttpServer())[method](`${base}${path}`);
    if (cookie) req.set('cookie', cookie);
    return keep(await (body ? req.send(body) : req));
  };
  return {
    call,
    open: (token: string) => call('post', '/session', { token }),
    /** Takes over a cookie set elsewhere (the Signature center's session). */
    adoptCookie: (res: request.Response) => keep(res),
  };
}
