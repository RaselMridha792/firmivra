import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, Prisma, ScanStatus, TxClient } from '@firmivra/db';
import {
  type AdvisoryResource,
  type AdvisoryResourceFile,
  type DownloadLink,
  fileNameFitsType,
  type SaveAdvisoryResourceRequest,
  type StartAdvisoryResourceFileRequest,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  multipartIdOf,
  uploadTicket,
} from '../storage/document-storage.js';
import { checkFile } from '../storage/file-checks.js';
import { readBudget } from '../storage/read-budget.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import { type ScanOutcome, scanVerdict } from '../storage/scan-results.service.js';
import { MultipartUploadId, uploadTokenSeconds } from '../storage/upload-token.js';
import { advErrors } from './advisory.common.js';
import { type AdvisoryCtx, AdvisoryReadService } from './advisory-read.service.js';
import { RESOURCES, resourceOf } from './catalog.js';

type Save = z.output<typeof SaveAdvisoryResourceRequest>;

/** HKDF label for advisory resource file tokens: a token opens only here. */
export const ADVISORY_RESOURCE_UPLOAD_LABEL = 'fv-advisory-resource-upload-v1';

const Claim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  /** tenant/{businessId}/advisory-resources/{uuid}, chosen by the API (the table's check). */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadId: MultipartUploadId.nullable(),
});
type Claim = z.infer<typeof Claim>;

export class AdvisoryResourceUploadTokens extends Sealer<Claim> {
  constructor(secrets: PoolSecrets) {
    super(ADVISORY_RESOURCE_UPLOAD_LABEL, Claim as never, secrets);
  }
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: 'The upload took too long. Add it again.' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const REFUSED: Record<string, string> = {
  UPLOAD_MISMATCH: 'The file did not upload correctly. Add it again.',
  FILE_PASSWORD_PROTECTED: 'Remove the password from the file, then add it again.',
  FILE_HAS_MACROS: 'Files with macros cannot be used.',
};
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

/** A firm's own resource's key: "r-" and its id (the catalog keys never look like this). */
const FIRM_KEY = /^r-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const firmKey = (id: string) => `r-${id}`;

const fileSelect = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  scanStatus: true,
} satisfies Prisma.AdvisoryResourceFileSelect;
type FileRow = Prisma.AdvisoryResourceFileGetPayload<{ select: typeof fileSelect }>;
const rowSelect = {
  id: true,
  catalogKey: true,
  title: true,
  category: true,
  kind: true,
  summary: true,
  url: true,
  clientFacing: true,
  archivedAt: true,
  file: { select: fileSelect },
} satisfies Prisma.AdvisoryResourceSelect;
type Row = Prisma.AdvisoryResourceGetPayload<{ select: typeof rowSelect }>;

/** CHECKING while the scan runs; READY once clean; BLOCKED when infected or the scan failed. */
const fileStatus = (scan: ScanStatus): AdvisoryResourceFile['status'] =>
  scan === 'CLEAN' ? 'READY' : scan === 'PENDING' ? 'CHECKING' : 'BLOCKED';
const toFile = (f: FileRow): AdvisoryResourceFile => ({
  id: f.id,
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  status: fileStatus(f.scanStatus),
});

/** A resource as Send, Preview and the library use it: the words sent with it and its file. */
export interface ResolvedResource extends AdvisoryResource {
  /** The file's row, for its link (never answered). */
  fileRow: FileRow | null;
}

/**
 * A-X10 (Q28, Business Advisory Review Two B28): the firm's own resources beside the built-in
 * library (catalog.ts), and its edited copy of a built-in one (`catalog_key`), on R1's
 * advisory_resources. Each has at most one https link or one uploaded file. Files take Documents'
 * three steps under tenant/{businessId}/advisory-resources/ (the scan router's prefix), start
 * PENDING, and are offered (a link, or Send) only once CLEAN; locally (SCAN_MODE=local) they are
 * clean at once. Anyone in Business Advisory sees the library; Owner and Admin (or the grid's
 * "Manage") add, edit and archive. The audit log gets ids, never a title or a file name.
 */
