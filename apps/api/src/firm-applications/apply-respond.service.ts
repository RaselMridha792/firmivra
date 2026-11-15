import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  APPLICATION_RESPONSE_ERRORS,
  type ApplicationResponseRequestView,
  type ApplicationResponseSession,
  type CreateApplicationResponseUploadRequest,
  type SubmitApplicationResponseRequest,
  type SubmitApplicationResponseResponse,
  type UploadContentType,
  type UploadPutTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { deriveKey, type PoolSecrets, poolSecrets, Sealer } from '../auth/sealed.js';
import { LOCAL_CODE } from '../client-auth/verification-codes.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  onlyPut,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { checkFile, type FileRefusal } from '../storage/file-checks.js';
import { readBudget } from '../storage/read-budget.js';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import { type ScanOutcome, scanVerdict } from '../storage/scan-results.service.js';

type SubmitBody = z.output<typeof SubmitApplicationResponseRequest>;
type UploadBody = z.output<typeof CreateApplicationResponseUploadRequest>;

/** The applicant is on the firm site (app host): its pool's secret seals their passes. */
const POOL = 'STAFF' as const;
/** After the code: 30 minutes to upload and send the answer. */
const SESSION_SECONDS = 30 * 60;
/** As documents: the answer that adds a file comes within 15 minutes of its upload ticket. */
const UPLOAD_SECONDS = 15 * 60;
const CODE_TTL_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Limits on codes, per request. Mutable for tests only. */
export const RESPONSE_CODE_LIMITS = { resendGapMs: 45_000, perRequestPerDay: 10, maxAttempts: 5 };
/** HKDF label for the key that hashes codes; a new label voids every open code. */
const CODE_KEY_LABEL = 'fv-application-response-code-v1';

