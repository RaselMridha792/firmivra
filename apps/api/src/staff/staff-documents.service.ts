import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type StaffDocument,
  type StaffDocumentLink,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { checkFile } from '../storage/file-checks.js';
import type { ScanOutcome, ScanResult } from '../storage/scan-results.service.js';
import { notFound } from '../workspaces/common.js';
import type { CreateStaffDocumentUploadBody, UpdateStaffDocumentBody } from './staff-input.js';
import {
  assertManages,
  requireManager,
  type StaffActor,
  staffConflict,
  type Target,
  targetSelect,
} from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** HKDF label for staff document upload tokens: a token opens only here. */
export const STAFF_UPLOAD_LABEL = 'fv-staff-document-upload-v1';
/** As documents: the confirm comes within 15 minutes of the ticket. */
const UPLOAD_SECONDS = 900;

const StaffUploadClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  membershipId: z.uuid(),
  /** tenant/{businessId}/staff/{membershipId}/{uuid}, chosen by the API. */
  key: z.string(),
  type: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  replacesId: z.uuid().optional(),
});
type StaffUploadClaim = z.infer<typeof StaffUploadClaim>;

export class StaffUploadTokens extends Sealer<StaffUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(STAFF_UPLOAD_LABEL, StaffUploadClaim as never, secrets);
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** tenant/{businessId}/staff/{membershipId}/{uploadId}, as ticket() names a new object. */
const KEY = new RegExp(`^tenant/(${UUID})/staff/(${UUID})/(${UUID})$`);
/** A late scan result still finds its upload's refusal. */
const SCAN_REFUSALS_SINCE_MS = 24 * 60 * 60_000;
/** UNSUPPORTED because of the file itself (as documents); anything else is our side. */
const FILE_REASON =
  /^(PASSWORD_PROTECTED|OBJECT_SIZE_LIMIT_EXCEEDED|EXTRACTED_[A-Z_]+_LIMIT_EXCEEDED|EXTRACTION_RATIO_LIMIT_EXCEEDED)$/;
/** At most this many confirms check stored bytes at once; one more is 503 (as documents). */
const CHECKS_AT_ONCE = 4;
let checking = 0;

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** A Word 97-2003 file's macro storages, as their UTF-16 directory names. */
const DOC_MACROS = ['Macros', '_VBA_PROJECT'].map((name) => Buffer.from(name, 'utf16le'));

type Refusal = 'UPLOAD_MISMATCH' | 'FILE_PASSWORD_PROTECTED' | 'FILE_HAS_MACROS';

/**
 * Why stored bytes are not the declared type, or null. PDF, JPEG, PNG and DOCX are documents'
 * own checks (signature; a Word package without macros or a password). A Word 97-2003 file must
 * be a compound file, and one naming a macro storage is refused.
 */
export function checkStaffFile(contentType: string, bytes: Uint8Array): Refusal | null {
  if (contentType !== 'application/msword')
    return checkFile(contentType as UploadContentType, bytes);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < CFB.length || !CFB.every((b, i) => buf[i] === b)) return 'UPLOAD_MISMATCH';
  return DOC_MACROS.some((name) => buf.includes(name)) ? 'FILE_HAS_MACROS' : null;
}

const MESSAGES: Record<Refusal | 'UPLOAD_EXPIRED', string> = {
  UPLOAD_EXPIRED: 'This upload has expired. Upload the file again.',
  UPLOAD_MISMATCH: 'The file is not what was described. Upload it again.',
  FILE_PASSWORD_PROTECTED: 'Remove the password from the file, then upload it again.',
  FILE_HAS_MACROS: 'Files with macros can’t be uploaded.',
};
const refusal = (code: Refusal | 'UPLOAD_EXPIRED') =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message: MESSAGES[code] })
    : new ConflictException({ code, message: MESSAGES[code] });
const notReady = () =>
  staffConflict('DOCUMENT_NOT_READY', 'This file is still being checked, or failed the check');
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

