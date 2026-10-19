import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { RequestTemplate } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { notFound } from '../storage/document-records.js';
import { isUniqueViolation } from '../workspaces/common.js';
import { conflict, requireCapability } from './library.common.js';
import type { CreateTemplateBody, TemplatesQ, UpdateTemplateBody } from './library.input.js';

type Out<S extends z.ZodType> = z.output<S>;

const templateSelect = {
  id: true,
  name: true,
  description: true,
  ownerUserId: true,
  updatedAt: true,
  items: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      required: true,
      category: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.DocumentRequestTemplateSelect;
type TemplateRow = Prisma.DocumentRequestTemplateGetPayload<{ select: typeof templateSelect }>;

const duplicate = () => conflict('DUPLICATE_NAME', 'A template with this name already exists');

/**
 * Request types (the firm's, MANAGE to change) and "My saved lists" (each member's own) for
 * Create Document Request (R55). A template's items are replaced as a whole; templates are
 * archived, never deleted. Another member's saved list is 404.
 */
@Injectable()
export class DocumentTemplatesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private toTemplate(t: TemplateRow): RequestTemplate {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      owner: t.ownerUserId ? 'MINE' : 'FIRM',
      items: t.items,
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof TemplatesQ>,
  ): Promise<RequestTemplate[]> {
    const owner: Prisma.DocumentRequestTemplateWhereInput =
      q.owner === 'FIRM'
        ? { ownerUserId: null }
        : q.owner === 'MINE'
          ? { ownerUserId: userId }
          : { OR: [{ ownerUserId: null }, { ownerUserId: userId }] };
    const rows = await this.inFirm(tenant, (tx) =>
      tx.documentRequestTemplate.findMany({
        where: {
          AND: [
            { businessId: tenant.businessId, archivedAt: null },
            owner,
            q.search ? { name: { contains: likeEscape(q.search), mode: 'insensitive' } } : {},
          ],
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        take: 500,
        select: templateSelect,
      }),
    );
    return rows.map((r) => this.toTemplate(r));
  }

  /** The template as the member may change it: a firm type (MANAGE) or their own list. */
  private async editable(tx: TxClient, tenant: TenantContext, userId: string, id: string) {
    await tx.$executeRaw`SELECT 1 FROM document_request_templates WHERE business_id = ${tenant.businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const t = await tx.documentRequestTemplate.findFirst({
      where: {
        businessId: tenant.businessId,
        id,
        archivedAt: null,
        OR: [{ ownerUserId: null }, { ownerUserId: userId }],
      },
      select: { id: true, ownerUserId: true },
    });
    if (!t) throw notFound();
    if (t.ownerUserId === null) await requireCapability(this.grants, tenant, 'MANAGE');
    return t;
  }

  private async categoriesLive(
    tx: TxClient,
    businessId: string,
    ids: (string | null | undefined)[],
  ) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return;
    const found = await tx.documentCategory.count({
      where: { businessId, id: { in: wanted }, archivedAt: null },
    });
    if (found !== wanted.length) throw notFound();
  }

  private async writeItems(
    tx: TxClient,
    businessId: string,
    templateId: string,
    items: Out<typeof CreateTemplateBody>['items'],
  ) {
    await tx.documentRequestTemplateItem.deleteMany({ where: { businessId, templateId } });
    for (const [n, i] of items.entries()) {
      await tx.documentRequestTemplateItem.create({
        data: {
          businessId,
          templateId,
          title: i.title,
          description: i.description ?? null,
          required: i.required,
          categoryId: i.categoryId ?? null,
          sortOrder: n,
        },
      });
    }
  }

  async create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateTemplateBody>,
  ): Promise<RequestTemplate> {
    const businessId = tenant.businessId;
    if (body.owner === 'FIRM') await requireCapability(this.grants, tenant, 'MANAGE');
    return this.inFirm(tenant, async (tx) => {
      await this.categoriesLive(
        tx,
        businessId,
        body.items.map((i) => i.categoryId),
      );
      const t = await tx.documentRequestTemplate
        .create({
          data: {
            businessId,
            name: body.name,
            description: body.description ?? null,
            ownerUserId: body.owner === 'MINE' ? userId : null,
          },
          select: { id: true },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      await this.writeItems(tx, businessId, t.id, body.items);
      await this.audit.logIn(
        tx,
        'document_request_template.created',
        { type: 'document_request_template', id: t.id },
        { owner: body.owner, items: body.items.length },
        { businessId },
      );
      return this.toTemplate(
        await tx.documentRequestTemplate.findUniqueOrThrow({
          where: { id: t.id },
          select: templateSelect,
        }),
      );
    });
  }

  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateTemplateBody>,
  ): Promise<RequestTemplate> {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.inFirm(tenant, async (tx) => {
      await this.editable(tx, tenant, userId, id);
      if (body.items)
        await this.categoriesLive(
          tx,
          businessId,
          body.items.map((i) => i.categoryId),
        );
      await tx.documentRequestTemplate
        .update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
          },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      if (body.items) await this.writeItems(tx, businessId, id, body.items);
      await this.audit.logIn(
        tx,
        'document_request_template.updated',
        { type: 'document_request_template', id },
        { fields: fields.sort() },
        { businessId },
      );
      return this.toTemplate(
        await tx.documentRequestTemplate.findUniqueOrThrow({
          where: { id },
          select: templateSelect,
        }),
      );
    });
  }

  async archive(tenant: TenantContext, userId: string, id: string): Promise<{ ok: true }> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      await this.editable(tx, tenant, userId, id);
      await tx.documentRequestTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.logIn(
        tx,
        'document_request_template.archived',
        { type: 'document_request_template', id },
        {},
        { businessId },
      );
    });
    return { ok: true };
  }
}
