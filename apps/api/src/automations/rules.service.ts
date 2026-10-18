import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AutomationPreview,
  AutomationRuleDetail,
  AutomationRulePage,
  AutomationTemplateDetail,
  AutomationVersionDetail,
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
  toDay,
} from '../workspaces/common.js';
import { autoErrors } from './automations.common.js';
import { type AutoCtx, AutomationsReadService, ruleInclude } from './automations-read.service.js';
import type {
  ActivateBody,
  CreateRuleBody,
  PauseBody,
  PreviewBody,
  RulesQuery,
  SaveDefinitionBody,
  SaveAsTemplateBody,
  TestBody,
  UpdateRuleBody,
  UseTemplateBody,
} from './automations-input.js';
import { AutomationEngine } from './engine.service.js';
import {
  type Def,
  defOf,
  forTemplate,
  invalidDefinition,
  stored,
  structureProblems,
  viewOf,
} from './logic.js';
import { TemplatesService } from './templates.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const DAY = 86_400_000;

/** Rules: the list, the builder's saves (a new version each time), status, copies, dry runs. */
@Injectable()
export class RulesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
    private readonly engine: AutomationEngine,
    private readonly templates: TemplatesService,
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

  /** The definition checked against the catalog (400 INVALID_DEFINITION with the paths). */
  private structure(def: Def) {
    const problems = structureProblems(def);
    if (problems.length > 0) throw invalidDefinition(problems);
  }

  /** The person responsible: an active Owner or Admin of the firm. */
  private async owner(ctx: AutoCtx, userId: string | null | undefined) {
    if (!userId) return;
    const m = await ctx.tx.membership.findFirst({
      where: { businessId: ctx.businessId, userId, status: 'ACTIVE', joinedAt: { not: null } },
      select: { role: true },
    });
    if (!m) throw autoErrors.notAMember();
    if (m.role !== 'OWNER' && m.role !== 'ADMIN')
      throw autoErrors.invalid('ownerUserId', 'The owner of a rule is an Owner or an Admin');
  }

  private async nameFree(ctx: AutoCtx, name: string, exceptId?: string) {
    const twin = await ctx.tx.automationRule.findFirst({
      where: {
        businessId: ctx.businessId,
        archivedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (twin) throw autoErrors.duplicateName();
  }

  private async newVersion(ctx: AutoCtx, ruleId: string, def: Def, userId: string) {
    const { tx, businessId } = ctx;
    const last = await tx.automationRuleVersion.findFirst({
      where: { businessId, ruleId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const s = stored(def, ctx.settings);
    return tx.automationRuleVersion.create({
      data: {
        businessId,
        ruleId,
        version: (last?.version ?? 0) + 1,
        triggerModule: s.trigger.module,
        triggerEvent: s.trigger.event,
        timing: s.trigger.timing,
        offsetValue: s.trigger.offsetValue,
        offsetUnit: s.trigger.offsetUnit,
        matchMode: s.matchMode,
        conditions: s.conditions as Prisma.InputJsonValue,
        actions: s.actions as Prisma.InputJsonValue,
        settings: s.settings as Prisma.InputJsonValue,
        createdByUserId: userId,
      },
    });
  }

  private async blockers(
    ctx: AutoCtx,
    def: Def,
    rule: { id: string | null; name: string; ownerUserId: string | null; expiresOn: Date | null },
  ) {
    const checks = await this.read.checks(ctx, def, rule);
    return checks.filter((c) => c.severity === 'BLOCK');
  }

  // ---------- List and read ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof RulesQuery>,
  ): Promise<AutomationRulePage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.AutomationRuleWhereInput = {
        businessId,
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      };
      const dir = q.direction;
      const orderBy: Prisma.AutomationRuleOrderByWithRelationInput[] =
        q.sort === 'name'
          ? [{ name: dir }, { id: 'asc' }]
          : q.sort === 'status'
            ? [{ status: dir }, { id: 'asc' }]
            : q.sort === 'lastRun'
              ? [{ lastRunAt: { sort: dir, nulls: 'last' } }, { id: 'asc' }]
              : [{ updatedAt: dir }, { id: 'asc' }];
      if (q.needsAttention !== undefined) {
        const all = await ctx.tx.automationRule.findMany({
          where,
          include: ruleInclude,
          orderBy,
          take: 2_000,
        });
        const rows = (await this.read.rows(ctx, all)).filter(
          (r) => r.needsAttention === q.needsAttention,
        );
        return {
          items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
        };
      }
      const [total, found] = await Promise.all([
        ctx.tx.automationRule.count({ where }),
        ctx.tx.automationRule.findMany({
          where,
          include: ruleInclude,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: await this.read.rows(ctx, found), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AutomationRuleDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) =>
      this.read.detail(ctx, await this.read.load(ctx, id)),
    );
    await this.audit.log('automation_rule.viewed', { type: 'automation_rule', id }, { ruleId: id });
    return out;
  }

  version(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    version: number,
  ): Promise<AutomationVersionDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.load(ctx, id);
      const v = await ctx.tx.automationRuleVersion.findFirst({
        where: { businessId, ruleId: id, version },
      });
      if (!v) throw notFound();
      const [names, runs] = await Promise.all([
        memberNames(ctx.tx, businessId, [v.createdByUserId]),
        ctx.tx.automationRun.count({ where: { businessId, ruleVersionId: v.id, dryRun: false } }),
      ]);
      return {
        version: v.version,
        createdBy: memberRef(names, v.createdByUserId),
        createdAt: v.createdAt.toISOString(),
        runCount: runs,
        definition: viewOf(v),
      };
    });
  }

  // ---------- Create and change ----------

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateRuleBody>,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      if (body.activate && !ctx.perms.activate) throw autoErrors.forbidden();
      const { tx } = ctx;
      this.structure(body.definition);
      await this.read.requireMembers(ctx, body.definition.settings.notifyOnFailureUserIds);
      await this.nameFree(ctx, body.name);
      const ownerUserId = body.ownerUserId ?? (ctx.perms.admin ? userId : null);
      await this.owner(ctx, ownerUserId);
      if (body.activate) {
        const blocked = await this.blockers(ctx, body.definition, {
          id: null,
          name: body.name,
          ownerUserId,
          expiresOn: body.expiresOn ? toDay(body.expiresOn) : null,
        });
        if (blocked.length > 0) throw autoErrors.notReady(blocked);
      }
      let rule: { id: string };
      try {
        rule = await tx.automationRule.create({
          data: {
            businessId,
            name: body.name,
            description: body.description ?? null,
            category: body.category,
            priority: body.priority,
            ownerUserId,
            expiresOn: body.expiresOn ? toDay(body.expiresOn) : null,
            createdByUserId: userId,
          },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw autoErrors.duplicateName();
        throw error;
      }
      const v = await this.newVersion(ctx, rule.id, body.definition, userId);
      await tx.automationRule.update({
        where: { businessId_id: { businessId, id: rule.id } },
        data: { currentVersionId: v.id, ...(body.activate ? { status: 'ACTIVE' as const } : {}) },
      });
      await this.audit.logIn(
        tx,
        'automation_rule.created',
        { type: 'automation_rule', id: rule.id },
        { ruleId: rule.id, version: 1, status: body.activate ? 'ACTIVE' : 'DRAFT' },
      );
      return this.read.detail(ctx, await this.read.load(ctx, rule.id));
    });
  }

  /** The rule locked for a change, not archived. */
  private async editable(ctx: AutoCtx, id: string, etag?: string) {
    await this.read.load(ctx, id);
    await ctx.tx.$queryRaw`
      SELECT 1 FROM automation_rules WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    const rule = await this.read.load(ctx, id);
    if (rule.archivedAt) throw autoErrors.ruleArchived();
    if (etag !== undefined && etag !== rule.updatedAt.toISOString())
      throw autoErrors.saveConflict();
    return rule;
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateRuleBody>,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const rule = await this.editable(ctx, id, body.etag);
      if (body.name !== undefined) await this.nameFree(ctx, body.name, id);
      if (body.ownerUserId) await this.owner(ctx, body.ownerUserId);
      try {
        await tx.automationRule.update({
          where: { businessId_id: { businessId, id } },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.category !== undefined ? { category: body.category } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
            ...(body.expiresOn !== undefined
              ? { expiresOn: body.expiresOn ? toDay(body.expiresOn) : null }
              : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw autoErrors.duplicateName();
        throw error;
      }
      await this.audit.logIn(
        tx,
        'automation_rule.updated',
        { type: 'automation_rule', id },
        {
          ruleId: id,
          fields: sentFields(body, [
            'name',
            'description',
            'category',
            'priority',
            'ownerUserId',
            'expiresOn',
          ]),
          status: rule.status,
        },
      );
      return this.read.detail(ctx, await this.read.load(ctx, id));
    });
  }

  saveDefinition(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SaveDefinitionBody>,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const rule = await this.editable(ctx, id, body.etag);
      this.structure(body.definition);
      await this.read.requireMembers(ctx, body.definition.settings.notifyOnFailureUserIds);
      if (rule.status === 'ACTIVE') {
        const blocked = await this.blockers(ctx, body.definition, rule);
        if (blocked.length > 0) throw autoErrors.notReady(blocked);
      }
      const v = await this.newVersion(ctx, id, body.definition, userId);
      await tx.automationRule.update({
        where: { businessId_id: { businessId, id } },
        data: { currentVersionId: v.id },
      });
      await this.audit.logIn(
        tx,
        'automation_rule.version_saved',
        { type: 'automation_rule', id },
        { ruleId: id, version: v.version, status: rule.status },
      );
      return this.read.detail(ctx, await this.read.load(ctx, id));
    });
  }

  activate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ActivateBody>,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.activate) throw autoErrors.forbidden();
      const { tx } = ctx;
      const rule = await this.editable(ctx, id, body.etag);
      if (rule.status !== 'ACTIVE') {
        if (!rule.currentVersion)
          throw autoErrors.notReady([
            {
              code: 'MISSING_ACTION',
              severity: 'BLOCK',
              message: 'The rule has no definition yet',
              path: null,
            },
          ]);
        const blocked = await this.blockers(ctx, defOf(viewOf(rule.currentVersion)), rule);
        if (blocked.length > 0) throw autoErrors.notReady(blocked);
        await tx.automationRule.update({
          where: { businessId_id: { businessId, id } },
          data: { status: 'ACTIVE' },
        });
        await this.audit.logIn(
          tx,
          'automation_rule.activated',
          { type: 'automation_rule', id },
          { ruleId: id, version: rule.currentVersion.version, from: rule.status },
        );
      }
      return this.read.detail(ctx, await this.read.load(ctx, id));
    });
  }

  async pause(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof PauseBody>,
  ): Promise<AutomationRuleDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const rule = await this.editable(ctx, id, body.etag);
      if (rule.status === 'DRAFT') throw autoErrors.invalidStatus('A draft is not running');
      if (rule.status === 'ACTIVE') {
        await tx.automationRule.update({
          where: { businessId_id: { businessId, id } },
          data: { status: 'PAUSED' },
        });
        await this.audit.logIn(
          tx,
          'automation_rule.paused',
          { type: 'automation_rule', id },
          { ruleId: id, scheduledActions: body.scheduledActions },
        );
      }
      return this.read.detail(ctx, await this.read.load(ctx, id));
    });
    if (body.scheduledActions === 'CANCEL') await this.engine.cancelWaiting(businessId, id);
    return out;
  }

  duplicate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const src = await this.read.load(ctx, id);
      if (!src.currentVersion) throw autoErrors.invalidStatus('The rule has no definition to copy');
      let name = `${src.name} (copy)`.slice(0, 120);
      for (
        let n = 2;
        await tx.automationRule.findFirst({
          where: { businessId, archivedAt: null, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        n += 1
      )
        name = `${src.name.slice(0, 100)} (copy ${n})`;
      const copy = await tx.automationRule.create({
        data: {
          businessId,
          name,
          description: src.description,
          category: src.category,
          priority: src.priority,
          ownerUserId: src.ownerUserId,
          expiresOn: src.expiresOn,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      const v = await this.newVersion(ctx, copy.id, defOf(viewOf(src.currentVersion)), userId);
      await tx.automationRule.update({
        where: { businessId_id: { businessId, id: copy.id } },
        data: { currentVersionId: v.id },
      });
      await this.audit.logIn(
        tx,
        'automation_rule.duplicated',
        { type: 'automation_rule', id: copy.id },
        { ruleId: copy.id, from: id },
      );
      return this.read.detail(ctx, await this.read.load(ctx, copy.id));
    });
  }

  async setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<AutomationRuleDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      await this.read.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM automation_rules WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const rule = await this.read.load(ctx, id);
      if (archive === (rule.archivedAt === null)) {
        if (!archive) await this.nameFree(ctx, rule.name, id);
        await tx.automationRule.update({
          where: { businessId_id: { businessId, id } },
          data: archive
            ? { status: 'ARCHIVED', archivedAt: new Date() }
            : { status: 'DRAFT', archivedAt: null },
        });
        await this.audit.logIn(
          tx,
          archive ? 'automation_rule.archived' : 'automation_rule.restored',
          { type: 'automation_rule', id },
          { ruleId: id, from: rule.status },
        );
      }
      return this.read.detail(ctx, await this.read.load(ctx, id));
    });
    if (archive) await this.engine.cancelWaiting(businessId, id);
    return out;
  }

  /** A DRAFT rule made from a template, for review (never active). */
  useTemplate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    templateId: string,
    body: Out<typeof UseTemplateBody>,
  ): Promise<AutomationRuleDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const { tx } = ctx;
      const { row, def } = await this.templates.usable(ctx, templateId);
      let name = (body.name ?? row.name).slice(0, 120);
      if (body.name) await this.nameFree(ctx, name);
      else
        for (
          let n = 2;
          await tx.automationRule.findFirst({
            where: { businessId, archivedAt: null, name: { equals: name, mode: 'insensitive' } },
            select: { id: true },
          });
          n += 1
        )
          name = `${row.name.slice(0, 100)} (${n})`;
      const rule = await tx.automationRule.create({
        data: {
          businessId,
          name,
          description: row.description,
          category: row.category,
          ownerUserId: ctx.perms.admin ? userId : null,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      const v = await this.newVersion(ctx, rule.id, def, userId);
      await tx.automationRule.update({
        where: { businessId_id: { businessId, id: rule.id } },
        data: { currentVersionId: v.id },
      });
      await this.audit.logIn(
        tx,
        'automation_rule.created',
        { type: 'automation_rule', id: rule.id },
        { ruleId: rule.id, version: 1, status: 'DRAFT', templateId },
      );
      return this.read.detail(ctx, await this.read.load(ctx, rule.id));
    });
  }

  // ---------- Dry runs and templates ----------

  validate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof PreviewBody>,
  ): Promise<AutomationPreview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      this.structure(body.definition);
      await this.read.requireMembers(ctx, body.definition.settings.notifyOnFailureUserIds);
      return this.read.preview(
        ctx,
        body.definition,
        {
          id: null,
          name: 'New rule',
          ownerUserId: ctx.perms.admin ? userId : null,
          expiresOn: null,
        },
        body.sample,
        new Date(Date.now() - 7 * DAY),
      );
    });
  }

  test(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof TestBody>,
  ): Promise<AutomationPreview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const rule = await this.read.load(ctx, id);
      const v = body.version
        ? await ctx.tx.automationRuleVersion.findFirst({
            where: { businessId, ruleId: id, version: body.version },
          })
        : rule.currentVersion;
      if (!v) throw notFound();
      return this.read.preview(ctx, defOf(viewOf(v)), rule, body.sample, v.createdAt);
    });
  }

  saveAsTemplate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SaveAsTemplateBody>,
  ): Promise<AutomationTemplateDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      const rule = await this.read.load(ctx, id);
      if (!rule.currentVersion)
        throw autoErrors.invalidStatus('The rule has no definition to save');
      const def = forTemplate(defOf(viewOf(rule.currentVersion)));
      return this.templates.createIn(ctx, {
        name: body.name,
        description: body.description ?? null,
        category: rule.category,
        definition: def,
        requiredIntegrations: [],
        fromRuleId: id,
      });
    });
  }
}
