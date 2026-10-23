import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  beginOnlinePageUrl,
  type IntakeFormDetail,
  type IntakeFormLibrarySummary,
  type IntakeFormList,
  type IntakeFormListItem,
  type FormCategory,
  INTAKE_FORMS,
  IntakeFormKey,
  publicEmbedCode,
  type PublicLink,
  type PublicLinkState,
} from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import type { FormsQ } from './workspace-input.js';
import { categoryOf, formMetaOf, iso, questionCount, sectionsOf } from './workspace.common.js';

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
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
      description: formMetaOf((live ?? newest)?.definition).description,
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

  /**
   * Every live service of one of the six Begin Online kinds has its form in the library
   * (Octavia's review of Oct 20, I1): a service that never had a template gets the built-in form
   * as its published version 1, made by Firmivra, as Begin Online's first start does. The database
   * trigger (`intake_forms_template`) makes the service's default template under a per-service
   * lock, and a parallel request inserts nothing (a version is unique per template). A service
   * whose templates were archived keeps them archived.
   */
  private async ensureBuiltIns(tenant: TenantContext): Promise<void> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const services = await tx.service.findMany({
        where: {
          businessId,
          archivedAt: null,
          kind: { in: IntakeFormKey.options },
          intakeTemplates: { none: {} },
        },
        select: { id: true, kind: true },
      });
      const data = services.flatMap((service) => {
        const builtIn = INTAKE_FORMS[service.kind as IntakeFormKey];
        if (!builtIn) return [];
        const definition = { ...builtIn, version: 1 };
        return [
          {
            businessId,
            serviceId: service.id,
            version: 1,
            title: definition.title,
            definition: definition as unknown as Prisma.InputJsonValue,
            status: 'PUBLISHED' as const,
            publishedAt: new Date(),
          },
        ];
      });
      if (data.length) await tx.intakeForm.createMany({ data, skipDuplicates: true });
    });
  }

  async list(tenant: TenantContext, q: Out<typeof FormsQ>): Promise<IntakeFormList> {
    await this.ensureBuiltIns(tenant);
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
      // The builder edits the newest version: a draft over a published one shows the draft.
      const shown = t.forms[0];
      const definition = shown?.definition;
      const meta = formMetaOf(definition);
      const saved = meta.settings;
      const flag = (key: string, fallback: boolean) =>
        typeof saved[key] === 'boolean' ? (saved[key] as boolean) : fallback;
      const hasUpload = JSON.stringify(definition ?? {}).includes('"type":"upload"');
      return {
        ...item,
        name: shown?.title ?? item.name,
        status: shown?.status ?? item.status,
        description: meta.description,
        internalNotes: t.internalNotes,
        sections: sectionsOf(definition),
        settings: {
          requireAllQuestions: flag('requireAllQuestions', false),
          allowFileUploads: flag('allowFileUploads', hasUpload),
          requireSignature: flag('requireSignature', settings?.requireSignature ?? true),
          showProgressBar: flag('showProgressBar', settings?.showProgressBar ?? true),
          expiresAfterDays:
            saved['expiresAfterDays'] === null || typeof saved['expiresAfterDays'] === 'number'
              ? (saved['expiresAfterDays'] as number | null)
              : (settings?.defaultExpiryDays ?? 14),
          successMessage:
            typeof saved['successMessage'] === 'string' || saved['successMessage'] === null
              ? (saved['successMessage'] as string | null)
              : (settings?.thankYouMessage ?? null),
        },
        version: shown?.version ?? 1,
        publishedAt: iso(shown?.publishedAt),
      };
    });
  }

  /**
   * A main form's public link (Octavia's I3; Rasel, Oct 22): its service's Begin Online page and
   * the embed code of it. Only a service's default template of the six kinds has one, and only
   * while its kind's page is its own (one Begin Online service per kind); anything else is 404.
   */
  async publicLink(tenant: TenantContext, id: string): Promise<PublicLink> {
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      const t = await tx.intakeTemplate.findFirst({
        where: { businessId, id, serviceDefault: true, archivedAt: null },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              kind: true,
              status: true,
              beginOnline: true,
              archivedAt: true,
            },
          },
          forms: { select: { title: true, status: true }, orderBy: { version: 'desc' } },
        },
      });
      const kind = IntakeFormKey.safeParse(t?.service.kind);
      if (!t || !kind.success) throw notFound();
      const pageOwner = await tx.service.findFirst({
        where: { businessId, kind: kind.data, beginOnline: true, archivedAt: null },
        select: { id: true },
      });
      if (pageOwner && pageOwner.id !== t.service.id) throw notFound();
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      const live = t.forms.find((f) => f.status === 'PUBLISHED');
      const url = beginOnlinePageUrl(this.env.PORTAL_BASE_URL, firm.slug, kind.data);
      const title = (live ?? t.forms[0])?.title ?? t.service.name;
      return {
        kind: 'INTAKE_FORM',
        itemId: t.id,
        url,
        embedCode: publicEmbedCode(url, title),
        state: linkState(t.service, live !== undefined),
      };
    });
  }
}

/** The main form's link state: the first that applies, in the contract's order. */
function linkState(
  service: { status: string; beginOnline: boolean; archivedAt: Date | null },
  published: boolean,
): PublicLinkState {
  if (service.archivedAt) return 'ARCHIVED';
  if (!published) return 'DRAFT';
  if (service.status !== 'ACTIVE') return 'INACTIVE';
  if (!service.beginOnline) return 'HIDDEN';
  return 'LIVE';
}
