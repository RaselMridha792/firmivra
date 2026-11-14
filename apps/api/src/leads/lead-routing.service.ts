import { Body, Controller, Get, Inject, Injectable, Module, Put } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type LeadRouting,
  matchLeadRoute,
  type RoutableLead,
  SaveLeadRoutingRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from './leads.service.js';

const member = { select: { userId: true, user: { select: { name: true } } } } as const;
const memberRef = (m: { userId: string; user: { name: string } }) => ({
  userId: m.userId,
  name: m.user.name,
});

/**
 * Leads R2 17: where a new lead with no owner goes (Add New Lead without one, Begin Online's
 * submit), in the caller's transaction: the first enabled rule that matches, in order, whose
 * assignee is still an active member (an unavailable one is skipped), else the fallback while
 * active, else nobody. Nothing while routing is off. Sets the owner and the rule (a fallback
 * names none) and audits which.
 */
export async function routeNewLead(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  leadId: string,
  lead: RoutableLead,
): Promise<void> {
  const settings = await tx.leadRoutingSettings.findUnique({ where: { businessId } });
  if (!settings?.enabled) return;
  const [rules, active] = await Promise.all([
    tx.leadAssignmentRule.findMany({
      where: { businessId, archivedAt: null, enabled: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.membership.findMany({ where: { businessId, status: 'ACTIVE' }, select: { userId: true } }),
  ]);
  const activeIds = new Set(active.map((m) => m.userId));
  const usable = rules.filter((r) => activeIds.has(r.assigneeUserId));
  const route = matchLeadRoute({ enabled: true, rules: usable }, lead);
  const to =
    route && 'rule' in route
      ? { userId: route.rule.assigneeUserId, ruleId: route.rule.id }
      : settings.fallbackUserId && activeIds.has(settings.fallbackUserId)
        ? { userId: settings.fallbackUserId, ruleId: null }
        : null;
  if (!to) return;
  await tx.lead.update({
    where: { id: leadId },
    data: { assignedUserId: to.userId, assignedByRuleId: to.ruleId },
  });
  await audit.logIn(
    tx,
    'lead.routed',
    { type: 'lead', id: leadId },
    to.ruleId ? { ruleId: to.ruleId } : { fallback: true },
    { businessId },
  );
}

/** Settings > Lead assignment (Leads R2 17): the rules, the switch and the fallback. */
@Injectable()
export class LeadRoutingService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async read(tx: TxClient, businessId: string): Promise<LeadRouting> {
    const [settings, rules] = await Promise.all([
      tx.leadRoutingSettings.findUnique({
        where: { businessId },
        select: { enabled: true, fallback: member },
      }),
      tx.leadAssignmentRule.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { assignee: member },
      }),
    ]);
    return {
      enabled: settings?.enabled ?? false,
      fallback: settings?.fallback ? memberRef(settings.fallback) : null,
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        sources: r.sources,
        serviceIds: r.serviceIds,
        priorities: r.priorities,
        assignee: memberRef(r.assignee),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  get(businessId: string): Promise<LeadRouting> {
    return this.inFirm(businessId, (tx) => this.read(tx, businessId));
  }

  /**
   * Saves the whole setup: rules in the given order (positions 0, 1, ...), a rule left out
   * archived. Every assignee and the fallback an active member, every service the firm's (404
   * otherwise). Changes no lead. Audited with counts and ids.
   */
  async save(
    businessId: string,
    userId: string,
    body: z.output<typeof SaveLeadRoutingRequest>,
  ): Promise<LeadRouting> {
    return this.inFirm(businessId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-routing:${businessId}`}, 0))`;
      const people = [
        ...new Set([
          ...body.rules.map((r) => r.assigneeUserId),
          ...(body.fallbackUserId ? [body.fallbackUserId] : []),
        ]),
      ];
      const active = await tx.membership.count({
        where: { businessId, status: 'ACTIVE', userId: { in: people } },
      });
      if (active !== people.length) throw notFound();
      const serviceIds = [...new Set(body.rules.flatMap((r) => r.serviceIds))];
      if (serviceIds.length) {
        const found = await tx.service.count({ where: { businessId, id: { in: serviceIds } } });
        if (found !== serviceIds.length) throw notFound();
      }
      const existing = await tx.leadAssignmentRule.findMany({
        where: { businessId, archivedAt: null },
        select: { id: true },
      });
      const live = new Set(existing.map((r) => r.id));
      for (const r of body.rules) if (r.id && !live.has(r.id)) throw notFound();
      const kept = new Set(body.rules.flatMap((r) => (r.id ? [r.id] : [])));
      const archived = existing.filter((r) => !kept.has(r.id)).map((r) => r.id);
      if (archived.length) {
        await tx.leadAssignmentRule.updateMany({
          where: { businessId, id: { in: archived } },
          data: { archivedAt: new Date() },
        });
      }
      for (const [position, r] of body.rules.entries()) {
        const data = {
          name: r.name,
          position,
          enabled: r.enabled,
          sources: r.sources,
          serviceIds: r.serviceIds,
          priorities: r.priorities,
          assigneeUserId: r.assigneeUserId,
        };
        if (r.id) {
          await tx.leadAssignmentRule.update({ where: { id: r.id }, data });
        } else {
          await tx.leadAssignmentRule.create({
            data: { ...data, businessId, createdByUserId: userId },
          });
        }
      }
      await tx.leadRoutingSettings.upsert({
        where: { businessId },
        update: {
          enabled: body.enabled,
          fallbackUserId: body.fallbackUserId,
          updatedByUserId: userId,
        },
        create: {
          businessId,
          enabled: body.enabled,
          fallbackUserId: body.fallbackUserId,
          updatedByUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'leads.routing_saved',
        { type: 'lead_routing' },
        { enabled: body.enabled, rules: body.rules.length, archived },
      );
      return this.read(tx, businessId);
    });
  }
}

@Controller('business/lead-routing')
@Access('LEADS')
@Roles(...FIRM_MANAGERS)
export class LeadRoutingController {
  constructor(private readonly routing: LeadRoutingService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<LeadRouting> {
    return this.routing.get(tenant.businessId);
  }

  @Put()
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveLeadRoutingRequest))
    body: z.output<typeof SaveLeadRoutingRequest>,
  ): Promise<LeadRouting> {
    return this.routing.save(tenant.businessId, auth.userId, body);
  }
}

/** Kept apart from LeadsModule so Begin Online can route without the rest of Leads. */
@Module({ controllers: [LeadRoutingController], providers: [LeadRoutingService] })
export class LeadRoutingModule {}
