import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  BRAND_ASSET_LIMITS,
  BrandAssetKind,
  type ConfirmBrandAssetUploadRequest,
  type CreateBrandAssetUploadRequest,
  type UploadTicket,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { notFound, refusal, storageUnavailable } from '../storage/document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  PUT_URL_SECONDS,
  statusOf,
} from '../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';
import { logoIdOf } from './logo-checks.js';

// Brand images besides the logo (Settings > Branding): the favicon and login background on
// business_settings, the email and portal logos on business_brand_profiles. Same three steps and
// checks as the logo (logo.service.ts): the API picks the key under the firm's prefix, the browser
// PUTs exactly that file, confirm checks size, SHA-256 and the real image type before the column
// changes. A refused file is deleted, and so is the image it replaces. Audit: the file's id only.

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/x-icon';

const BrandClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  kind: BrandAssetKind,
  key: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type BrandClaim = z.infer<typeof BrandClaim>;

export class BrandAssetTokens extends Sealer<BrandClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-brand-asset-upload-v1', BrandClaim, secrets);
  }
}

/** Where each kind is kept, and its public path segment. */
export const BRAND_ASSET_COLUMNS = {
  FAVICON: { table: 'settings', column: 'faviconKey', path: 'favicon' },
  LOGIN_BACKGROUND: { table: 'settings', column: 'loginBackgroundKey', path: 'login-background' },
  EMAIL_LOGO: { table: 'profile', column: 'emailLogoKey', path: 'email-logo' },
  PORTAL_LOGO: { table: 'profile', column: 'portalLogoKey', path: 'portal-logo' },
} as const satisfies Record<
  BrandAssetKind,
  { table: 'settings' | 'profile'; column: string; path: string }
>;

export const brandAssetOfPath = (path: string): BrandAssetKind | null =>
  (Object.entries(BRAND_ASSET_COLUMNS).find(([, c]) => c.path === path)?.[0] as
    BrandAssetKind | undefined) ?? null;

const starts = (bytes: Uint8Array, at: number, text: number[]) =>
  bytes.length >= at + text.length && text.every((b, i) => bytes[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** What the bytes really are (PNG, JPEG, WebP or ICO); null for anything else, SVG included. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, 0, ascii('RIFF')) && starts(bytes, 8, ascii('WEBP'))) return 'image/webp';
  if (starts(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  return null;
}

/** The declared type, normalised (both ICO names are one type). */
const normal = (type: string): string =>
  type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type;
const EXTENSION: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};
export const imageTypeOfKey = (key: string): ImageType =>
  (Object.entries(EXTENSION).find(([, ext]) => key.endsWith(`.${ext}`))?.[0] as ImageType) ??
  'image/png';

