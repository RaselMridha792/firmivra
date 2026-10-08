import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type ContentItem,
  type ContentKind,
  type ContentQuery,
  type CreateContentRequest,
  type MyContentItem,
  type MyContentQuery,
  type UpdateContentRequest,
  contentKindProblem,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

type ListQuery = z.output<typeof ContentQuery>;
type MyListQuery = z.output<typeof MyContentQuery>;
type CreateBody = z.output<typeof CreateContentRequest>;
type UpdateBody = z.output<typeof UpdateContentRequest>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const businessOnly = () =>
  new ForbiddenException({
    code: 'BUSINESS_ONLY',
    message: 'These resources are for business clients',
  });
const kindProblem = (message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path: '', message }],
  });

/** Resources and external links belong to "Business Documents & Resources" (System Wiring G). */
const BUSINESS_KINDS: readonly ContentKind[] = ['RESOURCE', 'EXTERNAL_LINK'];
const ALL_KINDS: readonly ContentKind[] = ['RESOURCE', 'TIP', 'EXTERNAL_LINK'];

/**
 * Which kinds a client may read: every kind for a business client, tips only otherwise (no
 * client record counts as an individual). Asking for a business kind as an individual is 403
 * BUSINESS_ONLY.
 */
export function readableKinds(
  accountType: 'INDIVIDUAL' | 'BUSINESS' | null,
  kind: ContentKind | undefined,
): ContentKind[] {
  if (accountType === 'BUSINESS') return kind ? [kind] : [...ALL_KINDS];
  if (kind && BUSINESS_KINDS.includes(kind)) throw businessOnly();
  return ['TIP'];
}

const itemSelect = {
  id: true,
  kind: true,
  category: true,
  title: true,
  description: true,
  body: true,
  url: true,
  iconKey: true,
  sortOrder: true,
  publishedAt: true,
  updatedAt: true,
} satisfies Prisma.ContentItemSelect;

type ItemRow = Prisma.ContentItemGetPayload<{ select: typeof itemSelect }>;

/** By category (uncategorized last), then sortOrder; ties in creation order. */
const order: Prisma.ContentItemOrderByWithRelationInput[] = [
  { category: { sort: 'asc', nulls: 'last' } },
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

function toMyItem(row: ItemRow): MyContentItem {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    description: row.description,
    body: row.body,
    url: row.url,
    iconKey: row.iconKey,
    sortOrder: row.sortOrder,
  };
}

function toItem(row: ItemRow): ContentItem {
  return {
    ...toMyItem(row),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A category filter; an empty one is no filter. */
const categoryFilter = (category: string | undefined) => (category ? { category } : {});

/**
 * The firm's portal content (R12 step 3; contract in packages/types/src/content): resources,
 * tips and external links. Every query runs in the firm's business scope with `businessId` from
 * TenantGuard. Everyone at the firm reads; Owner and Admin change (the routes say so). Clients
 * read published items only, and only tips unless their client record is a business. Changes
 * are audited with the id, kind and field names, never the text.
 */
@Injectable()
export class ContentService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, q: ListQuery): Promise<ContentItem[]> {
    const rows = await this.database.forBusiness(businessId).contentItem.findMany({
      where: { businessId, ...(q.kind ? { kind: q.kind } : {}), ...categoryFilter(q.category) },
      orderBy: order,
      select: itemSelect,
    });
    return rows.map(toItem);
  }

  /** A draft: clients see it only after `publish`. */
  async create(businessId: string, userId: string, body: CreateBody): Promise<ContentItem> {
    const row = await this.database.forBusiness(businessId).contentItem.create({
      data: {
        businessId,
        kind: body.kind,
        category: body.category ?? null,
        title: body.title,
        description: body.description ?? null,
        body: body.body ?? null,
        url: body.url ?? null,
        iconKey: body.iconKey ?? null,
        sortOrder: body.sortOrder ?? 0,
        createdByUserId: userId,
      },
      select: itemSelect,
    });
    await this.audit.log(
      'content.created',
      { type: 'content_item', id: row.id },
      { kind: row.kind, fields: Object.keys(body).sort() },
    );
    return toItem(row);
  }

  /** Only the fields sent; the result must still fit its kind (a link keeps its URL). */
  async update(businessId: string, id: string, body: UpdateBody): Promise<ContentItem> {
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.lock(tx, businessId, id);
      const problem = contentKindProblem({ ...current, ...data });
      if (problem) throw kindProblem(problem);
      return tx.contentItem.update({ where: { id }, data, select: itemSelect });
    });
    await this.audit.log(
      'content.updated',
      { type: 'content_item', id },
      { kind: row.kind, fields: Object.keys(data).sort() },
    );
    return toItem(row);
  }

  async publish(businessId: string, id: string): Promise<ContentItem> {
    return this.setPublished(businessId, id, true);
  }

  async unpublish(businessId: string, id: string): Promise<ContentItem> {
    return this.setPublished(businessId, id, false);
  }

  /** Publishing a published item (or hiding a draft) changes nothing and writes no audit row. */
  private async setPublished(
    businessId: string,
    id: string,
    publish: boolean,
  ): Promise<ContentItem> {
    const { row, changed } = await this.inFirm(businessId, async (tx) => {
      const current = await this.lock(tx, businessId, id);
      if (!!current.publishedAt === publish) return { row: current, changed: false };
      const updated = await tx.contentItem.update({
        where: { id },
        data: { publishedAt: publish ? new Date() : null },
        select: itemSelect,
      });
      return { row: updated, changed: true };
    });
    if (changed) {
      await this.audit.log(
        publish ? 'content.published' : 'content.unpublished',
        { type: 'content_item', id },
        { kind: row.kind },
      );
    }
    return toItem(row);
  }

  async remove(businessId: string, id: string): Promise<{ ok: true }> {
    const kind = await this.inFirm(businessId, async (tx) => {
      const current = await this.lock(tx, businessId, id);
      await tx.contentItem.delete({ where: { id } });
      return current.kind;
    });
    await this.audit.log('content.deleted', { type: 'content_item', id }, { kind });
    return { ok: true };
  }

  /**
   * The signed-in client's view: published items only. The account type comes from the client
   * record at this firm (never the login's own sign-up answer); without one, an individual.
   */
  async mine(
    businessId: string,
    clientAccountId: string,
    q: MyListQuery,
  ): Promise<MyContentItem[]> {
    return this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { client: { select: { accountType: true } } },
      });
      const kinds = readableKinds(account?.client?.accountType ?? null, q.kind);
      const rows = await tx.contentItem.findMany({
        where: {
          businessId,
          publishedAt: { not: null },
          kind: { in: kinds },
          ...categoryFilter(q.category),
        },
        orderBy: order,
        select: itemSelect,
      });
      return rows.map(toMyItem);
    });
  }

  /** The item in this firm, its row locked until the transaction ends; else 404. */
  private async lock(tx: TxClient, businessId: string, id: string): Promise<ItemRow> {
    await tx.$executeRaw`SELECT 1 FROM content_items WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const row = await tx.contentItem.findFirst({ where: { businessId, id }, select: itemSelect });
    if (!row) throw notFound();
    return row;
  }
}
