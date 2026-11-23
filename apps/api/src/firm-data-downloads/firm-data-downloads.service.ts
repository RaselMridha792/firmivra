import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, ScopedClient } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { deriveKey } from '../auth/sealed.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import {
  DOCUMENT_STORAGE,
  GET_URL_SECONDS,
  type DocumentStorage,
} from '../storage/document-storage.js';

const DAY = 86_400_000;
const CODE_TTL = 10 * 60_000;
const SESSION_TTL = 60 * 60_000;
const TOKEN_BYTES = 32;
const denied = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const inactive = () =>
  new ConflictException({
    code: 'DOWNLOAD_ACCESS_INACTIVE',
    message: 'This download link is no longer active.',
  });

type OwnerIdentity = { userId: string; email: string; name: string };
type DownloadSession = { grantId: string; expiresAt: number };

/** Closed-firm records are exposed only through a revocable grant and an emailed one-time code. */
@Injectable()
export class FirmDataDownloadsService {
  private readonly codeKey: Uint8Array;
  private readonly sessionKey: Uint8Array;
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly admin: AdminPrisma,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(ENV) private readonly env: Env,
  ) {
    const secret =
      env.AUTH_MODE === 'local' ? env.LOCAL_AUTH_SECRET : env.COGNITO_ADMINS_CLIENT_SECRET;
    if (!secret) throw new Error('Closed-firm download code secret is not configured');
    this.codeKey = deriveKey(secret, 'ADMIN', 'firm-data-download-code-v1');
    this.sessionKey = deriveKey(secret, 'ADMIN', 'firm-data-download-session-v1');
  }

  private get platform(): ScopedClient {
    return this.database.forPlatform();
  }
  private codeHash(code: string): string {
    return createHmac('sha256', this.codeKey).update(code).digest('hex');
  }
  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async ownerForBusiness(db: ScopedClient, businessId: string): Promise<OwnerIdentity> {
    const owner = await db.membership.findFirst({
      where: { businessId, role: 'OWNER', status: 'ACTIVE' },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) throw this.ownerEmailMissing();
    // Admin scope exposes the owner membership, while the platform-scoped user row holds
    // contact fields. Keep those reads separate so the user RLS policy doesn't hide the email.
    return this.ownerByUserId(this.platform, owner.userId);
  }

  private ownerEmailMissing() {
    return new ConflictException({
      code: 'OWNER_EMAIL_MISSING',
      message: 'The firm has no active owner email.',
    });
  }

  /** Public link/code requests use the grant's stored owner id and platform-visible user row. */
  private async ownerByUserId(db: ScopedClient, userId: string): Promise<OwnerIdentity> {
    const owner = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!owner?.email) throw this.ownerEmailMissing();
    return { userId: owner.id, email: owner.email, name: owner.name ?? '' };
  }

  /** Called at closure and by Super Admin when granting a requested window. */
  async createGrant(
    businessId: string,
    kind: 'AUTOMATIC' | 'REQUESTED',
    adminUserId?: string,
    reason?: string,
  ) {
    const db = this.platform;
    const firm = await db.business.findUnique({
      where: { id: businessId },
      select: { status: true, closedAt: true },
    });
    if (!firm || firm.status !== 'CLOSED' || !firm.closedAt) throw denied();
    const day90 = new Date(firm.closedAt.getTime() + 90 * DAY);
    if (Date.now() >= day90.getTime()) throw inactive();
    // Admin scope can read only the firm's Owner contact, unlike broad platform scope.
    const owner = await this.ownerForBusiness(this.admin.db, businessId);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Math.min(firm.closedAt.getTime() + (kind === 'AUTOMATIC' ? 30 : 90) * DAY, day90.getTime()),
    );
    const grant = await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const row = await tx.firmDataDownloadGrant.create({
        data: {
          businessId,
          ownerUserId: owner.userId,
          kind,
          ...(reason ? { reason } : {}),
          ...(adminUserId ? { grantedByUserId: adminUserId } : {}),
          tokenHash: this.tokenHash(token),
          startsAt: new Date(),
          expiresAt,
        },
      });
      await tx.firmDataDownloadLog.create({
        data: { businessId, grantId: row.id, event: 'ISSUED', actorUserId: adminUserId ?? null },
      });
      return row;
    });
    const link = `${this.env.APP_BASE_URL}/closed-firm-download#token=${encodeURIComponent(token)}`;
    try {
      await this.notify.send({
        template: 'platform.firm-download-link',
        to: owner.email,
        businessId: null,
        data: { name: owner.name, link, expiresAt },
      });
    } catch {
      // The grant remains auditable and the Super Admin can issue another requested grant.
    }
    return { id: grant.id, kind: grant.kind, expiresAt: grant.expiresAt.toISOString() };
  }

  async ensureAutomaticGrant(businessId: string) {
    const existing = await this.platform.firmDataDownloadGrant.findFirst({
      where: { businessId, kind: 'AUTOMATIC' },
    });
    return existing ?? this.createGrant(businessId, 'AUTOMATIC');
  }

  async revoke(businessId: string, grantId: string, adminUserId: string, reason: string) {
    await this.database.withScope({ kind: 'platform' }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM firm_data_download_grants WHERE business_id = ${businessId}::uuid AND id = ${grantId}::uuid FOR UPDATE`;
      const grant = await tx.firmDataDownloadGrant.findFirst({
        where: { businessId, id: grantId },
      });
      if (!grant) throw denied();
      if (grant.revokedAt) throw inactive();
      await tx.firmDataDownloadGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revokedByUserId: adminUserId, revokeReason: reason },
      });
      await tx.firmDataDownloadLog.create({
        data: { businessId, grantId, event: 'REVOKED', actorUserId: adminUserId },
      });
    });
    return { id: grantId, revoked: true };
  }

  async adminList(businessId: string) {
    const grants = await this.platform.firmDataDownloadGrant.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        reason: true,
        startsAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        log: {
          select: { event: true, occurredAt: true, fileCount: true, bytes: true },
          orderBy: { occurredAt: 'desc' },
        },
      },
    });
    return grants.map((grant) => ({
      ...grant,
      bytes: grant.log.reduce((sum, event) => sum + (event.bytes ?? 0n), 0n).toString(),
      log: grant.log.map((event) => ({ ...event, bytes: event.bytes?.toString() ?? null })),
    }));
  }

  private async grantForToken(token: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw denied();
    const grant = await this.platform.firmDataDownloadGrant.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { business: { select: { closedAt: true, status: true } } },
    });
    const now = Date.now();
    if (
      !grant ||
      grant.business.status !== 'CLOSED' ||
      grant.revokedAt ||
      grant.startsAt.getTime() > now ||
      grant.expiresAt.getTime() <= now ||
      !grant.business.closedAt ||
      grant.expiresAt.getTime() > grant.business.closedAt.getTime() + 90 * DAY
    )
      throw denied();
    return grant;
  }

  async sendCode(token: string) {
    const grant = await this.grantForToken(token);
    const db = this.platform;
    const owner = await this.ownerByUserId(db, grant.ownerUserId);
    if (owner.userId !== grant.ownerUserId) throw denied();
    const code = String(randomInt(100_000, 1_000_000));
    // The code table is introduced by the standalone schema PR. Use parameterized SQL here so
    // this feature-only PR still typechecks against main before that schema PR merges.
    await this.database.withScope(
      { kind: 'platform' },
      (tx) =>
        tx.$executeRaw`
        INSERT INTO firm_data_download_codes (id, grant_id, code_hash, expires_at)
        VALUES (
          ${randomUUID()}::uuid,
          ${grant.id}::uuid,
          ${this.codeHash(code)},
          ${new Date(Date.now() + CODE_TTL)}::timestamptz
        )
      `,
    );
    await this.notify.send({
      template: 'platform.firm-download-code',
      to: owner.email,
      businessId: null,
      data: { code },
    });
    return { sent: true, expiresInSeconds: 600 };
  }

  private session(grantId: string, expiresAt: number) {
    const payload = Buffer.from(
      JSON.stringify({ grantId, expiresAt } satisfies DownloadSession),
    ).toString('base64url');
    const signature = createHmac('sha256', this.sessionKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private async sessionGrant(sessionToken: string) {
    const [payload, signature, extra] = sessionToken.split('.');
    if (!payload || !signature || extra) throw denied();
    const expected = createHmac('sha256', this.sessionKey).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, 'base64url');
    } catch {
      throw denied();
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw denied();
    let session: DownloadSession;
    try {
      session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DownloadSession;
    } catch {
      throw denied();
    }
    if (!session.grantId || session.expiresAt <= Date.now()) throw denied();
    const grant = await this.platform.firmDataDownloadGrant.findUnique({
      where: { id: session.grantId },
      include: { business: { select: { status: true, closedAt: true } } },
    });
    if (
      !grant ||
      grant.business.status !== 'CLOSED' ||
      grant.revokedAt ||
      grant.expiresAt.getTime() <= Date.now() ||
      !grant.business.closedAt ||
      grant.expiresAt.getTime() > grant.business.closedAt.getTime() + 90 * DAY
    )
      throw denied();
    return grant;
  }

  async verifyCode(token: string, value: string) {
    const grant = await this.grantForToken(token);
    const owner = await this.ownerByUserId(this.platform, grant.ownerUserId);
    if (owner.userId !== grant.ownerUserId) throw denied();
    if (!/^\d{6}$/.test(value))
      throw new BadRequestException({ code: 'INVALID_CODE', message: 'Enter the six-digit code.' });
    const codes = await this.platform.$queryRaw<
      { id: string; attempts: number; codeHash: string }[]
    >`
      SELECT id, attempts, code_hash AS "codeHash"
      FROM firm_data_download_codes
      WHERE grant_id = ${grant.id}::uuid AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const code = codes[0];
    if (!code || code.attempts >= 5) throw denied();
    const expectedCodeHash = Buffer.from(this.codeHash(value), 'hex');
    const storedCodeHash = Buffer.from(code.codeHash, 'hex');
    const codeMatches =
      storedCodeHash.length === expectedCodeHash.length &&
      timingSafeEqual(storedCodeHash, expectedCodeHash);
    if (!codeMatches) {
      const changed = await this.platform.$queryRaw<{ id: string }[]>`
        UPDATE firm_data_download_codes
        SET attempts = attempts + 1
        WHERE id = ${code.id}::uuid AND attempts < 5 AND consumed_at IS NULL
        RETURNING id
      `;
      if (!changed.length) throw denied();
      throw denied();
    }
    const consumed = await this.platform.$queryRaw<{ id: string }[]>`
      UPDATE firm_data_download_codes SET consumed_at = now()
      WHERE id = ${code.id}::uuid AND consumed_at IS NULL
      RETURNING id
    `;
    if (!consumed.length) throw denied();
    const expiresAt = Math.min(Date.now() + SESSION_TTL, grant.expiresAt.getTime());
    return {
      sessionToken: this.session(grant.id, expiresAt),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async clients(sessionToken: string) {
    const grant = await this.sessionGrant(sessionToken);
    return this.platform.client.findMany({
      where: { businessId: grant.businessId },
      orderBy: { clientNumber: 'asc' },
      select: {
        id: true,
        clientNumber: true,
        displayName: true,
        email: true,
        phone: true,
        clientSince: true,
        status: true,
      },
    });
  }

  async files(sessionToken: string) {
    const grant = await this.sessionGrant(sessionToken);
    const rows = await this.platform.document.findMany({
      where: { businessId: grant.businessId, scanStatus: 'CLEAN' },
      orderBy: [{ clientId: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        clientId: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
        folder: { select: { id: true, name: true } },
      },
    });
    const clients = await this.platform.client.findMany({
      where: {
        businessId: grant.businessId,
        id: { in: [...new Set(rows.map((row) => row.clientId))] },
      },
      select: { id: true, displayName: true },
    });
    const names = new Map(clients.map((client) => [client.id, client.displayName]));
    return rows.map((row) => ({ ...row, clientName: names.get(row.clientId) ?? 'Former client' }));
  }

  async fileLink(sessionToken: string, fileId: string) {
    const grant = await this.sessionGrant(sessionToken);
    const file = await this.platform.document.findFirst({
      where: { id: fileId, businessId: grant.businessId, scanStatus: 'CLEAN' },
      select: { s3Key: true, fileName: true, contentType: true, sizeBytes: true },
    });
    if (!file) throw denied();
    const url = await this.storage.presignDownload({
      key: file.s3Key,
      fileName: file.fileName,
      contentType: file.contentType,
    });
    await this.platform.firmDataDownloadLog.create({
      data: {
        businessId: grant.businessId,
        grantId: grant.id,
        event: 'DOWNLOADED',
        actorUserId: grant.ownerUserId,
        fileCount: 1,
        bytes: BigInt(file.sizeBytes),
      },
    });
    return { url, expiresInSeconds: GET_URL_SECONDS };
  }

  async clientsCsv(sessionToken: string) {
    const grant = await this.sessionGrant(sessionToken);
    const clients = await this.clients(sessionToken);
    const cell = (value: string | number | null) => {
      const raw = String(value ?? '');
      const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [
      'Client number,Name,Email,Phone,Client since,Status',
      ...clients.map((client) =>
        [
          client.clientNumber,
          client.displayName,
          client.email,
          client.phone,
          client.clientSince?.toISOString().slice(0, 10) ?? '',
          client.status,
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\r\n');
    const bytes = Buffer.byteLength(csv, 'utf8');
    await this.platform.firmDataDownloadLog.create({
      data: {
        businessId: grant.businessId,
        grantId: grant.id,
        event: 'DOWNLOADED',
        actorUserId: grant.ownerUserId,
        fileCount: clients.length,
        bytes: BigInt(bytes),
      },
    });
    return { fileName: 'clients.csv', content: csv, bytes };
  }
}