const invalidAsset = (message: string) =>
  new BadRequestException({ code: 'INVALID_ASSET', message });
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** The image's lasting public address, on the portal's host (like the logo's). */
export function brandAssetUrl(
  portalBaseUrl: string,
  slug: string,
  kind: BrandAssetKind,
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  const path = BRAND_ASSET_COLUMNS[kind].path;
  return `${portalBaseUrl.replace(/\/+$/, '')}/api/v1/portal/${slug}/branding/${path}?v=${logoIdOf(key)}`;
}

@Injectable()
export class BrandAssetsService {
  private readonly logger = new Logger(BrandAssetsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: BrandAssetTokens,
    private readonly audit: AuditService,
  ) {}

  /** Step 1: 400 INVALID_ASSET for a type or size the kind does not take. */
  async ticket(
    businessId: string,
    userId: string,
    body: CreateBrandAssetUploadRequest,
  ): Promise<UploadTicket> {
    const limits = BRAND_ASSET_LIMITS[body.kind];
    const type = normal(body.contentType) as ImageType;
    if (!limits.contentTypes.map(normal).includes(type) || !(type in EXTENSION)) {
      throw invalidAsset(`Use ${limits.recommended}`);
    }
    if (body.sizeBytes > limits.maxBytes) {
      throw invalidAsset(`The image is too large: at most ${String(limits.maxBytes / 1024)} KB`);
    }
    const path = BRAND_ASSET_COLUMNS[body.kind].path;
    const key = `tenant/${businessId}/branding/${path}/${randomUUID()}.${EXTENSION[type]}`;
    const claim: BrandClaim = { pool: 'STAFF', businessId, userId, key, ...body };
    const put = await this.s3('presign PUT', () =>
      this.storage.presignUpload({ ...claim, contentType: body.contentType }),
    );
    return {
      uploadToken: await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS),
      url: put.url,
      method: 'PUT',
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  /** Step 3: makes the stored file the brand image; 410 for someone else's or an old ticket. */
  async confirm(
    businessId: string,
    userId: string,
    body: ConfirmBrandAssetUploadRequest,
  ): Promise<BrandAssetKind> {
    const claim = (await this.tokens.open(body.uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const head = await this.s3('HEAD', () => this.storage.head(claim.key));
    const bytes = head ? await this.s3('GET', () => this.storage.read(claim.key)) : null;
    const fine =
      head &&
      head.contentEncoding === null &&
      bytes?.byteLength === claim.sizeBytes &&
      createHash('sha256').update(bytes).digest('hex') === claim.sha256 &&
      bytes.byteLength <= BRAND_ASSET_LIMITS[claim.kind].maxBytes &&
      sniffImage(bytes) === normal(claim.contentType);
    if (!fine) {
      await this.discard(claim.key);
      throw invalidAsset("The image doesn't match what was uploaded, or its type is not allowed");
    }
    const old = await this.set(businessId, userId, claim.kind, claim.key);
    if (old && old !== claim.key) await this.discard(old);
    return claim.kind;
  }

  /** Remove: the default shows again. Repeating is harmless. */
  async remove(businessId: string, userId: string, kind: BrandAssetKind): Promise<void> {
    const old = await this.set(businessId, userId, kind, null);
    if (old) await this.discard(old);
  }

  /** The image for its public address; 404 when the firm has none. */
  async stored(businessId: string, kind: BrandAssetKind) {
    const { table, column } = BRAND_ASSET_COLUMNS[kind];
    const db = this.database.forBusiness(businessId);
    const row =
      table === 'settings'
        ? await db.businessSettings.findUnique({
            where: { businessId },
            select: { [column]: true },
          })
        : await db.businessBrandProfile.findUnique({
            where: { businessId },
            select: { [column]: true },
          });
    const key = (row as Record<string, string | null> | null)?.[column] ?? null;
    const bytes = key ? await this.s3('GET', () => this.storage.read(key)) : null;
    if (!key || !bytes) throw notFound();
    return { bytes, contentType: imageTypeOfKey(key), version: logoIdOf(key) };
  }

  /** Sets the column and audits it in one transaction; returns the key it replaced. */
  private set(
    businessId: string,
    userId: string,
    kind: BrandAssetKind,
    key: string | null,
  ): Promise<string | null> {
    const { table, column } = BRAND_ASSET_COLUMNS[kind];
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const old = await this.current(tx, businessId, table, column);
      if (key === null && old === null) return null;
      if (table === 'settings') {
        await tx.businessSettings.update({ where: { businessId }, data: { [column]: key } });
      } else {
        await tx.businessBrandProfile.update({
          where: { businessId },
          data: { [column]: key, updatedByUserId: userId },
        });
      }
      await this.audit.logIn(
        tx,
        key ? 'branding.asset_uploaded' : 'branding.asset_removed',
        { type: 'business', id: businessId },
        { kind, assetId: logoIdOf(key ?? old!) },
        { businessId },
      );
      return old;
    });
  }

  /** The current key, the firm's rows made first (two first saves at once must not collide). */
  private async current(
    tx: TxClient,
    businessId: string,
    table: 'settings' | 'profile',
    column: string,
  ): Promise<string | null> {
    await ensureBrandRows(tx, businessId);
    const row =
      table === 'settings'
        ? await tx.businessSettings.findUnique({
            where: { businessId },
            select: { [column]: true },
          })
        : await tx.businessBrandProfile.findUnique({
            where: { businessId },
            select: { [column]: true },
          });
    return (row as Record<string, string | null> | null)?.[column] ?? null;
  }

  /** A file nobody uses; should the delete fail it stays (private) and the log says so. */
  async discard(key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(
        `Could not delete a brand image: ${nameOf(error)} (HTTP ${statusOf(error)})`,
      );
    });
  }

  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Storage ${operation} failed: ${nameOf(error)} (HTTP ${statusOf(error)})`);
      throw storageUnavailable();
    }
  }
}

/** The firm's settings and brand profile rows, made on first use (ON CONFLICT DO NOTHING). */
export async function ensureBrandRows(tx: TxClient, businessId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO business_settings (business_id, updated_at) VALUES (${businessId}::uuid, now())
    ON CONFLICT (business_id) DO NOTHING`;
  await tx.$executeRaw`
    INSERT INTO business_brand_profiles (business_id, updated_at) VALUES (${businessId}::uuid, now())
    ON CONFLICT (business_id) DO NOTHING`;
}
