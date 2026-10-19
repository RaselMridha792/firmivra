import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ADMIN_BRAND_ASSET_LIMITS,
  type AdminBrandAsset,
  type AdminBrandAssetList,
  type AdminBrandAssetTicket,
  type AdminBrandingSection,
  type CreateAdminBrandAssetUploadRequest,
  PlatformBrandAssetKind,
  type SaveAdminBrandingRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { conflict, writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { PlatformPrisma } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { notFound } from '../workspaces/common.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { brandingOf, brandingValue } from './settings.mappers.js';

type Out<S extends z.ZodType> = z.output<S>;
type Kind = z.infer<typeof PlatformBrandAssetKind>;

export const BRAND_UPLOAD_LABEL = 'fv-platform-brand-upload-v1';
const UPLOAD_SECONDS = 900;

const BrandUploadClaim = z.object({
  pool: z.literal('ADMIN'),
  userId: z.uuid(),
  assetId: z.uuid(),
  key: z.string(),
  kind: PlatformBrandAssetKind,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});
type BrandUploadClaim = z.infer<typeof BrandUploadClaim>;

export class BrandUploadTokens extends Sealer<BrandUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(BRAND_UPLOAD_LABEL, BrandUploadClaim as never, secrets);
  }
}

/** First bytes of the image types brand assets take. */
const SIGNATURES: Record<string, number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'image/x-icon': [[0x00, 0x00, 0x01, 0x00]],
};
export const imageMatches = (contentType: string, bytes: Uint8Array) =>
  (SIGNATURES[contentType] ?? []).some((sig) => sig.every((b, i) => bytes[i] === b)) &&
  (contentType !== 'image/webp' || Buffer.from(bytes.slice(8, 12)).toString('latin1') === 'WEBP');

const KINDS = PlatformBrandAssetKind.options;
const assetSelect = {
  id: true,
  kind: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  scanStatus: true,
  s3Key: true,
  uploadedByUserId: true,
  createdAt: true,
} as const;
type AssetRow = {
  id: string;
  kind: Kind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  scanStatus: AdminBrandAsset['scanStatus'];
  s3Key: string;
  uploadedByUserId: string | null;
  createdAt: Date;
};

const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

/**
 * Platform branding (R55): the branding section and the brand images (R0 stage B7). Images go up
 * in the documents' three steps under `platform/branding/<asset id>/`, are checked (size, SHA-256,
 * image signature) and scanned; only a CLEAN image of the right kind can be put in use, and
 * Reset puts Firmivra's built-in one back. Nothing is deleted: every upload stays as a version.
 */
