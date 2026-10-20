import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import type {
  AdminCommTemplate,
  AdminCommTemplateCategory,
  AdminCommTemplateCategoryList,
  AdminCommTemplatePreview,
  AdminCommTestSent,
  CreateAdminCommTemplateCategoryRequest,
  CreateAdminCommTemplateRequest,
  ListAdminCommTemplatesQuery,
  ListAdminCommTemplatesResponse,
  PreviewAdminCommTemplateRequest,
  TestAdminCommTemplateRequest,
  UpdateAdminCommTemplateCategoryRequest,
  UpdateAdminCommTemplateRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { isUniqueViolation } from '../appointments/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { commFailure } from './comm-inbox.service.js';
import { contactValues, fillMergeFields, mergeFieldsIn, sampleValues } from './comm.rules.js';

const include = { category: { select: { id: true, name: true } } } as const;
type Row = Prisma.CommTemplateGetPayload<{ include: typeof include }>;

/** A unique name refused by the database becomes 409 DUPLICATE_NAME. */
async function named<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (isUniqueViolation(e)) throw commFailure('DUPLICATE_NAME');
    throw e;
  }
}

/**
 * Super Admin Communications templates and their categories (R0 stage B6). Templates are archived,
 * never deleted; categories are deactivated, never deleted; the six shipped categories keep their
 * names. The database stamps who created and last changed a template.
 */