const ResponsePass = z.object({
  pool: z.literal(POOL),
  requestId: z.uuid(),
  applicationId: z.uuid(),
  /** The response's id, chosen at the code check: its files go under its folder. */
  responseId: z.uuid(),
});
type ResponsePass = z.infer<typeof ResponsePass>;
const ResponseUploadClaim = ResponsePass.extend({
  /** tenant/{applicationId}/applications/{responseId}/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type ResponseUploadClaim = z.infer<typeof ResponseUploadClaim>;

export class ResponsePasses extends Sealer<ResponsePass> {
  constructor(secrets: PoolSecrets) {
    super('fv-application-response-session-v1', ResponsePass as never, secrets);
  }
}
export class ResponseUploadTokens extends Sealer<ResponseUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-application-response-upload-v1', ResponseUploadClaim as never, secrets);
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^tenant/(${UUID})/applications/(${UUID})/(${UUID})$`);

const MESSAGES = APPLICATION_RESPONSE_ERRORS;
const gone = (code: 'LINK_EXPIRED' | 'SESSION_EXPIRED' | 'UPLOAD_EXPIRED') =>
  new GoneException({ code, message: MESSAGES[code] });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

type Verified =
  { refused: 'CODE_INVALID' | 'CODE_LOCKED' } | { requestId: string; applicationId: string };

export const tokenHashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** "ca***@example.test": enough for the applicant to know where the code went. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/**
 * The applicant's answer to a request for more information (SA-APP-F04, Y02, Y05, Y06), public and
 * signed out, through the emailed link (only the token's SHA-256 is stored). Open the link, get a
 * 6-digit code at the application's contact email (its HMAC kept 10 minutes, the newest used
 * once), and the code check gives a 30-minute pass for that one request. Files go to the documents
 * bucket under tenant/{applicationId}/applications/{responseId}/ (PDF, JPG, PNG, 10 MB, at most
 * 10), are PENDING until GuardDuty's scan (the `applications` prefix, recorded here in platform
 * scope; clean at once locally), and reviewers open them only once CLEAN. The answer closes the
 * request, moves the application back to In Review and notifies the assigned reviewer (or every
 * Super Admin). Everything runs in platform scope, as the tables' rules expect; the audit log gets
 * ids only.
 */
@Injectable()
export class ApplyRespondService implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'applications';
  private readonly logger = new Logger(ApplyRespondService.name);
  private readonly codeKey: Uint8Array;
  private readonly localMode: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly passes: ResponsePasses,
    private readonly uploads: ResponseUploadTokens,
    private readonly audit: AuditService,
    private readonly router: ScanResultRouter,
  ) {
    const secret = poolSecrets(env)[POOL];
    if (!secret) throw new Error('No secret to hash application response codes');
    this.codeKey = deriveKey(secret, POOL, CODE_KEY_LABEL);
    this.localMode = env.AUTH_MODE === 'local';
  }

  onModuleInit(): void {
    this.router.register(this);
  }

  private platform<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'platform' }, fn);
  }

  /** The open request a link answers, with its application; 410 for anything else. */
  private async openRequest(tx: TxClient, token: string, lock = false) {
    const row = await tx.firmApplicationInfoRequest.findUnique({
      where: { tokenHash: tokenHashOf(token) },
      select: {
        id: true,
        applicationId: true,
        reason: true,
        requestedAt: true,
        expiresAt: true,
        status: true,
        application: {
          select: {
            legalName: true,
            contactName: true,
            contactEmail: true,
            assignedReviewerUserId: true,
          },
        },
      },
    });
    if (!row || row.status !== 'OPEN' || row.expiresAt <= new Date()) throw gone('LINK_EXPIRED');
    if (lock)
      await tx.$queryRaw`SELECT 1 FROM firm_application_info_requests WHERE id = ${row.id}::uuid FOR UPDATE`;
    return row;
  }

  private codeHash(requestId: string, code: string): string {
    return createHmac('sha256', this.codeKey).update(`${requestId}:${code}`).digest('hex');
  }

  async open(token: string): Promise<ApplicationResponseRequestView> {
    return this.platform(async (tx) => {
      const r = await this.openRequest(tx, token);
      await this.audit.logIn(
        tx,
        'firm_application.response_link_opened',
        { type: 'firm_application', id: r.applicationId },
        { requestId: r.id },
        { businessId: null },
      );
      return {
        legalName: r.application.legalName,
        reason: r.reason,
        requestedAt: r.requestedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        codeSentTo: maskEmail(r.application.contactEmail),
      };
    });
  }

  /** A new code to the contact email; nothing is sent inside the gap or above the day's cap. */
  async sendCode(token: string): Promise<{ sent: true }> {
    const issued = await this.platform(async (tx) => {
      const r = await this.openRequest(tx, token, true);
      const now = Date.now();
      const recent = await tx.firmApplicationResponseCode.findMany({
        where: { requestId: r.id, createdAt: { gt: new Date(now - DAY_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const last = recent[0]?.createdAt.getTime();
      if (last !== undefined && now - last < RESPONSE_CODE_LIMITS.resendGapMs) return null;
      if (recent.length >= RESPONSE_CODE_LIMITS.perRequestPerDay) return null;
      const code = this.localMode ? LOCAL_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.firmApplicationResponseCode.create({
        data: {
          requestId: r.id,
          codeHash: this.codeHash(r.id, code),
          expiresAt: new Date(now + CODE_TTL_MS),
        },
      });
      await this.audit.logIn(
        tx,
        'firm_application.response_code_sent',
        { type: 'firm_application', id: r.applicationId },
        { requestId: r.id },
        { businessId: null },
      );
      return { code, to: r.application.contactEmail, name: r.application.contactName };
    });
    if (issued) {
      try {
        await this.notify.send({
          template: 'firm-application.response-code',
          to: issued.to,
          businessId: null,
          data: { name: issued.name, code: issued.code },
        });
      } catch {
        this.logger.warn('An application response code email could not be sent');
      }
    }
    return { sent: true };
  }

  /** The newest code, used once: 5 tries, then a new code is needed. */
  async verify(token: string, code: string): Promise<ApplicationResponseSession> {
    const outcome = await this.platform(async (tx): Promise<Verified> => {
      const r = await this.openRequest(tx, token, true);
      const newest = await tx.firmApplicationResponseCode.findFirst({
        where: { requestId: r.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, codeHash: true, attempts: true, expiresAt: true, consumedAt: true },
      });
      if (!newest || newest.consumedAt || newest.expiresAt <= new Date())
        return { refused: 'CODE_INVALID' };
      if (newest.attempts >= RESPONSE_CODE_LIMITS.maxAttempts) return { refused: 'CODE_LOCKED' };
      const given = Buffer.from(this.codeHash(r.id, code), 'hex');
      const match = timingSafeEqual(given, Buffer.from(newest.codeHash, 'hex'));
      await tx.firmApplicationResponseCode.update({
        where: { id: newest.id },
        data: { attempts: { increment: 1 }, ...(match ? { consumedAt: new Date() } : {}) },
      });
      if (!match) return { refused: 'CODE_INVALID' };
      await this.audit.logIn(
        tx,
        'firm_application.response_code_verified',
        { type: 'firm_application', id: r.applicationId },
        { requestId: r.id },
        { businessId: null },
      );
      return { requestId: r.id, applicationId: r.applicationId };
    });
    if ('refused' in outcome) {
      const { refused } = outcome;
      throw refused === 'CODE_LOCKED'
        ? new HttpException({ code: refused, message: MESSAGES[refused] }, 429)
        : new BadRequestException({ code: refused, message: MESSAGES[refused] });
    }
    const pass: ResponsePass = { pool: POOL, ...outcome, responseId: randomUUID() };
    const session = await this.passes.seal(pass, SESSION_SECONDS);
    return { session, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString() };
  }

  /** The pass, and its request still open (410 otherwise). */
  private async pass(session: string): Promise<ResponsePass> {
    const pass = (await this.passes.open(session, POOL))?.value;
    if (!pass) throw gone('SESSION_EXPIRED');
    const open = await this.platform((tx) =>
      tx.firmApplicationInfoRequest.count({
        where: { id: pass.requestId, status: 'OPEN', expiresAt: { gt: new Date() } },
      }),
    );
    if (!open) throw gone('LINK_EXPIRED');
    return pass;
  }

  /** Where to PUT one file of the answer. */
  async ticket(body: UploadBody): Promise<UploadPutTicket> {
    const pass = await this.pass(body.session);
    const key = `tenant/${pass.applicationId}/applications/${pass.responseId}/${randomUUID()}`;
    const put = onlyPut(
      await this.s3(() =>
        this.storage.presignUpload({
          key,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          sha256: body.sha256,
        }),
      ),
    );
    const claim: ResponseUploadClaim = {
      ...pass,
      key,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    return {
      uploadToken: await this.uploads.seal(claim, UPLOAD_SECONDS),
      method: 'PUT',
      url: put.url,
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  /** The answer: text, files or both, on the same application. */
  async submit(body: SubmitBody): Promise<SubmitApplicationResponseResponse> {
    const pass = await this.pass(body.session);
    const claims = await this.check(body.uploadTokens, pass);
    const done = await this.platform(async (tx) => {
      const now = new Date();
      // Closes the request once: a second answer (or an expired or replaced link) finds none.
      const closed = await tx.firmApplicationInfoRequest.updateMany({
        where: { id: pass.requestId, status: 'OPEN', expiresAt: { gt: now } },
        data: { status: 'RESPONDED', closedAt: now },
      });
      if (closed.count !== 1) return null;
      const response = await tx.firmApplicationResponse.create({
        data: {
          id: pass.responseId,
          applicationId: pass.applicationId,
          requestId: pass.requestId,
          text: body.text ?? null,
        },
        select: { submittedAt: true },
      });
      const fileIds: string[] = [];
      for (const c of claims) {
        const file = await tx.firmApplicationResponseFile.create({
          data: {
            applicationId: pass.applicationId,
            responseId: pass.responseId,
            s3Key: c.key,
            fileName: c.fileName,
            contentType: c.contentType,
            sizeBytes: c.sizeBytes,
          },
          select: { id: true },
        });
        fileIds.push(file.id);
      }
      // Y02: Awaiting Information goes back to In Review (never to Pending).
      await tx.firmApplication.updateMany({
        where: { id: pass.applicationId, status: 'INFO_REQUESTED' },
        data: { status: 'IN_REVIEW' },
      });
      await this.notifyReviewers(tx, pass, now);
      await this.audit.logIn(
        tx,
        'firm_application.responded',
        { type: 'firm_application', id: pass.applicationId },
        {
          requestId: pass.requestId,
          responseId: pass.responseId,
          files: claims.length,
          text: !!body.text,
        },
        { businessId: null },
      );
      return { submittedAt: response.submittedAt, fileIds };
    });
    if (!done) throw gone('LINK_EXPIRED');
    if (this.config.scanMode === 'local' && done.fileIds.length) {
      // Locally (SCAN_MODE=local) a new file is clean at once, as the scanner would record it.
      await this.platform((tx) =>
        tx.firmApplicationResponseFile.updateMany({
          where: { id: { in: done.fileIds }, scanStatus: 'PENDING' },
          data: { scanStatus: 'CLEAN' },
        }),
      );
    }
    return { submittedAt: done.submittedAt.toISOString() };
  }

  /** Y05: an in-app item for the assigned reviewer, or for every Super Admin when none is. */
  private async notifyReviewers(tx: TxClient, pass: ResponsePass, at: Date): Promise<void> {
    const app = await tx.firmApplication.findUniqueOrThrow({
      where: { id: pass.applicationId },
      select: { legalName: true, assignedReviewerUserId: true },
    });
    const to = app.assignedReviewerUserId
      ? [app.assignedReviewerUserId]
      : (
          await tx.platformAdmin.findMany({
            where: { role: 'SUPER_ADMIN' },
            select: { userId: true },
          })
        ).map((a) => a.userId);
    if (to.length === 0) return;
    await tx.platformNotification.createMany({
      data: to.map((recipientUserId) => ({
        recipientUserId,
        category: 'FIRM_APPLICATIONS' as const,
        type: 'firm_application.responded',
        title: `Response received: ${app.legalName}`.slice(0, 200),
        body: 'The applicant answered your request for more information. Review it and decide.',
        sourceType: 'firm_application',
        sourceId: pass.applicationId,
        sourceLabel: app.legalName.slice(0, 200),
        eventKey: `firm_application.responded:${pass.responseId}`,
        requiresAction: true,
        attention: 'ACTION_REQUIRED' as const,
        occurredAt: at,
      })),
      skipDuplicates: true,
    });
  }

  /** Each file is this pass's, unused, and stored as declared; a refused one is deleted. */
  private async check(
    tokens: readonly string[],
    pass: ResponsePass,
  ): Promise<ResponseUploadClaim[]> {
    const claims: ResponseUploadClaim[] = [];
    for (const token of tokens) {
      const claim = (await this.uploads.open(token, POOL))?.value;
      if (
        !claim ||
        claim.requestId !== pass.requestId ||
        claim.responseId !== pass.responseId ||
        claim.applicationId !== pass.applicationId ||
        !KEY.test(claim.key)
      )
        throw gone('UPLOAD_EXPIRED');
      if (!claims.some((c) => c.key === claim.key)) claims.push(claim);
    }
    for (const claim of claims) {
      const refused = await this.checkStored(claim);
      if (refused) {
        await this.storage.remove(claim.key).catch(() => {
          this.logger.warn('Could not delete a refused application response upload');
        });
        await this.audit.log(
          'firm_application.response_upload_refused',
          { type: 'firm_application', id: claim.applicationId },
          { requestId: claim.requestId, code: refused },
          { businessId: null },
        );
        throw new ConflictException({ code: refused, message: MESSAGES[refused] });
      }
    }
    return claims;
  }

  private async checkStored(claim: ResponseUploadClaim): Promise<FileRefusal | null> {
    const stored = await this.s3(() => this.storage.head(claim.key, { checksum: true }));
    if (!stored) throw gone('UPLOAD_EXPIRED');
    if (
      stored.sizeBytes !== claim.sizeBytes ||
      stored.sha256 !== claim.sha256 ||
      stored.contentEncoding !== null
    )
      return 'UPLOAD_MISMATCH';
    return readBudget.hold(claim.sizeBytes, unavailable, async () => {
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (!bytes) throw gone('UPLOAD_EXPIRED');
      return checkFile(claim.contentType as UploadContentType, bytes);
    });
  }

  /**
   * GuardDuty's result for tenant/{applicationId}/applications/{responseId}/{uuid}: the key's
   * first id is the application (it has no firm yet). Recorded in platform scope, only on a
   * PENDING file.
   */
  async handle(result: RoutedScanResult): Promise<ScanOutcome> {
    const outcome = await this.platform(async (tx) => {
      const file = await tx.firmApplicationResponseFile.findFirst({
        where: { applicationId: result.businessId, s3Key: result.key },
        select: { id: true, contentType: true, scanStatus: true },
      });
      if (!file) return 'UNKNOWN' as const;
      if (file.scanStatus !== 'PENDING') return 'IGNORED' as const;
      const verdict = scanVerdict(
        { key: result.key, status: result.status, reasons: [...result.reasons] },
        file.contentType,
      );
      if (!verdict) {
        await this.audit.logIn(
          tx,
          'firm_application.file_scan_unfinished',
          { type: 'firm_application', id: result.businessId },
          { fileId: file.id, status: result.status },
          { businessId: null },
        );
        return 'PENDING' as const;
      }
      await tx.firmApplicationResponseFile.updateMany({
        where: { id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: verdict.scan },
      });
      await this.audit.logIn(
        tx,
        'firm_application.file_scanned',
        { type: 'firm_application', id: result.businessId },
        { fileId: file.id, scan: verdict.scan, unscanned: verdict.unscanned },
        { businessId: null },
      );
      const done: ScanOutcome = verdict.unscanned
        ? 'UNSCANNED'
        : verdict.scan === 'CLEAN'
          ? 'CLEAN'
          : verdict.scan === 'INFECTED'
            ? 'INFECTED'
            : 'FAILED';
      return done;
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }

  private async s3<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GoneException || (error as { status?: number }).status === 409)
        throw error;
      this.logger.warn(`Application response storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
