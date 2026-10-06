import { Inject, Injectable, HttpException } from '@nestjs/common';
import { Prisma, type Database } from '@firmivra/db';
import type { FirmNotification } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { currentActor, type FirmActor } from '../firm-common/actor.js';
import { requireTables } from '../firm-common/schema.js';
import { NotificationTargets } from './notification.ports.js';

/** Record identifiers are useful only while the recipient can still open that record. */
@Injectable()
export class ScopedNotificationTargets extends NotificationTargets {
  constructor(@Inject(DATABASE) private readonly db: Database) {
    super();
  }
  async visible(ctx: FirmActor, target: NonNullable<FirmNotification['target']>) {
    // Document, invoice and engagement owners must provide their own authorization adapter.
    if (!['appointment', 'externalLink'].includes(target.entityType)) return false;
    try {
      return await this.db.withScope(
        { kind: 'business', businessId: ctx.businessId },
        async (tx) => {
          const business = await tx.business.findFirst({
            where: { id: ctx.businessId, status: 'ACTIVE' },
          });
          if (!business) return false;
          const actor = await currentActor(tx, ctx);
          if (target.entityType === 'appointment') {
            const settings = await tx.businessSettings.findUnique({
              where: { businessId: ctx.businessId },
            });
            if (!settings?.enabledModules.includes('appointments')) return false;
            await requireTables(tx, ['appointments']);
            const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT a.id FROM appointments a JOIN clients c ON c.business_id=a.business_id AND c.id=a.client_id
            WHERE a.business_id=${ctx.businessId}::uuid AND a.id=${target.entityId}::uuid AND c.archived_at IS NULL
            ${actor.role === 'CLIENT' ? Prisma.sql`AND a.client_id=${actor.clientId}::uuid` : actor.role === 'STAFF' ? Prisma.sql`AND a.provider_membership_id=${actor.membershipId}::uuid` : Prisma.empty}`);
            return rows.length > 0;
          }
          if (actor.role === 'STAFF') return false;
          if (actor.role === 'CLIENT') {
            if (actor.accountType !== 'BUSINESS') return false;
            const client = await tx.client.findFirst({
              where: {
                id: actor.clientId,
                businessId: ctx.businessId,
                archivedAt: null,
                accountType: 'BUSINESS',
              },
            });
            if (!client) return false;
          }
          await requireTables(tx, ['external_links']);
          const [link] = await tx.$queryRaw<{ url: string }[]>(Prisma.sql`
          SELECT url FROM external_links WHERE business_id=${ctx.businessId}::uuid AND id=${target.entityId}::uuid
          ${actor.role === 'CLIENT' ? Prisma.sql`AND active=true AND audience IN ('BUSINESS','ALL')` : Prisma.empty}`);
          if (!link) return false;
          if (actor.role !== 'CLIENT') return true;
          try {
            const url = new URL(link.url);
            return (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              !url.port &&
              !url.search &&
              !url.hash &&
              [
                'irs.gov',
                'www.irs.gov',
                'sba.gov',
                'www.sba.gov',
                'fdic.gov',
                'www.fdic.gov',
                'census.gov',
                'www.census.gov',
              ].includes(url.hostname)
            );
          } catch {
            return false;
          }
        },
      );
    } catch (error) {
      if (error instanceof HttpException && [403, 404, 503].includes(error.getStatus()))
        return false;
      throw error;
    }
  }
}