@Injectable()
export class AdvisoryResourcesService implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'advisory-resources';
  private readonly logger = new Logger(AdvisoryResourcesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: AdvisoryResourceUploadTokens,
    private readonly audit: AuditService,
    private readonly router: ScanResultRouter,
    private readonly read: AdvisoryReadService,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: AdvisoryCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  private static manager(ctx: AdvisoryCtx) {
    if (!ctx.perms.advisoryAdmin) throw advErrors.forbidden();
  }

  // ---------- The library ----------

  /** The built-in library (each with the firm's edits) and then the firm's own, not archived. */
  async all(tx: TxClient, businessId: string): Promise<ResolvedResource[]> {
    const rows = await tx.advisoryResource.findMany({
      where: { businessId, archivedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: rowSelect,
    });
    const edits = new Map(rows.flatMap((r) => (r.catalogKey ? [[r.catalogKey, r] as const] : [])));
    return [
      ...RESOURCES.map((def) => {
        const edit = edits.get(def.key);
        return edit ? fromRow(edit, def.key) : builtIn(def.key);
      }),
      ...rows.filter((r) => !r.catalogKey).map((r) => fromRow(r, firmKey(r.id))),
    ].filter((r): r is ResolvedResource => r !== null);
  }

  /** One resource by its key: a built-in one (with the firm's edits) or the firm's own. */
  async resolve(tx: TxClient, businessId: string, key: string): Promise<ResolvedResource | null> {
    const own = FIRM_KEY.exec(key);
    if (own) {
      const row = await tx.advisoryResource.findFirst({
        where: { businessId, id: own[1], catalogKey: null, archivedAt: null },
        select: rowSelect,
      });
      return row ? fromRow(row, key) : null;
    }
    if (!resourceOf(key)) return null;
    const edit = await tx.advisoryResource.findFirst({
      where: { businessId, catalogKey: key },
      select: rowSelect,
    });
    return edit ? fromRow(edit, key) : builtIn(key);
  }

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: {
      search?: string | undefined;
      category?: string | undefined;
      clientFacing?: boolean | undefined;
    },
  ): Promise<AdvisoryResource[]> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search?.toLowerCase();
      return (await this.all(ctx.tx, businessId))
        .filter(
          (r) =>
            (!search || r.title.toLowerCase().includes(search)) &&
            (!q.category || r.category.toLowerCase() === q.category.toLowerCase()) &&
            (q.clientFacing === undefined || r.clientFacing === q.clientFacing),
        )
        .map(view);
    });
  }

  // ---------- Add, edit, archive ----------

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Save,
  ): Promise<AdvisoryResource> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      AdvisoryResourcesService.manager(ctx);
      await this.checkFile(ctx.tx, businessId, body.fileId, null);
      const row = await ctx.tx.advisoryResource.create({
        data: { businessId, ...words(body), createdByUserId: userId },
        select: rowSelect,
      });
      await this.audit.logIn(
        ctx.tx,
        'advisory_resource.created',
        {
          type: 'advisory_resource',
          id: row.id,
        },
        { hasFile: row.file !== null, hasLink: row.url !== null },
      );
      return view(fromRow(row, firmKey(row.id))!);
    });
  }

  /** The firm's own resource, or its copy of a built-in one (the first edit makes the copy). */
  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Save,
  ): Promise<AdvisoryResource> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      AdvisoryResourcesService.manager(ctx);
      const { tx } = ctx;
      const own = FIRM_KEY.exec(key);
      let existing: { id: string; archivedAt: Date | null } | null;
      if (own) {
        existing = await tx.advisoryResource.findFirst({
          where: { businessId, id: own[1], catalogKey: null },
          select: { id: true, archivedAt: true },
        });
        if (!existing) throw notFound();
      } else {
        if (!resourceOf(key)) throw notFound();
        existing = await tx.advisoryResource.findFirst({
          where: { businessId, catalogKey: key },
          select: { id: true, archivedAt: true },
        });
      }
      if (existing?.archivedAt) throw advErrors.resourceArchived();
      await this.checkFile(tx, businessId, body.fileId, existing?.id ?? null);
      const row = existing
        ? await tx.advisoryResource.update({
            where: { businessId_id: { businessId, id: existing.id } },
            data: { ...words(body), updatedByUserId: userId },
            select: rowSelect,
          })
        : await tx.advisoryResource.create({
            data: { businessId, catalogKey: key, ...words(body), createdByUserId: userId },
            select: rowSelect,
          });
      await this.audit.logIn(
        tx,
        'advisory_resource.updated',
        { type: 'advisory_resource', id: row.id },
        {
          ...(own ? {} : { catalogKey: key }),
          hasFile: row.file !== null,
          hasLink: row.url !== null,
        },
      );
      return view(fromRow(row, key)!);
    });
  }

  /** The firm's own resource leaves the library (kept, never deleted); a built-in one is 409. */
  archive(businessId: string, tenant: TenantContext, userId: string, key: string) {
    return this.run(businessId, tenant, userId, async (ctx) => {
      AdvisoryResourcesService.manager(ctx);
      const own = FIRM_KEY.exec(key);
      if (!own) {
        if (resourceOf(key)) throw advErrors.resourceBuiltIn();
        throw notFound();
      }
      const { count } = await ctx.tx.advisoryResource.updateMany({
        where: { businessId, id: own[1], catalogKey: null, archivedAt: null },
        data: { archivedAt: new Date(), updatedByUserId: userId },
      });
      if (count === 0) {
        const known = await ctx.tx.advisoryResource.count({
          where: { businessId, id: own[1], catalogKey: null },
        });
        if (!known) throw notFound();
        return { ok: true as const };
      }
      await this.audit.logIn(ctx.tx, 'advisory_resource.archived', {
        type: 'advisory_resource',
        id: own[1],
      });
      return { ok: true as const };
    });
  }

  /**
   * A file for a resource: this firm's, not refused by the scan (409 FILE_BLOCKED), and not on
   * another resource (409 FILE_IN_USE). One still being checked may be attached.
   */
  private async checkFile(
    tx: TxClient,
    businessId: string,
    fileId: string | null,
    resourceId: string | null,
  ) {
    if (!fileId) return;
    const f = await tx.advisoryResourceFile.findFirst({
      where: { businessId, id: fileId },
      select: { scanStatus: true, resource: { select: { id: true } } },
    });
    if (!f) throw advErrors.invalid('fileId', 'Upload the file again');
    if (f.scanStatus === 'INFECTED' || f.scanStatus === 'FAILED')
      throw conflict('FILE_BLOCKED', 'This file failed its security check. Upload another.');
    if (f.resource && f.resource.id !== resourceId) throw advErrors.fileInUse();
  }

  // ---------- Files ----------

  /** Step 1: where to send the file. */
  async ticket(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: z.output<typeof StartAdvisoryResourceFileRequest>,
  ): Promise<UploadTicket> {
    const contentType = body.contentType as UploadContentType;
    await this.run(businessId, tenant, userId, async (ctx) => {
      AdvisoryResourcesService.manager(ctx);
    });
    if (!fileNameFitsType(body.fileName, contentType))
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid',
        details: [{ path: 'fileName', message: "The file's name does not match its type" }],
      });
    const key = `tenant/${businessId}/advisory-resources/${randomUUID()}`;
    const presigned = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const uploadId = multipartIdOf(presigned);
    const claim: Claim = {
      pool: 'STAFF',
      businessId,
      userId,
      key,
      fileName: body.fileName.trim(),
      contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      uploadId,
    };
    return uploadTicket(await this.tokens.seal(claim, uploadTokenSeconds(uploadId)), presigned);
  }

  /** Step 3: the stored bytes checked, the file recorded (CHECKING until its scan). */
  async confirm(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    uploadToken: string,
  ): Promise<AdvisoryResourceFile> {
    const claim = await this.run(businessId, tenant, userId, async (ctx) => {
      AdvisoryResourcesService.manager(ctx);
      const opened = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
      if (opened?.businessId !== businessId || opened.userId !== userId) throw expired();
      const known = await ctx.tx.advisoryResourceFile.findFirst({
        where: { businessId, s3Key: opened.key },
        select: { id: true },
      });
      if (known) throw expired();
      return opened;
    });
    const why = await this.checkStored(claim);
    if (why) {
      if (claim.uploadId)
        await this.storage.abortUpload(claim.key, claim.uploadId).catch(() => {
          this.logger.warn(
            `Could not drop a refused resource multipart upload in firm ${businessId}`,
          );
        });
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused resource upload in firm ${businessId}`);
      });
      await this.audit.log(
        'advisory_resource_file.upload_refused',
        { type: 'advisory_resource_file' },
        { code: why },
        { businessId },
      );
      throw conflict(why, REFUSED[why] ?? 'The file can’t be used');
    }
    let row: FileRow;
    try {
      row = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const created = await tx.advisoryResourceFile.create({
          data: {
            businessId,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            uploadedByUserId: userId,
          },
          select: fileSelect,
        });
        await this.audit.logIn(
          tx,
          'advisory_resource_file.added',
          { type: 'advisory_resource_file', id: created.id },
          { scanMode: this.config.scanMode },
        );
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw expired();
      throw error;
    }
    // Locally the file is scanned at once, as the scanner would record it.
    if (this.config.scanMode === 'local') {
      row = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await tx.advisoryResourceFile.updateMany({
          where: { businessId, id: row.id, scanStatus: 'PENDING' },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
        });
        return tx.advisoryResourceFile.findFirstOrThrow({
          where: { businessId, id: row.id },
          select: fileSelect,
        });
      });
    }
    return toFile(row);
  }

  /**
   * A 5-minute link to a resource's file, for anyone in Business Advisory: 409 SCAN_PENDING while
   * it is checked and FILE_BLOCKED once refused (or when the stored bytes are not the confirmed
   * ones). A resource with no file is 404.
   */
  async fileLink(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
  ): Promise<DownloadLink> {
    const file = await this.run(businessId, tenant, userId, async (ctx) => {
      const r = await this.resolve(ctx.tx, businessId, key);
      return r?.fileRow ?? null;
    });
    if (!file) throw notFound();
    return this.link(businessId, file);
  }

  /** A 5-minute link to a CLEAN file whose stored bytes are still the confirmed ones. */
  async link(businessId: string, file: FileRow): Promise<DownloadLink> {
    if (file.scanStatus === 'PENDING')
      throw conflict('SCAN_PENDING', 'The file is still being checked for viruses.');
    if (file.scanStatus !== 'CLEAN')
      throw conflict('FILE_BLOCKED', 'This file failed its security check.');
    const stored = await this.s3(() => this.storage.head(file.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      (stored.sha256 !== null && stored.sha256 !== file.sha256) ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(
        `Advisory resource file ${file.id}: the stored file is not the confirmed one`,
      );
      throw conflict('FILE_BLOCKED', 'This file is not available.');
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
      }),
    );
    await this.audit.log(
      'advisory_resource_file.download_link_issued',
      { type: 'advisory_resource_file', id: file.id },
      {},
      { businessId },
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  /**
   * GuardDuty's result for tenant/{businessId}/advisory-resources/{uuid}, in the key's own firm,
   * only on a PENDING file (the database sets a result once).
   */
  async handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome> {
    const outcome = await inFirm(async (tx): Promise<ScanOutcome> => {
      const file = await tx.advisoryResourceFile.findFirst({
        where: { businessId: result.businessId, s3Key: result.key },
        select: { id: true, contentType: true, scanStatus: true },
      });
      if (!file) return 'UNKNOWN';
      if (file.scanStatus !== 'PENDING') return 'IGNORED';
      const entity = { type: 'advisory_resource_file', id: file.id };
      const verdict = scanVerdict(
        { key: result.key, status: result.status, reasons: [...result.reasons] },
        file.contentType,
      );
      if (!verdict) {
        await this.audit.logIn(
          tx,
          'advisory_resource_file.scan_unfinished',
          entity,
          { result: result.status },
          { businessId: result.businessId },
        );
        return 'PENDING';
      }
      const { count } = await tx.advisoryResourceFile.updateMany({
        where: { businessId: result.businessId, id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: verdict.scan, scannedAt: new Date() },
      });
      if (!count) return 'IGNORED';
      await this.audit.logIn(
        tx,
        'advisory_resource_file.scanned',
        entity,
        {
          scanStatus: verdict.scan,
          result: result.status,
          ...(verdict.unscanned && { unscanned: true }),
        },
        { businessId: result.businessId },
      );
      return verdict.unscanned ? 'UNSCANNED' : verdict.scan;
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }

  /**
   * Holding the file's size of the read budget (no room: 503, nothing deleted or completed). A
   * multipart upload is completed first: 410 when storage no longer has it.
   */
  private checkStored(claim: Claim): Promise<string | null> {
    return readBudget.hold(claim.sizeBytes, unavailable, async () => {
      const { uploadId } = claim;
      if (uploadId) {
        const done = await this.s3(() =>
          this.storage.completeUpload(claim.key, uploadId, claim.sizeBytes),
        );
        if (done === 'MISSING') throw expired();
        if (done === 'MISMATCH') return 'UPLOAD_MISMATCH';
      }
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null)
        return 'UPLOAD_MISMATCH';
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256)
        return 'UPLOAD_MISMATCH';
      return checkFile(claim.contentType as UploadContentType, bytes);
    });
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoneException) throw error;
      this.logger.warn(`Advisory resource file storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}

/** The row's columns from a save. */
const words = (b: Save) => ({
  title: b.title,
  category: b.category,
  kind: b.kind,
  summary: b.summary,
  clientFacing: b.clientFacing,
  url: b.url ?? null,
  fileId: b.fileId ?? null,
});

/** B28: a video or a link goes as a Secure Link only; a document-like one as either. */
const formatsOf = (
  kind: AdvisoryResource['kind'],
  builtInKey: string | null,
): AdvisoryResource['formats'] => {
  if (kind === 'VIDEO' || kind === 'LINK') return ['SECURE_LINK'];
  // A firm's own document goes as a Secure Link (its file or link opens in the portal); a
  // built-in one keeps the catalog's PDF copy too.
  return builtInKey ? ['SECURE_LINK', 'PDF'] : ['SECURE_LINK'];
};

function builtIn(key: string): ResolvedResource | null {
  const def = resourceOf(key);
  if (!def) return null;
  return { ...def, source: 'BUILT_IN', edited: false, file: null, fileRow: null };
}

function fromRow(row: Row, key: string): ResolvedResource | null {
  const builtInKey = row.catalogKey;
  return {
    key,
    title: row.title,
    category: row.category,
    kind: row.kind,
    clientFacing: row.clientFacing,
    url: row.url,
    formats: formatsOf(row.kind, builtInKey),
    summary: row.summary,
    source: builtInKey ? 'BUILT_IN' : 'FIRM',
    edited: builtInKey !== null,
    file: row.file ? toFile(row.file) : null,
    fileRow: row.file,
  };
}

/** The answer's shape (never the file's storage key). */
const view = ({ fileRow: _f, ...r }: ResolvedResource): AdvisoryResource => r;
