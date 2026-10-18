import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AutomationStartersResult,
  AutomationTemplateDetail,
  AutomationTemplatePage,
  AutomationTemplateRow,
  ImportAutomationTemplateRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import {
  isUniqueViolation,
  memberNames,
  memberRef,
  notFound,
  sentFields,
} from '../workspaces/common.js';
import { autoErrors } from './automations.common.js';
import { type AutoCtx, AutomationsReadService } from './automations-read.service.js';
import type {
  CreateTemplateBody,
  ImportBody,
  TemplatesQuery,
  UpdateTemplateBody,
} from './automations-input.js';
import { STARTERS } from './starters.js';
import {
  actionsSummary,
  type Def,
  defOf,
  forTemplate,
  invalidDefinition,
  stored,
  structureProblems,
  triggerSummary,
  viewOf,
} from './logic.js';

type Out<S extends z.ZodType> = z.output<S>;
type Row = Prisma.AutomationTemplateGetPayload<object>;

/** Rule templates: save, import, export, use, and the starters a firm installs. */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: AutoCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  /** The definition of a template row as a view (what a version would hold). */
  private view(ctx: AutoCtx, r: Row) {
    const def = r.definition as Def;
    const s = stored(def, ctx.settings);
    return viewOf({
      triggerModule: s.trigger.module,
      triggerEvent: s.trigger.event,
      timing: s.trigger.timing,
      offsetValue: s.trigger.offsetValue,
      offsetUnit: s.trigger.offsetUnit,
      matchMode: s.matchMode,
      conditions: s.conditions,
      actions: s.actions,
      settings: s.settings,
    });
  }

  private async connected(ctx: AutoCtx): Promise<Set<string>> {
    const rows = await ctx.tx.integrationConnection.findMany({
      where: {
        businessId: ctx.businessId,
        status: { in: ['CONNECTED', 'SYNCING'] },
      },
      select: { provider: true },
    });
    return new Set(rows.map((r) => r.provider));
  }

  private async row(ctx: AutoCtx, r: Row, connected: Set<string>): Promise<AutomationTemplateRow> {
    const view = this.view(ctx, r);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      starter: STARTERS.some((s) => s.name === r.name),
      requiredIntegrations: r.requiredIntegrations,
      integrationsMissing: r.requiredIntegrations.filter((p) => !connected.has(p)),
      triggerSummary: triggerSummary(view.trigger),
      actionsSummary: actionsSummary(view.actions),
      archived: r.archivedAt !== null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async detailOf(ctx: AutoCtx, r: Row): Promise<AutomationTemplateDetail> {
    const names = await memberNames(ctx.tx, ctx.businessId, [r.createdByUserId]);
    return {
      ...(await this.row(ctx, r, await this.connected(ctx))),
      definition: this.view(ctx, r),
      createdBy: memberRef(names, r.createdByUserId),
    };
  }

  private async load(ctx: AutoCtx, id: string): Promise<Row> {
    const r = await ctx.tx.automationTemplate.findFirst({
      where: { businessId: ctx.businessId, id },
    });
    if (!r) throw notFound();
    return r;
  }

  private async nameFree(ctx: AutoCtx, name: string, exceptId?: string) {
    const twin = await ctx.tx.automationTemplate.findFirst({
      where: {
        businessId: ctx.businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (twin) throw autoErrors.duplicateName();
  }

  private structure(def: Def) {
    const problems = structureProblems(def);
    if (problems.length > 0) throw invalidDefinition(problems);
  }

  /** Saves a template inside a transaction (a rule saved as a template, or one made directly). */
  async createIn(
    ctx: AutoCtx,
    input: {
      name: string;
      description: string | null;
      category: Row['category'];
      definition: Def;
      requiredIntegrations: string[];
      fromRuleId?: string;
    },
  ): Promise<AutomationTemplateDetail> {
    const { tx, businessId } = ctx;
    await this.nameFree(ctx, input.name);
    let row: Row;
    try {
      row = await tx.automationTemplate.create({
        data: {
          businessId,
          name: input.name,
          description: input.description,
          category: input.category,
          definition: stored(input.definition, ctx.settings) as unknown as Prisma.InputJsonObject,
          requiredIntegrations: input.requiredIntegrations,
          createdByUserId: ctx.actor.userId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw autoErrors.duplicateName();
      throw error;
    }
    await this.audit.logIn(
      tx,
      'automation_template.created',
      { type: 'automation_template', id: row.id },
      { templateId: row.id, ...(input.fromRuleId ? { ruleId: input.fromRuleId } : {}) },
    );
    return this.detailOf(ctx, row);
  }

  // ---------- Routes ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof TemplatesQuery>,
  ): Promise<AutomationTemplatePage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.AutomationTemplateWhereInput = {
        businessId,
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.category ? { category: q.category } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [total, rows, connected] = await Promise.all([
        ctx.tx.automationTemplate.count({ where }),
        ctx.tx.automationTemplate.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.connected(ctx),
      ]);
      return {
        items: await Promise.all(rows.map((r) => this.row(ctx, r, connected))),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) =>
      this.detailOf(ctx, await this.load(ctx, id)),
    );
  }

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      this.structure(body.definition);
      await this.read.requireMembers(ctx, body.definition.settings.notifyOnFailureUserIds);
      return this.createIn(ctx, {
        name: body.name,
        description: body.description ?? null,
        category: body.category,
        definition: forTemplate(body.definition),
        requiredIntegrations: body.requiredIntegrations,
      });
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const cur = await this.load(ctx, id);
      if (cur.archivedAt) throw autoErrors.invalidStatus('Restore the template before changing it');
      if (body.name !== undefined) await this.nameFree(ctx, body.name, id);
      if (body.definition) {
        this.structure(body.definition);
        await this.read.requireMembers(ctx, body.definition.settings.notifyOnFailureUserIds);
      }
      try {
        await tx.automationTemplate.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.category !== undefined ? { category: body.category } : {}),
            ...(body.definition
              ? {
                  definition: stored(
                    forTemplate(body.definition),
                    ctx.settings,
                  ) as unknown as Prisma.InputJsonObject,
                }
              : {}),
            ...(body.requiredIntegrations !== undefined
              ? { requiredIntegrations: body.requiredIntegrations }
              : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw autoErrors.duplicateName();
        throw error;
      }
      await this.audit.logIn(
        tx,
        'automation_template.updated',
        { type: 'automation_template', id },
        {
          templateId: id,
          fields: sentFields(body, [
            'name',
            'description',
            'category',
            'definition',
            'requiredIntegrations',
          ]),
        },
      );
      return this.detailOf(ctx, await this.load(ctx, id));
    });
  }

  setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const cur = await this.load(ctx, id);
      if (archive === (cur.archivedAt === null)) {
        await tx.automationTemplate.update({
          where: { id },
          data: { archivedAt: archive ? new Date() : null },
        });
        await this.audit.logIn(
          tx,
          archive ? 'automation_template.archived' : 'automation_template.restored',
          { type: 'automation_template', id },
          { templateId: id },
        );
      }
      return this.detailOf(ctx, await this.load(ctx, id));
    });
  }

  /** The template to use, if the firm has what it needs (409 TEMPLATE_UNAVAILABLE otherwise). */
  async usable(ctx: AutoCtx, id: string): Promise<{ row: Row; def: Def }> {
    const row = await this.load(ctx, id);
    if (row.archivedAt) throw autoErrors.templateUnavailable('This template is archived');
    const connected = await this.connected(ctx);
    const gone = row.requiredIntegrations.filter((p) => !connected.has(p));
    if (gone.length > 0) throw autoErrors.templateUnavailable(`Connect ${gone.join(', ')} first`);
    const def = defOf(this.view(ctx, row));
    return { row, def };
  }

  export(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<z.output<typeof ImportBody>> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const row = await this.load(ctx, id);
      const def = forTemplate(defOf(this.view(ctx, row)));
      await this.audit.logIn(
        ctx.tx,
        'automation_template.exported',
        { type: 'automation_template', id },
        { templateId: id },
      );
      return {
        format: 'firmivra.automation-template',
        schemaVersion: 1,
        template: {
          name: row.name,
          description: row.description,
          category: row.category,
          definition: def,
          requiredIntegrations: row.requiredIntegrations,
        },
      } as unknown as z.output<typeof ImportBody>;
    });
  }

  import(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof ImportBody>,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const t = body.template;
      this.structure(t.definition);
      await this.read.requireMembers(ctx, t.definition.settings.notifyOnFailureUserIds);
      return this.createIn(ctx, {
        name: t.name,
        description: t.description ?? null,
        category: t.category,
        definition: forTemplate(t.definition),
        requiredIntegrations: t.requiredIntegrations,
      });
    });
  }

  /** The popular starters, installed once each (by name). */
  installStarters(
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AutomationStartersResult> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      let installed = 0;
      for (const s of STARTERS) {
        const there = await tx.automationTemplate.findFirst({
          where: { businessId, name: s.name },
          select: { id: true },
        });
        if (there) continue;
        await tx.automationTemplate.create({
          data: {
            businessId,
            name: s.name,
            description: s.description,
            category: s.category,
            definition: stored(s.definition, ctx.settings) as unknown as Prisma.InputJsonObject,
            requiredIntegrations: [],
            createdByUserId: ctx.actor.userId,
          },
        });
        installed += 1;
      }
      await this.audit.logIn(
        tx,
        'automation_template.starters_installed',
        { type: 'automation_template' },
        { installed },
      );
      return { available: STARTERS.length, installed, alreadyThere: STARTERS.length - installed };
    });
  }
}

export type { ImportAutomationTemplateRequest };
