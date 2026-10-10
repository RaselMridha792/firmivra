import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, Injectable, Logger, Module } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { AdminSystemStatus, ServiceHealth } from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { PortalInfoModule, PortalInfoService } from '../client-auth/portal-info.controller.js';
import { PlatformPrisma } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import type { EmailSendLog } from '../notify/email-sends.js';
import { EMAIL_SENDS, NOTIFY_CONFIG } from '../notify/notify.module.js';
import { loadDocumentsConfig } from '../storage/config.js';
import { createS3Client } from '../storage/document-storage.js';

/** How long one answer is reused: the dashboard may reload often, the checks touch S3. */
export const STATUS_CACHE_MS = 60_000;
/** At most this many firms' portals per check (newest first). */
export const PORTALS_CHECKED = 25;

/** Writes, reads back and deletes a tiny object; throws when any step fails. */
export interface StorageProbe {
  check(): Promise<void>;
}
/** Nest token for the StorageProbe (tests replace it). */
export const STORAGE_PROBE = Symbol('STORAGE_PROBE');

/**
 * The documents bucket, at `tenant/_health/{uuid}`: inside the `tenant/*` the API's IAM policy
 * allows, and no firm's prefix (those are uuids). The object takes the bucket's SSE-KMS like any
 * document, so the check also covers the key.
 */
export class S3StorageProbe implements StorageProbe {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async check(): Promise<void> {
    const Key = `tenant/_health/${randomUUID()}`;
    const body = 'ok';
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key, Body: body, ContentType: 'text/plain' }),
    );
    try {
      const read = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key }));
      if ((await read.Body?.transformToString()) !== body) throw new Error('Read back differs');
    } finally {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }));
    }
  }
}

/** Every portal answered: online; some did: degraded; none did: offline. */
export function portalsHealth(results: PromiseSettledResult<unknown>[]): ServiceHealth | null {
  if (results.length === 0) return null;
  const answered = results.filter((r) => r.status === 'fulfilled').length;
  if (answered === results.length) return 'online';
  return answered === 0 ? 'offline' : 'degraded';
}

/**
 * The System Status card's storage, email and portal rows (R25). Platform and Database come from
 * the public /health, which stays as it is so it never shows internals.
 */
@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger('SystemStatus');
  private cached: { at: number; value: Promise<AdminSystemStatus> } | null = null;

  constructor(
    @Inject(STORAGE_PROBE) private readonly storage: StorageProbe,
    @Inject(NOTIFY_CONFIG) private readonly notifyConfig: NotifyConfig,
    @Inject(EMAIL_SENDS) private readonly sends: EmailSendLog,
    private readonly platform: PlatformPrisma,
    private readonly portal: PortalInfoService,
  ) {}

  /** The last answer while it is under a minute old; callers in the meantime share one check. */
  status(now = Date.now()): Promise<AdminSystemStatus> {
    if (this.cached && now - this.cached.at < STATUS_CACHE_MS) return this.cached.value;
    const value = this.check();
    this.cached = { at: now, value };
    return value;
  }

  private async check(): Promise<AdminSystemStatus> {
    const [storage, portals] = await Promise.all([this.storageHealth(), this.portalsHealth()]);
    return { storage, email: this.emailHealth(), portals, checkedAt: new Date().toISOString() };
  }

  private async storageHealth(): Promise<ServiceHealth> {
    try {
      await this.storage.check();
      return 'online';
    } catch (error) {
      // The error's name only: an S3 message can carry the bucket and key.
      this.logger.warn(`Storage check failed (${error instanceof Error ? error.name : 'Error'})`);
      return 'offline';
    }
  }

  /** EMAIL_MODE=log sends nothing, so email is not working there. */
  private emailHealth(): ServiceHealth {
    return this.notifyConfig.email.mode === 'log' ? 'degraded' : this.sends.status();
  }

  /**
   * Each active firm's portal address resolved the way a visitor's portal resolves it (its first
   * read, platform scope only). The rest of that read is the firm's own settings, which the admin
   * site never opens (test/isolation/admin-scope).
   */
  private async portalsHealth(): Promise<ServiceHealth | null> {
    try {
      const firms = await this.platform.db.business.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true },
        orderBy: { createdAt: 'desc' },
        take: PORTALS_CHECKED,
      });
      return portalsHealth(
        await Promise.allSettled(firms.map((firm) => this.portal.activeFirm(firm.slug))),
      );
    } catch {
      // No list of firms means no portal can load either.
      return 'offline';
    }
  }
}

/** GET /api/v1/admin/system-status: Super Admins only. */
@Controller('admin/system-status')
export class SystemStatusController {
  constructor(private readonly system: SystemStatusService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  get(): Promise<AdminSystemStatus> {
    return this.system.status();
  }
}

@Module({
  imports: [PortalInfoModule],
  controllers: [SystemStatusController],
  providers: [
    {
      provide: STORAGE_PROBE,
      useFactory: () => {
        const config = loadDocumentsConfig();
        return new S3StorageProbe(createS3Client(config), config.bucket);
      },
    },
    SystemStatusService,
  ],
})
export class SystemStatusModule {}