@Injectable()
export class CommTemplatesService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
  ) {}

  async list(
    q: z.output<typeof ListAdminCommTemplatesQuery>,
  ): Promise<ListAdminCommTemplatesResponse> {
    const term = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined;
    const where: Prisma.CommTemplateWhereInput = {
      status: q.status ?? { not: 'ARCHIVED' },
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(term ? { OR: [{ name: term }, { subject: term }] } : {}),
    };
    return this.admin.transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.commTemplate.findMany({
          where,
          include,
          orderBy: q.sort === 'NAME' ? [{ name: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.commTemplate.count({ where }),
      ]);
      return { items: await this.shape(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(id: string): Promise<AdminCommTemplate> {
    return this.admin.transaction(async (tx) => this.one(tx, id));
  }

  async create(b: z.output<typeof CreateAdminCommTemplateRequest>): Promise<AdminCommTemplate> {
    return named(() =>
      this.admin.transaction(async (tx) => {
        await this.activeCategory(tx, b.categoryId);
        const row = await tx.commTemplate.create({
          data: {
            categoryId: b.categoryId,
            name: b.name,
            channel: b.channel,
            status: b.status,
            subject: b.channel === 'EMAIL' ? (b.subject ?? null) : null,
            body: b.body,
            mergeFields: mergeFieldsIn(b.subject, b.body),
          },
        });
        await this.audit.logIn(tx, 'comm_template.created', { type: 'comm_template', id: row.id });
        return this.one(tx, row.id);
      }),
    );
  }

  async update(
    id: string,
    b: z.output<typeof UpdateAdminCommTemplateRequest>,
  ): Promise<AdminCommTemplate> {
    return named(() =>
      this.admin.transaction(async (tx) => {
        const t = await tx.commTemplate.findUnique({ where: { id } });
        if (!t || t.status === 'ARCHIVED') throw commFailure('NOT_FOUND');
        if (b.categoryId && b.categoryId !== t.categoryId)
          await this.activeCategory(tx, b.categoryId);
        const subject =
          t.channel === 'EMAIL' ? (b.subject === undefined ? t.subject : b.subject) : null;
        if (t.channel === 'EMAIL' && !subject)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'An email template needs a subject',
          });
        const body = b.body ?? t.body;
        await tx.commTemplate.update({
          where: { id },
          data: {
            ...(b.categoryId ? { categoryId: b.categoryId } : {}),
            ...(b.name ? { name: b.name } : {}),
            ...(b.status ? { status: b.status } : {}),
            subject,
            body,
            mergeFields: mergeFieldsIn(subject, body),
          },
        });
        await this.audit.logIn(tx, 'comm_template.updated', { type: 'comm_template', id });
        return this.one(tx, id);
      }),
    );
  }

  /** A copy named "<name> (copy)" (then "(copy 2)"...), inactive, in the same category. */
  async duplicate(id: string): Promise<AdminCommTemplate> {
    return this.admin.transaction(async (tx) => {
      const t = await tx.commTemplate.findUnique({ where: { id } });
      if (!t) throw commFailure('NOT_FOUND');
      const taken = new Set(
        (
          await tx.commTemplate.findMany({
            where: { name: { startsWith: `${t.name.slice(0, 100)} (copy` } },
            select: { name: true },
          })
        ).map((x) => x.name),
      );
      const base = `${t.name.slice(0, 100)} (copy`;
      let name = `${base})`;
      for (let n = 2; taken.has(name); n += 1) name = `${base} ${n})`;
      const copy = await tx.commTemplate.create({
        data: {
          categoryId: t.categoryId,
          name,
          channel: t.channel,
          status: 'INACTIVE',
          subject: t.subject,
          body: t.body,
          mergeFields: t.mergeFields,
        },
      });
      await this.audit.logIn(
        tx,
        'comm_template.duplicated',
        { type: 'comm_template', id: copy.id },
        { from: id },
      );
      return this.one(tx, copy.id);
    });
  }

  async archive(id: string): Promise<AdminCommTemplate> {
    return this.admin.transaction(async (tx) => {
      const t = await tx.commTemplate.findUnique({ where: { id } });
      if (!t) throw commFailure('NOT_FOUND');
      if (t.status !== 'ARCHIVED') {
        await tx.commTemplate.update({ where: { id }, data: { status: 'ARCHIVED' } });
        await this.audit.logIn(tx, 'comm_template.archived', { type: 'comm_template', id });
      }
      return this.one(tx, id);
    });
  }

  async preview(
    id: string,
    b: z.output<typeof PreviewAdminCommTemplateRequest>,
  ): Promise<AdminCommTemplatePreview> {
    const me = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const t = await tx.commTemplate.findUnique({ where: { id } });
      if (!t) throw commFailure('NOT_FOUND');
      let values: Partial<Record<string, string | null>> = sampleValues();
      if (b.contact) {
        const contact = await this.contactFor(tx, b.contact);
        if (!contact) throw commFailure('NOT_FOUND');
        const sender = await tx.user.findUnique({ where: { id: me }, select: { name: true } });
        values = contactValues({ ...contact, senderName: sender?.name ?? 'Firmivra' });
      }
      const subject = t.subject ? fillMergeFields(t.subject, values) : null;
      const body = fillMergeFields(t.body, values);
      return {
        subject: subject?.text ?? null,
        body: body.text,
        missing: [...new Set([...(subject?.missing ?? []), ...body.missing])],
      };
    });
  }

  /** Sends the template, filled with samples, to the member's own email or to `phone`. */
  async test(
    id: string,
    b: z.output<typeof TestAdminCommTemplateRequest>,
  ): Promise<AdminCommTestSent> {
    const me = this.admin.adminUserId;
    const { t, email } = await this.admin.transaction(async (tx) => {
      const t = await tx.commTemplate.findUnique({ where: { id } });
      if (!t) throw commFailure('NOT_FOUND');
      const user = await tx.user.findUnique({ where: { id: me }, select: { email: true } });
      return { t, email: user?.email ?? null };
    });
    const values = sampleValues();
    const body = fillMergeFields(t.body, values).text;
    let to: string;
    if (t.channel === 'SMS') {
      if (!b.phone)
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Enter a phone number',
        });
      to = b.phone;
      await this.notify.send({
        template: 'platform.message-sms',
        to,
        businessId: null,
        data: { body },
      });
    } else {
      if (!email) throw commFailure('NO_DESTINATION');
      to = email;
      await this.notify.send({
        template: 'platform.message-email',
        to,
        businessId: null,
        data: {
          name: values['contact.name'],
          subject: `[Test] ${fillMergeFields(t.subject ?? '', values).text}`,
          body,
        },
      });
    }
    // A test is not a send: no message row, only the audit trail (B6).
    await this.audit.log(
      'comm_template.test_sent',
      { type: 'comm_template', id },
      { channel: t.channel, test: true },
    );
    return { sentTo: to };
  }

  // ---------- Categories ----------

  async categories(): Promise<AdminCommTemplateCategoryList> {
    return this.admin.transaction(async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.commTemplateCategory.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
        tx.commTemplate.groupBy({
          by: ['categoryId'],
          where: { status: { not: 'ARCHIVED' } },
          _count: { _all: true },
        }),
      ]);
      const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
      return { items: rows.map((r) => this.category(r, n.get(r.id) ?? 0)) };
    });
  }

  async createCategory(
    b: z.output<typeof CreateAdminCommTemplateCategoryRequest>,
  ): Promise<AdminCommTemplateCategory> {
    return named(() =>
      this.admin.transaction(async (tx) => {
        const last = await tx.commTemplateCategory.aggregate({ _max: { position: true } });
        const row = await tx.commTemplateCategory.create({
          data: { name: b.name, position: (last._max.position ?? -1) + 1 },
        });
        await this.audit.logIn(tx, 'comm_template_category.created', {
          type: 'comm_template_category',
          id: row.id,
        });
        return this.category(row, 0);
      }),
    );
  }

  async updateCategory(
    id: string,
    b: z.output<typeof UpdateAdminCommTemplateCategoryRequest>,
  ): Promise<AdminCommTemplateCategory> {
    return named(() =>
      this.admin.transaction(async (tx) => {
        const c = await tx.commTemplateCategory.findUnique({ where: { id } });
        if (!c) throw commFailure('NOT_FOUND');
        if (b.name && b.name !== c.name && c.systemKey) throw commFailure('SYSTEM_CATEGORY');
        const row = await tx.commTemplateCategory.update({ where: { id }, data: b });
        await this.audit.logIn(tx, 'comm_template_category.updated', {
          type: 'comm_template_category',
          id,
        });
        const count = await tx.commTemplate.count({
          where: { categoryId: id, status: { not: 'ARCHIVED' } },
        });
        return this.category(row, count);
      }),
    );
  }

  // ---------- Helpers ----------

  private category(
    r: { id: string; name: string; systemKey: string | null; position: number; isActive: boolean },
    templateCount: number,
  ): AdminCommTemplateCategory {
    return {
      id: r.id,
      name: r.name,
      systemKey: r.systemKey,
      position: r.position,
      isActive: r.isActive,
      templateCount,
    };
  }

  private async activeCategory(tx: TxClient, id: string) {
    const c = await tx.commTemplateCategory.findUnique({
      where: { id },
      select: { isActive: true },
    });
    if (!c) throw commFailure('NOT_FOUND');
    if (!c.isActive) throw commFailure('CATEGORY_INACTIVE');
  }

  private async contactFor(
    tx: TxClient,
    ref: NonNullable<z.output<typeof PreviewAdminCommTemplateRequest>['contact']>,
  ): Promise<{ name: string; email: string | null; firmName: string | null } | null> {
    if (ref.type === 'FIRM') {
      const o = await tx.membership.findFirst({
        where: { businessId: ref.businessId, role: 'OWNER', status: 'ACTIVE' },
        select: {
          business: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
      });
      return o ? { name: o.user.name, email: o.user.email, firmName: o.business.name } : null;
    }
    if (ref.type === 'LEAD') {
      const l = await tx.salesContact.findUnique({ where: { id: ref.salesContactId } });
      return l ? { name: l.name, email: l.email, firmName: l.companyName } : null;
    }
    const t = await tx.platformAdmin.findUnique({
      where: { userId: ref.userId },
      select: { user: { select: { name: true, email: true } } },
    });
    return t ? { name: t.user.name, email: t.user.email, firmName: null } : null;
  }

  private async one(tx: TxClient, id: string): Promise<AdminCommTemplate> {
    const row = await tx.commTemplate.findUnique({ where: { id }, include });
    if (!row) throw commFailure('NOT_FOUND');
    const [shaped] = await this.shape(tx, [row]);
    return shaped!;
  }

  private async shape(tx: TxClient, rows: Row[]): Promise<AdminCommTemplate[]> {
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.createdByUserId, r.updatedByUserId]).filter((x): x is string => !!x),
      ),
    ];
    const names = new Map(
      ids.length
        ? (
            await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
          ).map((u) => [u.id, u.name])
        : [],
    );
    const ref = (userId: string | null) =>
      userId ? { userId, name: names.get(userId) ?? 'Firmivra team' } : null;
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      name: r.name,
      channel: r.channel === 'SMS' ? 'SMS' : 'EMAIL',
      status: r.status,
      subject: r.subject,
      body: r.body,
      mergeFields: r.mergeFields,
      createdBy: ref(r.createdByUserId),
      updatedBy: ref(r.updatedByUserId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