const docSelect = {
  id: true,
  type: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  scanStatus: true,
  createdAt: true,
  archivedAt: true,
  uploadedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.StaffDocumentSelect;
type DocRow = Prisma.StaffDocumentGetPayload<{ select: typeof docSelect }>;

const view = (d: DocRow): StaffDocument => ({
  id: d.id,
  type: d.type,
  fileName: d.fileName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  scanStatus: d.scanStatus,
  uploadedBy: d.uploadedBy?.user.name ?? null,
  createdAt: d.createdAt.toISOString(),
  archivedAt: d.archivedAt?.toISOString() ?? null,
});

/**
 * Staff documents (R55; W-4, direct deposit, agreements, licences): the three-step upload under
 * tenant/{businessId}/staff/{membershipId}/, as the documents module's. The database shows and
 * changes these rows only to the acting Owner or Admin, so each scope names the actor; the
 * scanner (no actor) may only set a PENDING file's result. Confirm checks the stored bytes; a
 * refused file is deleted. Downloads only when CLEAN. Nothing is deleted: Replace adds a row and
 * archives the old one. The audit log gets ids and types, never a file name.
 */
@Injectable()
export class StaffDocumentsService {
  private readonly logger = new Logger(StaffDocumentsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: StaffUploadTokens,
    private readonly audit: AuditService,
  ) {}

  /** The acting Owner's or Admin's scope (the documents wall), with the member checked. */
  private inWall<T>(
    actor: StaffActor,
    id: string,
    change: boolean,
    fn: (tx: TxClient, target: Target) => Promise<T>,
  ): Promise<T> {
    const { businessId } = actor;
    return this.database.withScope(
      { kind: 'business', businessId, actorUserId: actor.userId },
      async (tx) => {
        await requireManager(tx, actor);
        const target = await tx.membership.findFirst({
          where: { businessId, id },
          select: targetSelect,
        });
        if (!target) throw notFound();
        if (change) assertManages(actor, target as Target);
        return fn(tx, target as Target);
      },
    );
  }

  private async findDoc(tx: TxClient, businessId: string, membershipId: string, docId: string) {
    const row = await tx.staffDocument.findFirst({
      where: { businessId, membershipId, id: docId },
      select: docSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  list(actor: StaffActor, id: string): Promise<StaffDocument[]> {
    return this.inWall(actor, id, false, async (tx) => {
      const rows = await tx.staffDocument.findMany({
        where: { businessId: actor.businessId, membershipId: id },
        select: docSelect,
        orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        take: 200,
      });
      return rows.map(view);
    });
  }

  async ticket(
    actor: StaffActor,
    id: string,
    body: Out<typeof CreateStaffDocumentUploadBody>,
  ): Promise<UploadTicket> {
    const { businessId } = actor;
    await this.inWall(actor, id, true, async (tx) => {
      if (body.replacesId) {
        const old = await this.findDoc(tx, businessId, id, body.replacesId);
        if (old.archivedAt) throw staffConflict('CONFLICT', 'This file was already replaced');
      }
    });
    const key = `tenant/${businessId}/staff/${id}/${randomUUID()}`;
    const put = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const claim: StaffUploadClaim = {
      pool: 'STAFF',
      businessId,
      userId: actor.userId,
      membershipId: id,
      key,
      type: body.type,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      ...(body.replacesId ? { replacesId: body.replacesId } : {}),
    };
    const uploadToken = await this.tokens.seal(claim, UPLOAD_SECONDS);
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  async confirm(actor: StaffActor, id: string, uploadToken: string): Promise<StaffDocument> {
    const { businessId } = actor;
    // The member first: another firm's member is 404 whatever the token holds.
    const claim = await this.inWall(actor, id, true, async (tx) => {
      const opened = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
      if (
        opened?.businessId !== businessId ||
        opened.userId !== actor.userId ||
        opened.membershipId !== id
      )
        throw refusal('UPLOAD_EXPIRED');
      const saved = await tx.staffDocument.findFirst({
        where: { businessId, s3Key: opened.key },
        select: { id: true },
      });
      if (saved) throw refusal('UPLOAD_EXPIRED');
      return opened;
    });
    const refused = await this.checkStored(claim);
    if (refused) {
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused staff upload in firm ${businessId}`);
      });
      await this.audit.log(
        'staff_document.upload_refused',
        { type: 'membership', id },
        { uploadId: claim.key.slice(claim.key.lastIndexOf('/') + 1), code: refused },
        { businessId },
      );
      throw refusal(refused);
    }
    let docId: string;
    try {
      docId = await this.inWall(actor, id, true, async (tx) => {
        const row = await tx.staffDocument.create({
          data: {
            businessId,
            membershipId: id,
            type: claim.type as StaffDocument['type'],
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            uploadedById: await requireManager(tx, actor),
          },
          select: { id: true },
        });
        if (claim.replacesId)
          await tx.staffDocument.updateMany({
            where: { businessId, membershipId: id, id: claim.replacesId, archivedAt: null },
            data: { archivedAt: new Date() },
          });
        await this.audit.logIn(
          tx,
          'staff_document.uploaded',
          { type: 'staff_document', id: row.id },
          {
            membershipId: id,
            type: claim.type,
            replacesId: claim.replacesId ?? null,
            scanMode: this.config.scanMode,
          },
          { businessId },
        );
        return row.id;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      throw error;
    }
    // A new file starts PENDING; locally it is scanned at once, as the scanner would (no actor).
    if (this.config.scanMode === 'local')
      await this.database.withScope({ kind: 'business', businessId }, (tx) =>
        tx.staffDocument.updateMany({
          where: { businessId, id: docId, scanStatus: 'PENDING' },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
        }),
      );
    return this.inWall(actor, id, false, async (tx) =>
      view(await this.findDoc(tx, businessId, id, docId)),
    );
  }

  /** View / Download: a 5-minute link to a CLEAN file whose stored bytes are still the confirmed ones. */
  async download(actor: StaffActor, id: string, docId: string): Promise<StaffDocumentLink> {
    const { businessId } = actor;
    const doc = await this.inWall(actor, id, false, (tx) =>
      this.findDoc(tx, businessId, id, docId),
    );
    if (doc.scanStatus !== 'CLEAN') throw notReady();
    const stored = await this.s3(() => this.storage.head(doc.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== doc.sizeBytes ||
      stored.sha256 !== doc.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Staff document ${doc.id}: the stored file is not the confirmed one`);
      throw notReady();
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: doc.s3Key,
        fileName: doc.fileName,
        contentType: doc.contentType,
      }),
    );
    await this.audit.log(
      'staff_document.download_link_issued',
      { type: 'staff_document', id: docId },
      { membershipId: id },
      { businessId },
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  /** Reclassify (the document type). */
  reclassify(
    actor: StaffActor,
    id: string,
    docId: string,
    body: Out<typeof UpdateStaffDocumentBody>,
  ): Promise<StaffDocument> {
    const { businessId } = actor;
    return this.inWall(actor, id, true, async (tx) => {
      const doc = await this.findDoc(tx, businessId, id, docId);
      if (doc.archivedAt) throw staffConflict('CONFLICT', 'This file is archived');
      if (doc.type !== body.type) {
        await tx.staffDocument.updateMany({
          where: { businessId, id: docId },
          data: { type: body.type },
        });
        await this.audit.logIn(
          tx,
          'staff_document.reclassified',
          { type: 'staff_document', id: docId },
          { membershipId: id, from: doc.type, to: body.type },
          { businessId },
        );
      }
      return view(await this.findDoc(tx, businessId, id, docId));
    });
  }

  /** Archive: kept (retention), out of the member's current files. Repeating is harmless. */
  archive(actor: StaffActor, id: string, docId: string): Promise<StaffDocument> {
    const { businessId } = actor;
    return this.inWall(actor, id, true, async (tx) => {
      const doc = await this.findDoc(tx, businessId, id, docId);
      if (!doc.archivedAt) {
        await tx.staffDocument.updateMany({
          where: { businessId, id: docId, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        await this.audit.logIn(
          tx,
          'staff_document.archived',
          { type: 'staff_document', id: docId },
          { membershipId: id },
          { businessId },
        );
      }
      return view(await this.findDoc(tx, businessId, id, docId));
    });
  }

  /**
   * A GuardDuty result for tenant/{businessId}/staff/{membershipId}/{uploadId}, for the scan
   * router: CLEAN or INFECTED; FAILED for a file the scan can't read; PENDING when the scan broke
   * on our side; UNKNOWN when no file has the key yet; IGNORED for another key, a result already
   * set, or an upload the confirm refused. The scanner's scope has no actor: the wall lets it
   * read a PENDING row and set its result once (updateMany, never update).
   */
  async recordScan(result: ScanResult): Promise<ScanOutcome> {
    const [, businessId, , uploadId] = KEY.exec(result.key) ?? [];
    if (!businessId || !uploadId) return 'IGNORED';
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const file = await tx.staffDocument.findFirst({
        where: { businessId, s3Key: result.key },
        select: { id: true, scanStatus: true },
      });
      if (!file) {
        const refused = await tx.auditLog.findFirst({
          where: {
            businessId,
            createdAt: { gte: new Date(Date.now() - SCAN_REFUSALS_SINCE_MS) },
            action: 'staff_document.upload_refused',
            metadata: { path: ['uploadId'], equals: uploadId },
          },
          select: { id: true },
        });
        // A file already scanned is no longer the scanner's to read: no record either way.
        return refused ? 'IGNORED' : 'UNKNOWN';
      }
      if (file.scanStatus !== 'PENDING') return 'IGNORED';
      const fileReason = (result.reasons ?? []).some((r) => FILE_REASON.test(r));
      const next =
        result.status === 'NO_THREATS_FOUND'
          ? 'CLEAN'
          : result.status === 'THREATS_FOUND'
            ? 'INFECTED'
            : result.status === 'UNSUPPORTED' && fileReason
              ? 'FAILED'
              : null;
      const entity = { type: 'staff_document', id: file.id };
      if (!next) {
        this.logger.warn(`Scan of staff document ${file.id} did not finish: ${result.status}`);
        await this.audit.logIn(
          tx,
          'staff_document.scan_unfinished',
          entity,
          { result: result.status },
          { businessId },
        );
        return 'PENDING';
      }
      const { count } = await tx.staffDocument.updateMany({
        where: { businessId, id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: next, scannedAt: new Date() },
      });
      if (!count) return 'IGNORED';
      await this.audit.logIn(
        tx,
        'staff_document.scanned',
        entity,
        { scanStatus: next, result: result.status },
        { businessId },
      );
      return next;
    });
  }

  /** At most CHECKS_AT_ONCE at a time; one more is 503 (nothing deleted). */
  private async checkStored(claim: StaffUploadClaim): Promise<Refusal | null> {
    if (checking >= CHECKS_AT_ONCE) throw unavailable();
    checking += 1;
    try {
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null)
        return 'UPLOAD_MISMATCH';
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256)
        return 'UPLOAD_MISMATCH';
      return checkStaffFile(claim.contentType, bytes);
    } finally {
      checking -= 1;
    }
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Staff document storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