@Injectable()
export class AdminBrandingService {
  private readonly logger = new Logger(AdminBrandingService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly platform: PlatformPrisma,
    private readonly settings: AdminSettingsService,
    private readonly tokens: BrandUploadTokens,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
  ) {}

  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (e) {
      this.logger.warn(`Brand asset storage call failed: ${(e as Error).name}`);
      throw unavailable();
    }
  }

  private async view(rows: AssetRow[]): Promise<AdminBrandAsset[]> {
    const names = await this.settings.names(rows.map((r) => r.uploadedByUserId));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        kind: r.kind,
        fileName: r.fileName,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        width: r.width,
        height: r.height,
        scanStatus: r.scanStatus,
        url:
          r.scanStatus === 'CLEAN'
            ? await this.s3(() =>
                this.storage.presignDownload({
                  key: r.s3Key,
                  fileName: r.fileName,
                  contentType: r.contentType,
                }),
              ).catch(() => null)
            : null,
        uploadedBy: r.uploadedByUserId ? (names.get(r.uploadedByUserId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }

  async branding(): Promise<AdminBrandingSection> {
    const db = this.admin.db;
    const [row, current] = await Promise.all([
      db.platformSetting.findUnique({ where: { key: 'branding' } }),
      db.platformBrandCurrent.findMany({ include: { asset: { select: assetSelect } } }),
    ]);
    if (!row)
      throw new Error("platform_settings has no 'branding' row (the B7 migration seeds it)");
    const names = await this.settings.names([row.updatedByUserId]);
    const inUse = await this.view(current.map((c) => c.asset as AssetRow));
    const assets = Object.fromEntries(
      KINDS.map((k) => [k, inUse.find((a) => a.kind === k) ?? null]),
    ) as AdminBrandingSection['assets'];
    return {
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedByUserId ? (names.get(row.updatedByUserId) ?? null) : null,
      value: brandingOf(row.value),
      assets,
    };
  }

  async saveBranding(body: Out<typeof SaveAdminBrandingRequest>): Promise<AdminBrandingSection> {
    await this.settings.saveSection('branding', body.version, (old) =>
      brandingValue(old, body.value),
    );
    return this.branding();
  }

  async assets(kind?: Kind): Promise<AdminBrandAssetList> {
    const rows = await this.admin.db.platformBrandAsset.findMany({
      where: kind ? { kind } : {},
      select: assetSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return { items: await this.view(rows as AssetRow[]) };
  }

  async ticket(
    body: Out<typeof CreateAdminBrandAssetUploadRequest>,
  ): Promise<AdminBrandAssetTicket> {
    const allowed: readonly string[] = ADMIN_BRAND_ASSET_LIMITS.types[body.kind];
    if (!allowed.includes(body.contentType))
      throw conflict(
        'UPLOAD_MISMATCH',
        `A ${body.kind.toLowerCase().replace('_', ' ')} is ${allowed.join(' or ')}`,
      );
    const assetId = randomUUID();
    const key = `platform/branding/${assetId}/${body.fileName}`;
    const put = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const claim: BrandUploadClaim = {
      pool: 'ADMIN',
      userId: this.admin.adminUserId,
      assetId,
      key,
      kind: body.kind,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      ...(body.width ? { width: body.width } : {}),
      ...(body.height ? { height: body.height } : {}),
    };
    return {
      uploadToken: await this.tokens.seal(claim, UPLOAD_SECONDS),
      url: put.url,
      method: 'PUT',
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  async confirm(uploadToken: string): Promise<AdminBrandAsset> {
    const adminUserId = this.admin.adminUserId;
    const claim = (await this.tokens.open(uploadToken, 'ADMIN'))?.value;
    if (claim?.userId !== adminUserId)
      throw new GoneException({
        code: 'UPLOAD_EXPIRED',
        message: 'This upload has expired. Upload the file again.',
      });
    const used = await this.admin.db.platformBrandAsset.findUnique({
      where: { id: claim.assetId },
      select: { id: true },
    });
    if (used)
      throw new GoneException({ code: 'UPLOAD_EXPIRED', message: 'This upload was used already.' });
    const head = await this.s3(() => this.storage.head(claim.key));
    const bytes =
      head?.sizeBytes === claim.sizeBytes
        ? await this.s3(() => this.storage.read(claim.key))
        : null;
    const ok =
      !!bytes &&
      bytes.byteLength === claim.sizeBytes &&
      createHash('sha256').update(bytes).digest('hex') === claim.sha256 &&
      imageMatches(claim.contentType, bytes);
    if (!ok) {
      await this.storage.remove(claim.key).catch(() => undefined);
      throw new ConflictException({
        code: 'UPLOAD_MISMATCH',
        message: 'The file is not the image that was described.',
      });
    }
    await this.admin.transaction(async (tx) => {
      await tx.platformBrandAsset.create({
        data: {
          id: claim.assetId,
          kind: claim.kind,
          fileName: claim.fileName,
          contentType: claim.contentType,
          sizeBytes: claim.sizeBytes,
          width: claim.width ?? null,
          height: claim.height ?? null,
          sha256: claim.sha256,
          s3Key: claim.key,
        },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.brand_asset_uploaded',
        entityType: 'platform_brand_asset',
        entityId: claim.assetId,
        category: 'SYSTEM',
        severity: 'INFO',
        metadata: { kind: claim.kind, sizeBytes: claim.sizeBytes, scanMode: this.config.scanMode },
      });
    });
    // Locally the file is scanned at once; only platform scope sets a scan result, once.
    if (this.config.scanMode === 'local')
      await this.platform.db.platformBrandAsset.updateMany({
        where: { id: claim.assetId, scanStatus: 'PENDING' },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
    const row = await this.admin.db.platformBrandAsset.findUniqueOrThrow({
      where: { id: claim.assetId },
      select: assetSelect,
    });
    return (await this.view([row as AssetRow]))[0]!;
  }

  async setCurrent(kind: Kind, assetId: string): Promise<AdminBrandingSection> {
    const adminUserId = this.admin.adminUserId;
    await this.admin.transaction(async (tx) => {
      const asset = await tx.platformBrandAsset.findUnique({
        where: { id: assetId },
        select: { kind: true, scanStatus: true },
      });
      if (!asset) throw notFound();
      if (asset.kind !== kind) throw conflict('UPLOAD_MISMATCH', 'That image is for another place');
      if (asset.scanStatus !== 'CLEAN')
        throw conflict('ASSET_NOT_READY', 'This image is still being checked, or failed the check');
      await tx.platformBrandCurrent.upsert({
        where: { kind },
        create: { kind, assetId },
        update: { assetId },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'system_settings.brand_asset_set',
        entityType: 'platform_brand_asset',
        entityId: assetId,
        category: 'SYSTEM',
        severity: 'LOW',
        metadata: { kind },
      });
    });
    return this.branding();
  }

  async reset(kind: Kind): Promise<AdminBrandingSection> {
    const adminUserId = this.admin.adminUserId;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformBrandCurrent.deleteMany({ where: { kind } });
      if (count)
        await writeAdminEvent(tx, adminUserId, {
          action: 'system_settings.brand_asset_reset',
          entityType: 'platform_brand_current',
          entityId: kind,
          category: 'SYSTEM',
          severity: 'LOW',
          metadata: { kind },
        });
    });
    return this.branding();
  }
}
