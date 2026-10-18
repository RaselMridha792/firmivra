import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  IntakeFormDetail,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeFormListItem,
  FormCategory,
} from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import type { FormsQ } from './workspace-input.js';
import { categoryOf, iso, questionCount, sectionsOf } from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const templateInclude = {
  service: { select: { id: true, name: true, kind: true } },
  forms: {
    select: {
      id: true,
      version: true,
      title: true,
      status: true,
      definition: true,
      publishedAt: true,
      updatedAt: true,
      createdByUserId: true,
    },
    orderBy: { version: 'desc' },
  },
} satisfies Prisma.IntakeTemplateInclude;
type Template = Prisma.IntakeTemplateGetPayload<{ include: typeof templateInclude }>;

/** Who made the form: the template's maker, or the maker of its newest version. */
const ownerOf = (t: Template) => t.createdByUserId ?? t.forms[0]?.createdByUserId ?? null;

/**
 * The form library (Form Templates): a form is a template with its numbered versions. The row
 * shows the newest version; the usage is the intakes sent with any of its versions.
 */
@Injectable()
export class IntakeLibraryService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private async usage(tx: TxClient, businessId: string, templateIds: string[]) {
    if (!templateIds.length) return new Map<string, { count: number; last: Date | null }>();
    const rows = await tx.intake.findMany({
      where: { businessId, status: { not: 'DRAFT' }, form: { templateId: { in: templateIds } } },
      select: { createdAt: true, form: { select: { templateId: true } } },
    });
    const out = new Map<string, { count: number; last: Date | null }>();
    for (const r of rows) {
      const id = r.form.templateId as string;
      const u = out.get(id) ?? { count: 0, last: null };
      u.count++;
      if (!u.last || r.createdAt > u.last) u.last = r.createdAt;
      out.set(id, u);
    }
    return out;
  }

  private item(
    t: Template,
    usage: { count: number; last: Date | null } | undefined,
    owner: { userId: string; name: string } | null,
  ): IntakeFormListItem {
    const newest = t.forms[0];
    const live = t.forms.find((f) => f.status === 'PUBLISHED');
    return {
      id: t.id,
      name: (live ?? newest)?.title ?? t.service.name,
      category: categoryOf(t.service.kind),
      service: { id: t.service.id, name: t.service.name },
      description: null,
      isTemplate: t.serviceDefault,
      custom: (t.createdByUserId ?? newest?.createdByUserId ?? null) !== null,
      status: live ? 'PUBLISHED' : (newest?.status ?? 'DRAFT'),
      questionCount: questionCount((live ?? newest)?.definition),
      usageCount: usage?.count ?? 0,
      lastUsedAt: iso(usage?.last),
      updatedAt: (newest && newest.updatedAt > t.updatedAt
        ? newest.updatedAt
        : t.updatedAt
      ).toISOString(),
      owner,
    };
  }

  async list(tenant: TenantContext, q: Out<typeof FormsQ>): Promise<IntakeFormList> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const rows = await tx.intakeTemplate.findMany({
        where: {
          businessId,
          archivedAt: null,
          ...(q.templates === 'all' ? {} : { serviceDefault: q.templates === 'true' }),
        },
        include: templateInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 500,
      });
      const [use, names] = await Promise.all([
        this.usage(
          tx,
          businessId,
          rows.map((r) => r.id),
        ),
        memberNames(tx, businessId, rows.map(ownerOf)),
      ]);
      let items = rows.map((t) => this.item(t, use.get(t.id), memberRef(names, ownerOf(t))));
      if (q.category) items = items.filter((i) => i.category === q.category);
      if (q.status) items = items.filter((i) => i.status === q.status);
      if (q.search) {
        const s = q.search.toLowerCase();
        items = items.filter((i) => i.name.toLowerCase().includes(s));
      }
      const byName = (a: IntakeFormListItem, b: IntakeFormListItem) =>
        a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      if (q.sort === 'name') items.sort(byName);
      else if (q.sort === 'used') items.sort((a, b) => b.usageCount - a.usageCount || byName(a, b));
      else if (q.sort === 'recent')
        items.sort(
          (a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || byName(a, b),
        );
      else items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
      return { items };
    });
  }

  async summary(tenant: TenantContext): Promise<IntakeFormLibrarySummary> {
    const { items } = await this.list(tenant, { templates: 'all', sort: 'updated' });
    const since = Date.now() - 30 * 86_400_000;
    const most = Math.max(0, ...items.map((i) => i.usageCount));
    const byCategory = new Map<FormCategory, number>();
    for (const i of items) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
    return {
      total: items.length,
      mostUsed: most > 0 ? items.filter((i) => i.usageCount === most).length : 0,
      custom: items.filter((i) => i.custom).length,
      updatedLast30Days: items.filter((i) => Date.parse(i.updatedAt) >= since).length,
      byCategory: [...byCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => a.category.localeCompare(b.category)),
    };
  }

  async detail(tenant: TenantContext, id: string): Promise<IntakeFormDetail> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const t = await tx.intakeTemplate.findFirst({
        where: { businessId, id },
        include: templateInclude,
      });
      if (!t) throw notFound();
      const [use, names, settings] = await Promise.all([
        this.usage(tx, businessId, [t.id]),
        memberNames(tx, businessId, [ownerOf(t)]),
        tx.intakeSettings.findUnique({ where: { businessId } }),
      ]);
      const item = this.item(t, use.get(t.id), memberRef(names, ownerOf(t)));
      const shown = t.forms.find((f) => f.status === 'PUBLISHED') ?? t.forms[0];
      const definition = shown?.definition;
      const hasUpload = JSON.stringify(definition ?? {}).includes('"type":"upload"');
      return {
        ...item,
        description: null,
        internalNotes: t.internalNotes,
        sections: sectionsOf(definition),
        settings: {
          requireAllQuestions: false,
          allowFileUploads: hasUpload,
          requireSignature: settings?.requireSignature ?? true,
          showProgressBar: settings?.showProgressBar ?? true,
          expiresAfterDays: settings?.defaultExpiryDays ?? 14,
          successMessage: settings?.thankYouMessage ?? null,
        },
        version: shown?.version ?? 1,
        publishedAt: iso(shown?.publishedAt),
      };
    });
  }
}
