import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  MessageTemplateDetail,
  MessageTemplatePage,
  TemplatesSummary,
  TemplateVersion,
  TemplateVersionRow,
} from '@firmivra/types';
import type { z } from 'zod';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import { builtIn, fieldsIn } from './merge-fields.js';
import type { TemplatesQuery } from './template-input.js';
import {
  etagOf,
  ownerRef,
  rowInclude,
  type RowShape,
  toCategory,
  toRow,
  visibleTo,
} from './templates.common.js';

type Query = z.output<typeof TemplatesQuery>;

const detailInclude = (userId: string) =>
  ({
    ...rowInclude(userId),
    shares: { select: { userId: true } },
    attachments: { orderBy: { createdAt: 'asc' } },
  }) satisfies Prisma.MessageTemplateInclude;
type DetailShape = Prisma.MessageTemplateGetPayload<{ include: ReturnType<typeof detailInclude> }>;

/** How many ACTIVE automations (not archived) name the template in their current version's steps. */
export async function automationCount(
  tx: TxClient,
  businessId: string,
  templateId: string,
): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n
    FROM automation_rules r
    JOIN automation_rule_versions v
      ON v.business_id = r.business_id AND v.id = r.current_version_id
    WHERE r.business_id = ${businessId}::uuid
      AND r.status = 'ACTIVE' AND r.archived_at IS NULL
      AND position(${templateId} in v.actions::text) > 0`;
  return Number(row?.n ?? 0);
}

/**
 * Reads of the Templates library: the summary page, the filtered list, one template with its
 * versions. Everything is over the templates the caller may see (visibleTo): Owner and Admin all
 * of the firm's, everyone else their own, the team's and those shared with them. A template they
 * may not see is NOT_FOUND, as an unknown id.
 */
@Injectable()
export class TemplateReadService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  summary(businessId: string, actor: ClientsActor): Promise<TemplatesSummary> {
    return this.inFirm(businessId, async (tx) => {
      const live: Prisma.MessageTemplateWhereInput = {
        businessId,
        status: { not: 'ARCHIVED' },
        ...visibleTo(actor),
      };
      const [total, mine, shared, favorites, categories, byCategory, uncategorized, recent] =
        await Promise.all([
          tx.messageTemplate.count({ where: live }),
          tx.messageTemplate.count({ where: { ...live, ownerUserId: actor.userId } }),
          tx.messageTemplate.count({ where: { AND: [live, sharedWithMe(actor)] } }),
          tx.messageTemplate.count({
            where: { ...live, favorites: { some: { userId: actor.userId } } },
          }),
          tx.templateCategory.findMany({
            where: { businessId, archivedAt: null },
            orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
          }),
          tx.messageTemplate.groupBy({
            by: ['categoryId'],
            where: { ...live, categoryId: { not: null } },
            _count: { _all: true },
          }),
          tx.messageTemplate.groupBy({
            by: ['kind'],
            where: { ...live, categoryId: null },
            _count: { _all: true },
          }),
          tx.messageTemplate.findMany({
            where: live,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            take: 5,
            include: rowInclude(actor.userId),
          }),
        ]);
      const counts = new Map(byCategory.map((c) => [c.categoryId, c._count._all]));
      const names = await this.names(tx, businessId, recent);
      return {
        total,
        mine,
        shared,
        favorites,
        categories: categories.map((c) => toCategory(c, counts.get(c.id) ?? 0)),
        uncategorized: uncategorized.map((u) => ({ kind: u.kind, templateCount: u._count._all })),
        recent: recent.map((t) => toRow(t, names)),
      };
    });
  }

  list(businessId: string, actor: ClientsActor, q: Query): Promise<MessageTemplatePage> {
    return this.inFirm(businessId, async (tx) => {
      const and: Prisma.MessageTemplateWhereInput[] = [{ businessId }, visibleTo(actor)];
      if (q.tab === 'mine') and.push({ ownerUserId: actor.userId });
      if (q.tab === 'shared') and.push(sharedWithMe(actor));
      if (q.tab === 'favorites') and.push({ favorites: { some: { userId: actor.userId } } });
      and.push(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } });
      if (q.kind) and.push({ kind: q.kind });
      if (q.categoryId) and.push({ categoryId: q.categoryId });
      if (q.ownerUserId) and.push({ ownerUserId: q.ownerUserId });
      if (q.tag) and.push({ tags: { has: q.tag } });
      if (q.automations === true) and.push({ includeInAutomations: true });
      if (q.search) {
        const contains = { contains: q.search, mode: 'insensitive' as const };
        and.push({
          OR: [
            { name: contains },
            { description: contains },
            { subject: contains },
            { tags: { has: q.search } },
          ],
        });
      }
      const where: Prisma.MessageTemplateWhereInput = { AND: and };
      const dir = q.direction;
      const orderBy: Prisma.MessageTemplateOrderByWithRelationInput[] = [
        q.sort === 'name'
          ? { name: dir }
          : q.sort === 'category'
            ? { category: { name: dir } }
            : q.sort === 'uses'
              ? { uses: { _count: dir } }
              : q.sort === 'status'
                ? { status: dir }
                : { updatedAt: dir },
        { id: 'asc' },
      ];
      const [total, rows] = await Promise.all([
        tx.messageTemplate.count({ where }),
        tx.messageTemplate.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: rowInclude(actor.userId),
        }),
      ]);
      const names = await this.names(tx, businessId, rows);
      return {
        items: rows.map((t) => toRow(t, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(businessId: string, actor: ClientsActor, id: string): Promise<MessageTemplateDetail> {
    return this.inFirm(businessId, async (tx) => this.detailIn(tx, businessId, actor, id));
  }

  /** The detail of a template the actor may see, read inside `tx` (also after a write). */
  async detailIn(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<MessageTemplateDetail> {
    const t = await tx.messageTemplate.findFirst({
      where: { businessId, id, ...visibleTo(actor) },
      include: detailInclude(actor.userId),
    });
    if (!t) throw notFound();
    return this.detail(tx, businessId, t);
  }

  async detail(tx: TxClient, businessId: string, t: DetailShape): Promise<MessageTemplateDetail> {
    const names = await memberNames(tx, businessId, [
      t.ownerUserId,
      t.updatedByUserId,
      ...t.shares.map((s) => s.userId),
    ]);
    const custom = await tx.customMergeField.findMany({
      where: { businessId },
      select: { key: true },
    });
    const customKeys = new Set(custom.map((c) => c.key.toLowerCase()));
    const used = fieldsIn(t.subject, t.previewText, t.body);
    const lastUse = await tx.messageTemplateUse.aggregate({
      where: { businessId, templateId: t.id },
      _max: { usedAt: true },
    });
    return {
      ...toRow(t, names),
      previewText: t.previewText,
      body: t.body,
      sharedWith: t.shares.flatMap((s) => memberRef(names, s.userId) ?? []),
      attachments: t.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt.toISOString(),
      })),
      mergeFields: {
        used,
        unknown: used.filter((u) => !builtIn(u) && !customKeys.has(u.toLowerCase())),
      },
      automationCount: await automationCount(tx, businessId, t.id),
      lastUsedAt: lastUse._max.usedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      etag: etagOf(t),
    };
  }

  versions(businessId: string, actor: ClientsActor, id: string): Promise<TemplateVersionRow[]> {
    return this.inFirm(businessId, async (tx) => {
      await this.visible(tx, businessId, actor, id);
      const rows = await tx.messageTemplateVersion.findMany({
        where: { businessId, templateId: id },
        orderBy: { version: 'desc' },
        select: { version: true, name: true, savedByUserId: true, savedAt: true },
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.savedByUserId),
      );
      return rows.map((r) => ({
        version: r.version,
        name: r.name,
        savedBy: ownerRef(names, r.savedByUserId),
        savedAt: r.savedAt.toISOString(),
      }));
    });
  }

  version(
    businessId: string,
    actor: ClientsActor,
    id: string,
    version: number,
  ): Promise<TemplateVersion> {
    return this.inFirm(businessId, async (tx) => {
      await this.visible(tx, businessId, actor, id);
      const v = await tx.messageTemplateVersion.findFirst({
        where: { businessId, templateId: id, version },
      });
      if (!v) throw notFound();
      const names = await memberNames(tx, businessId, [v.savedByUserId]);
      return {
        version: v.version,
        name: v.name,
        savedBy: ownerRef(names, v.savedByUserId),
        savedAt: v.savedAt.toISOString(),
        subject: v.subject,
        body: v.body,
      };
    });
  }

  /** 404 unless the actor may see the template. */
  async visible(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const t = await tx.messageTemplate.findFirst({
      where: { businessId, id, ...visibleTo(actor) },
      select: { id: true },
    });
    if (!t) throw notFound();
  }

  private names(tx: TxClient, businessId: string, rows: RowShape[]) {
    return memberNames(
      tx,
      businessId,
      rows.flatMap((r) => [r.ownerUserId, r.updatedByUserId]),
    );
  }
}

/** Shared with the caller by someone else: the team's, or those that list them. */
function sharedWithMe(actor: ClientsActor): Prisma.MessageTemplateWhereInput {
  return {
    ownerUserId: { not: actor.userId },
    OR: [{ access: 'TEAM' }, { access: 'SELECTED', shares: { some: { userId: actor.userId } } }],
  };
}
