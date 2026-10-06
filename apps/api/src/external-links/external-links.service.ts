import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import {
  FirmExternalLink,
  FirmPortalExternalLink,
  ListFirmExternalLinksResponse,
  ListPortalExternalLinksResponse,
  type FirmExternalLinkInput,
  type FirmExternalLinkPatch,
} from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { firmContext, missing } from '../firm-common/context.js';
import { currentActor, denied, type FirmActor } from '../firm-common/actor.js';
import { requireTables } from '../firm-common/schema.js';
import { SqlRecords } from '../firm-common/sql-records.js';
import { ExternalLinkIcons } from './external-links.ports.js';
import { approvedDirectory } from './directory.js';
const hosts = new Set([
  'irs.gov',
  'www.irs.gov',
  'sba.gov',
  'www.sba.gov',
  'fdic.gov',
  'www.fdic.gov',
  'census.gov',
  'www.census.gov',
]);
const directoryOrder = Prisma.sql`CASE section WHEN 'IRS_TAX' THEN 0 WHEN 'FUNDING_FINANCE' THEN 1 ELSE 2 END,sort_order,id`;
export function approvedResourceUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !hosts.has(url.hostname)
    )
      throw new Error('unapproved');
    return url.href;
  } catch {
    throw new BadRequestException({
      code: 'UNAPPROVED_RESOURCE_URL',
      message: 'Use an approved HTTPS government resource URL without credentials or query data',
    });
  }
}
const dto = (row: FirmExternalLink) =>
  FirmExternalLink.parse(
    Object.fromEntries(
      Object.keys(FirmExternalLink.shape).map((key) => [key, row[key as keyof FirmExternalLink]]),
    ),
  );
@Injectable()
export class ExternalLinksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly icons: ExternalLinkIcons,
  ) {}
  private async scoped<T>(
    write: boolean,
    fn: (
      tx: TxClient,
      records: SqlRecords,
      ctx: FirmActor,
      actor: Awaited<ReturnType<typeof currentActor>>,
    ) => Promise<T>,
  ) {
    const ctx = firmContext();
    return this.db.withScope({ kind: 'business', businessId: ctx.businessId }, async (tx) => {
      if (write) {
        const firms = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM businesses WHERE id=${ctx.businessId}::uuid AND status='ACTIVE' FOR UPDATE`;
        if (!firms.length) throw missing();
      }
      const actor = await currentActor(tx, ctx);
      if (actor.role !== 'CLIENT' && actor.role !== 'OWNER' && actor.role !== 'ADMIN')
        throw denied();
      if (write && actor.role === 'CLIENT') throw denied();
      await requireTables(tx, ['external_links']);
      return fn(tx, new SqlRecords(tx, ctx.businessId), ctx, actor);
    });
  }
  async list() {
    const rows = await this.scoped(false, (_, records) =>
      records.many<FirmExternalLink>('external_links', Prisma.empty, directoryOrder, 201),
    );
    if (rows.length > 200)
      throw new ConflictException({
        code: 'CONFIGURATION_LIMIT',
        message: 'Resource directory exceeds its configured limit',
      });
    await this.audit.log('external_link.listed', { type: 'externalLink' });
    return ListFirmExternalLinksResponse.parse({ items: rows.map(dto) });
  }
  async create(body: FirmExternalLinkInput) {
    const url = approvedResourceUrl(body.url);
    const row = await this.scoped(true, async (_, records, ctx) => {
      if ((await records.many('external_links', Prisma.empty, Prisma.sql`id`, 201)).length >= 200)
        throw new ConflictException({
          code: 'CONFIGURATION_LIMIT',
          message: 'At most 200 resources',
        });
      if (body.iconKey) await this.icons.verify(ctx.businessId, body.iconKey, null);
      return records.insert<FirmExternalLink>('external_links', {
        ...body,
        url,
        title: body.title.trim(),
        description: body.description.trim(),
        source: body.source.trim(),
      });
    });
    await this.audit.log('external_link.created', { type: 'externalLink', id: row.id });
    return dto(row);
  }
  async update(id: string, body: FirmExternalLinkPatch) {
    const row = await this.scoped(true, async (_, records, ctx) => {
      const current = await records.one<FirmExternalLink>('external_links', id);
      const updates = {
        ...body,
        ...(body.url ? { url: approvedResourceUrl(body.url) } : {}),
        updatedAt: new Date().toISOString(),
      };
      if (body.iconKey) await this.icons.verify(ctx.businessId, body.iconKey, current.iconKey);
      return records.patch<FirmExternalLink>('external_links', id, updates);
    });
    await this.audit.log(
      'external_link.updated',
      { type: 'externalLink', id },
      { count: Object.keys(body).length },
    );
    return dto(row);
  }
  async portal() {
    const rows = await this.scoped(false, async (tx, records, ctx, actor) => {
      if (actor.role !== 'CLIENT') throw denied();
      const client = await tx.client.findFirst({
        where: { businessId: ctx.businessId, id: actor.clientId, archivedAt: null },
        select: { accountType: true },
      });
      if (!client) throw missing();
      if (actor.accountType !== 'BUSINESS' || client.accountType !== 'BUSINESS')
        throw new ForbiddenException({
          code: 'ACCOUNT_TYPE_FORBIDDEN',
          message: 'Business resources require a business account',
        });
      return records.many<FirmExternalLink>(
        'external_links',
        Prisma.sql`AND active=true AND audience IN ('BUSINESS','ALL')`,
        directoryOrder,
        201,
      );
    });
    if (rows.length > 200)
      throw new ConflictException({
        code: 'CONFIGURATION_LIMIT',
        message: 'Resource directory exceeds its configured limit',
      });
    const ctx = firmContext(),
      items = [];
    for (const row of rows) {
      try {
        approvedResourceUrl(row.url);
      } catch {
        continue;
      }
      items.push(
        FirmPortalExternalLink.parse({
          id: row.id,
          section: row.section,
          title: row.title,
          description: row.description,
          url: row.url,
          source: row.source,
          sortOrder: row.sortOrder,
          iconUrl: row.iconKey ? await this.icons.resolve(ctx.businessId, row.iconKey) : null,
        }),
      );
    }
    await this.audit.log('external_link.portal_listed', { type: 'externalLink' });
    return ListPortalExternalLinksResponse.parse({ items });
  }
  /** Internal setup/activation hook: initialise an empty directory once, preserving all existing edits. */
  async initializeDirectory() {
    const count = await this.scoped(true, async (_, records) => {
      if ((await records.many('external_links', Prisma.empty, Prisma.sql`id`, 1)).length) return 0;
      for (const body of approvedDirectory) await records.insert('external_links', body);
      return approvedDirectory.length;
    });
    await this.audit.log(
      'external_link.directory_initialized',
      { type: 'externalLink' },
      { count },
    );
    return { count };
  }
}
