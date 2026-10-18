import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  ConsentView,
  SegmentAudience,
  SegmentDetail,
  SegmentFieldList,
  SegmentMemberPage,
  SegmentPage,
  SegmentPreview,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef } from '../workspaces/common.js';
import {
  comErrors,
  type Criteria,
  fieldsFor,
  iso,
  mask,
  permsOf,
  summarize,
  validateCriteria,
  whereFor,
} from './communications.common.js';
import type {
  ConsentQ,
  CreateSegmentBody,
  PreviewSegmentBody,
  SegmentMembersQ,
  SegmentsQ,
  SetConsentBody,
  SetSegmentMembersBody,
  UpdateSegmentBody,
} from './communications-input.js';

type Out<S extends z.ZodType> = z.output<S>;

export interface SegCtx {
  tx: TxClient;
  businessId: string;
  userId: string;
  tenant: TenantContext;
  /** Staff reach only the clients and leads assigned to them. */
  reachOnly: boolean;
  perms: ReturnType<typeof permsOf>;
}

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'This segment was not found' });

const asCriteria = (json: unknown): Criteria => {
  const c = (json ?? {}) as Partial<Criteria>;
  return { logic: c.logic ?? 'AND', conditions: c.conditions ?? [], groups: c.groups ?? [] };
};

/** Segments, static lists and consent: who a campaign can reach, and who must be left out. */
@Injectable()
export class CommunicationSegmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private run<T>(
    tenant: TenantContext,
    userId: string,
    fn: (ctx: SegCtx) => Promise<T>,
  ): Promise<T> {
    const businessId = tenant.businessId;
    return this.database.withScope({ kind: 'business', businessId }, (tx) =>
      fn({
        tx,
        businessId,
        userId,
        tenant,
        reachOnly: tenant.kind === 'staff' && legacyFirmRole(tenant.role) === 'STAFF',
        perms: permsOf(tenant),
      }),
    );
  }

  private requireWrite(ctx: SegCtx) {
    if (!ctx.perms.write) throw comErrors.forbidden();
  }

  /** The clients and leads the caller may see. */
  private clientReach(ctx: SegCtx): Prisma.ClientWhereInput {
    return {
      businessId: ctx.businessId,
      archivedAt: null,
      ...(ctx.reachOnly ? { assignedUserId: ctx.userId } : {}),
    };
  }
  private leadReach(ctx: SegCtx): Prisma.LeadWhereInput {
    return {
      businessId: ctx.businessId,
      archivedAt: null,
      ...(ctx.reachOnly ? { assignedUserId: ctx.userId } : {}),
    };
  }

  fields(tenant: TenantContext, audience?: SegmentAudience): SegmentFieldList {
    void tenant;
    return {
      items: audience ? fieldsFor(audience) : fieldsFor('BOTH'),
    };
  }

  /** The people the criteria match now, within the caller's reach. */
  private async matches(ctx: SegCtx, audience: SegmentAudience, criteria: Criteria) {
    const clientWhere: Prisma.ClientWhereInput = {
      AND: [this.clientReach(ctx), whereFor(criteria, 'client', audience)],
    };
    const leadWhere: Prisma.LeadWhereInput = {
      AND: [this.leadReach(ctx), whereFor(criteria, 'lead', audience)],
    };
    return { clientWhere, leadWhere };
  }

  private async count(ctx: SegCtx, row: SegRow): Promise<number> {
    if (row.type === 'STATIC') {
      const [c, l] = await Promise.all([
        ctx.tx.communicationSegmentMember.count({
          where: {
            segmentId: row.id,
            clientId: { not: null },
            client: this.clientReach(ctx),
          },
        }),
        ctx.tx.communicationSegmentMember.count({
          where: { segmentId: row.id, leadId: { not: null }, lead: this.leadReach(ctx) },
        }),
      ]);
      return c + l;
    }
    const criteria = asCriteria(row.criteria);
    const { clientWhere, leadWhere } = await this.matches(ctx, row.audience, criteria);
    const [c, l] = await Promise.all([
      row.audience === 'LEADS' ? 0 : ctx.tx.client.count({ where: clientWhere }),
      row.audience === 'CLIENTS' ? 0 : ctx.tx.lead.count({ where: leadWhere }),
    ]);
    return c + l;
  }

  private async usedBy(ctx: SegCtx, segmentIds: string[]): Promise<Map<string, number>> {
    if (!segmentIds.length) return new Map();
    const rows = await ctx.tx.communicationAudienceEntry.groupBy({
      by: ['segmentId'],
      where: {
        businessId: ctx.businessId,
        segmentId: { in: segmentIds },
        kind: 'SEGMENT',
        communication: { status: 'SCHEDULED' },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.segmentId as string, r._count._all]));
  }

  private async rows(ctx: SegCtx, segs: SegRow[]) {
    const [names, used, counts] = await Promise.all([
      memberNames(
        ctx.tx,
        ctx.businessId,
        segs.map((s) => s.ownerUserId),
      ),
      this.usedBy(
        ctx,
        segs.map((s) => s.id),
      ),
      Promise.all(segs.map((s) => this.count(ctx, s))),
    ]);
    return segs.map((s, i) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      audience: s.audience,
      criteriaSummary: s.type === 'DYNAMIC' ? (s.criteriaSummary ?? null) : null,
      memberCount: counts[i] as number,
      lastRefreshedAt: iso(s.lastRefreshedAt),
      usedBy: used.get(s.id) ?? 0,
      owner: memberRef(names, s.ownerUserId) ?? { userId: s.ownerUserId, name: 'Former member' },
      archived: s.archivedAt !== null,
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  private async detail(ctx: SegCtx, s: SegRow): Promise<SegmentDetail> {
    const [row] = await this.rows(ctx, [s]);
    return {
      ...(row as NonNullable<typeof row>),
      criteria: s.type === 'DYNAMIC' ? (asCriteria(s.criteria) as SegmentDetail['criteria']) : null,
      etag: s.updatedAt.toISOString(),
    };
  }

  private async load(ctx: SegCtx, id: string): Promise<SegRow> {
    const s = await ctx.tx.communicationSegment.findFirst({
      where: { businessId: ctx.businessId, id },
    });
    if (!s) throw notFound();
    return s;
  }

  private async lock(ctx: SegCtx, id: string, etag?: string): Promise<SegRow> {
    await ctx.tx
      .$queryRaw`SELECT 1 FROM communication_segments WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const s = await this.load(ctx, id);
    if (etag !== undefined && s.updatedAt.toISOString() !== etag) throw comErrors.saveConflict();
    return s;
  }

  private async assertNameFree(ctx: SegCtx, name: string, exceptId?: string) {
    const clash = await ctx.tx.communicationSegment.findFirst({
      where: {
        businessId: ctx.businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw comErrors.duplicateName();
  }

  /** People the caller may name in a list: their own reach, within this firm. */
  private async reachable(
    ctx: SegCtx,
    clientIds: string[],
    leadIds: string[],
  ): Promise<{ clientIds: string[]; leadIds: string[] }> {
    const [c, l] = await Promise.all([
      clientIds.length
        ? ctx.tx.client.findMany({
            where: { AND: [this.clientReach(ctx), { id: { in: clientIds } }] },
            select: { id: true },
          })
        : [],
      leadIds.length
        ? ctx.tx.lead.findMany({
            where: { AND: [this.leadReach(ctx), { id: { in: leadIds } }] },
            select: { id: true },
          })
        : [],
    ]);
    const okC = new Set(c.map((x) => x.id));
    const okL = new Set(l.map((x) => x.id));
    const missC = clientIds.findIndex((id) => !okC.has(id));
    const missL = leadIds.findIndex((id) => !okL.has(id));
    if (missC >= 0) throw comErrors.invalid(`clientIds[${missC}]`, 'This client was not found');
    if (missL >= 0) throw comErrors.invalid(`leadIds[${missL}]`, 'This lead was not found');
    return { clientIds: [...new Set(clientIds)], leadIds: [...new Set(leadIds)] };
  }

  // ---------- Reads ----------

  list(tenant: TenantContext, userId: string, q: Out<typeof SegmentsQ>): Promise<SegmentPage> {
    return this.run(tenant, userId, async (ctx) => {
      const where: Prisma.CommunicationSegmentWhereInput = {
        businessId: ctx.businessId,
        archivedAt: q.archived ? { not: null } : null,
        ...(q.type ? { type: q.type } : {}),
        ...(q.audience ? { audience: q.audience } : {}),
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const [total, segs] = await Promise.all([
        ctx.tx.communicationSegment.count({ where }),
        ctx.tx.communicationSegment.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.rows(ctx, segs),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(tenant: TenantContext, userId: string, id: string): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => this.detail(ctx, await this.load(ctx, id)));
  }

  members(
    tenant: TenantContext,
    userId: string,
    id: string,
    q: Out<typeof SegmentMembersQ>,
  ): Promise<SegmentMemberPage> {
    return this.run(tenant, userId, async (ctx) => {
      const s = await this.load(ctx, id);
      const people: SegmentMemberPage['items'] = [];
      const label = (n: string) => n;
      if (s.type === 'STATIC') {
        const [cs, ls] = await Promise.all([
          ctx.tx.communicationSegmentMember.findMany({
            where: {
              segmentId: s.id,
              clientId: { not: null },
              client: {
                AND: [
                  this.clientReach(ctx),
                  q.search ? { displayName: { contains: q.search, mode: 'insensitive' } } : {},
                ],
              },
            },
            select: { client: { select: { id: true, displayName: true, email: true } } },
          }),
          ctx.tx.communicationSegmentMember.findMany({
            where: {
              segmentId: s.id,
              leadId: { not: null },
              lead: {
                AND: [
                  this.leadReach(ctx),
                  q.search
                    ? {
                        OR: [
                          { firstName: { contains: q.search, mode: 'insensitive' } },
                          { lastName: { contains: q.search, mode: 'insensitive' } },
                        ],
                      }
                    : {},
                ],
              },
            },
            select: {
              lead: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          }),
        ]);
        for (const m of cs)
          if (m.client)
            people.push({
              kind: 'CLIENT',
              id: m.client.id,
              label: label(m.client.displayName),
              secondary: mask(m.client.email) || null,
            });
        for (const m of ls)
          if (m.lead)
            people.push({
              kind: 'LEAD',
              id: m.lead.id,
              label: `${m.lead.firstName} ${m.lead.lastName}`,
              secondary: mask(m.lead.email) || null,
            });
      } else {
        const { clientWhere, leadWhere } = await this.matches(
          ctx,
          s.audience,
          asCriteria(s.criteria),
        );
        const [cs, ls] = await Promise.all([
          s.audience === 'LEADS'
            ? []
            : ctx.tx.client.findMany({
                where: {
                  AND: [
                    clientWhere,
                    q.search ? { displayName: { contains: q.search, mode: 'insensitive' } } : {},
                  ],
                },
                select: { id: true, displayName: true, email: true },
                take: 5_000,
              }),
          s.audience === 'CLIENTS'
            ? []
            : ctx.tx.lead.findMany({
                where: {
                  AND: [
                    leadWhere,
                    q.search
                      ? {
                          OR: [
                            { firstName: { contains: q.search, mode: 'insensitive' } },
                            { lastName: { contains: q.search, mode: 'insensitive' } },
                          ],
                        }
                      : {},
                  ],
                },
                select: { id: true, firstName: true, lastName: true, email: true },
                take: 5_000,
              }),
        ]);
        for (const c of cs)
          people.push({
            kind: 'CLIENT',
            id: c.id,
            label: c.displayName,
            secondary: mask(c.email) || null,
          });
        for (const l of ls)
          people.push({
            kind: 'LEAD',
            id: l.id,
            label: `${l.firstName} ${l.lastName}`,
            secondary: mask(l.email) || null,
          });
      }
      people.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      return {
        items: people.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total: people.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  preview(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof PreviewSegmentBody>,
  ): Promise<SegmentPreview> {
    return this.run(tenant, userId, async (ctx) => {
      const criteria = body.criteria as Criteria;
      validateCriteria(criteria, body.audience);
      const { clientWhere, leadWhere } = await this.matches(ctx, body.audience, criteria);
      const wantClients = body.audience !== 'LEADS';
      const wantLeads = body.audience !== 'CLIENTS';
      const [cc, lc, cs, ls] = await Promise.all([
        wantClients ? ctx.tx.client.count({ where: clientWhere }) : 0,
        wantLeads ? ctx.tx.lead.count({ where: leadWhere }) : 0,
        wantClients && body.sample
          ? ctx.tx.client.findMany({
              where: clientWhere,
              select: { id: true, displayName: true, email: true },
              orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
              take: body.sample,
            })
          : [],
        wantLeads && body.sample
          ? ctx.tx.lead.findMany({
              where: leadWhere,
              select: { id: true, firstName: true, lastName: true, email: true },
              orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
              take: body.sample,
            })
          : [],
      ]);
      const sample = [
        ...cs.map((c) => ({
          kind: 'CLIENT' as const,
          id: c.id,
          label: c.displayName,
          secondary: mask(c.email) || null,
        })),
        ...ls.map((l) => ({
          kind: 'LEAD' as const,
          id: l.id,
          label: `${l.firstName} ${l.lastName}`,
          secondary: mask(l.email) || null,
        })),
      ].slice(0, body.sample);
      return {
        count: cc + lc,
        // How many can receive the channel is worked out against consent in the send step.
        eligibleCount: null,
        sample,
        criteriaSummary: summarize(criteria),
        calculatedAt: new Date().toISOString(),
      };
    });
  }

  // ---------- Changes ----------

  create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateSegmentBody>,
  ): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      await this.assertNameFree(ctx, body.name);
      const criteria = (body.criteria ?? undefined) as Criteria | undefined;
      if (body.type === 'DYNAMIC') validateCriteria(criteria as Criteria, body.audience);
      const people =
        body.type === 'STATIC'
          ? await this.reachable(ctx, body.clientIds, body.leadIds)
          : { clientIds: [], leadIds: [] };
      if (body.type === 'STATIC' && body.audience === 'CLIENTS' && people.leadIds.length)
        throw comErrors.invalid('leadIds', 'A list of clients cannot hold leads');
      if (body.type === 'STATIC' && body.audience === 'LEADS' && people.clientIds.length)
        throw comErrors.invalid('clientIds', 'A list of leads cannot hold clients');
      const s = await ctx.tx.communicationSegment.create({
        data: {
          businessId: ctx.businessId,
          name: body.name,
          description: body.description ?? null,
          type: body.type,
          audience: body.audience,
          criteria: (criteria ?? {}) as Prisma.InputJsonValue,
          criteriaSummary: criteria ? summarize(criteria) : null,
          ownerUserId: ctx.userId,
          lastRefreshedAt: new Date(),
          members: {
            create: [
              ...people.clientIds.map((clientId) => ({ businessId: ctx.businessId, clientId })),
              ...people.leadIds.map((leadId) => ({ businessId: ctx.businessId, leadId })),
            ],
          },
        },
      });
      const count = await this.count(ctx, s);
      const saved = await ctx.tx.communicationSegment.update({
        where: { id: s.id },
        data: { memberCount: count },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication_segment.created',
        { type: 'communication_segment', id: s.id },
        { segmentId: s.id, type: s.type, audience: s.audience, memberCount: count },
      );
      return this.detail(ctx, saved);
    });
  }

  update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateSegmentBody>,
  ): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const s = await this.lock(ctx, id, body.etag);
      if (body.name !== undefined && body.name.toLowerCase() !== s.name.toLowerCase())
        await this.assertNameFree(ctx, body.name, s.id);
      if (s.type === 'STATIC' && body.criteria !== undefined)
        throw comErrors.invalid('criteria', 'A list has members, not criteria');
      const audience = body.audience ?? s.audience;
      if (s.type === 'STATIC' && body.audience !== undefined && body.audience !== s.audience) {
        const held = await ctx.tx.communicationSegmentMember.count({
          where: {
            segmentId: s.id,
            ...(body.audience === 'CLIENTS' ? { leadId: { not: null } } : {}),
            ...(body.audience === 'LEADS' ? { clientId: { not: null } } : {}),
          },
        });
        if (held) throw comErrors.invalid('audience', 'The list holds people of the other kind');
      }
      const criteria =
        s.type === 'DYNAMIC'
          ? ((body.criteria as Criteria | undefined) ?? asCriteria(s.criteria))
          : null;
      if (criteria) validateCriteria(criteria, audience);
      const changed = Object.keys(body).filter((k) => k !== 'etag');
      const saved = await ctx.tx.communicationSegment.update({
        where: { id: s.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          audience,
          ...(criteria && (body.criteria !== undefined || body.audience !== undefined)
            ? {
                criteria: criteria as Prisma.InputJsonValue,
                criteriaSummary: summarize(criteria),
              }
            : {}),
          lastRefreshedAt: new Date(),
        },
      });
      const count = await this.count(ctx, saved);
      const withCount = await ctx.tx.communicationSegment.update({
        where: { id: s.id },
        data: { memberCount: count },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication_segment.updated',
        { type: 'communication_segment', id: s.id },
        { segmentId: s.id, fields: changed },
      );
      return this.detail(ctx, withCount);
    });
  }

  setMembers(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetSegmentMembersBody>,
  ): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const s = await this.lock(ctx, id, body.etag);
      if (s.type !== 'STATIC')
        throw comErrors.invalid('type', 'Only a saved list has members you set by hand');
      const people = await this.reachable(ctx, body.clientIds, body.leadIds);
      if (s.audience === 'CLIENTS' && people.leadIds.length)
        throw comErrors.invalid('leadIds', 'A list of clients cannot hold leads');
      if (s.audience === 'LEADS' && people.clientIds.length)
        throw comErrors.invalid('clientIds', 'A list of leads cannot hold clients');
      // Members outside the caller's reach stay as they are: this caller replaces only their own view.
      const keep = await ctx.tx.communicationSegmentMember.findMany({
        where: {
          segmentId: s.id,
          OR: [
            { clientId: { not: null }, client: { NOT: this.clientReach(ctx) } },
            { leadId: { not: null }, lead: { NOT: this.leadReach(ctx) } },
          ],
        },
        select: { id: true },
      });
      await ctx.tx.communicationSegmentMember.deleteMany({
        where: { segmentId: s.id, id: { notIn: keep.map((k) => k.id) } },
      });
      await ctx.tx.communicationSegmentMember.createMany({
        data: [
          ...people.clientIds.map((clientId) => ({
            businessId: ctx.businessId,
            segmentId: s.id,
            clientId,
          })),
          ...people.leadIds.map((leadId) => ({
            businessId: ctx.businessId,
            segmentId: s.id,
            leadId,
          })),
        ],
        skipDuplicates: true,
      });
      const count = await this.count(ctx, s);
      const saved = await ctx.tx.communicationSegment.update({
        where: { id: s.id },
        data: { memberCount: count, lastRefreshedAt: new Date() },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication_segment.members_set',
        { type: 'communication_segment', id: s.id },
        { segmentId: s.id, memberCount: count },
      );
      return this.detail(ctx, saved);
    });
  }

  duplicate(tenant: TenantContext, userId: string, id: string): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const s = await this.load(ctx, id);
      let name = `${s.name} (copy)`.slice(0, 200);
      for (
        let n = 2;
        await ctx.tx.communicationSegment.findFirst({
          where: { businessId: ctx.businessId, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        n++
      )
        name = `${s.name} (copy ${n})`.slice(0, 200);
      const members =
        s.type === 'STATIC'
          ? await ctx.tx.communicationSegmentMember.findMany({
              where: { segmentId: s.id },
              select: { clientId: true, leadId: true },
            })
          : [];
      const made = await ctx.tx.communicationSegment.create({
        data: {
          businessId: ctx.businessId,
          name,
          description: s.description,
          type: s.type,
          audience: s.audience,
          criteria: s.criteria as Prisma.InputJsonValue,
          criteriaSummary: s.criteriaSummary,
          ownerUserId: ctx.userId,
          memberCount: s.memberCount,
          lastRefreshedAt: new Date(),
          members: {
            create: members.map((m) => ({
              businessId: ctx.businessId,
              clientId: m.clientId,
              leadId: m.leadId,
            })),
          },
        },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication_segment.duplicated',
        { type: 'communication_segment', id: made.id },
        { segmentId: made.id, sourceId: s.id },
      );
      return this.detail(ctx, made);
    });
  }

  setArchived(
    tenant: TenantContext,
    userId: string,
    id: string,
    archived: boolean,
  ): Promise<SegmentDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const s = await this.lock(ctx, id);
      if (archived) {
        const used = (await this.usedBy(ctx, [s.id])).get(s.id) ?? 0;
        if (used) throw comErrors.segmentInUse(used);
      }
      const saved =
        (s.archivedAt !== null) === archived
          ? s
          : await ctx.tx.communicationSegment.update({
              where: { id: s.id },
              data: { archivedAt: archived ? new Date() : null },
            });
      if (saved !== s)
        await this.audit.logIn(
          ctx.tx,
          archived ? 'communication_segment.archived' : 'communication_segment.restored',
          { type: 'communication_segment', id: s.id },
          { segmentId: s.id },
        );
      return this.detail(ctx, saved);
    });
  }

  // ---------- Consent ----------

  /** The person the caller names, within their reach; 404 otherwise. */
  private async person(ctx: SegCtx, clientId?: string, leadId?: string) {
    if (clientId) {
      const c = await ctx.tx.client.findFirst({
        where: { AND: [this.clientReach(ctx), { id: clientId }] },
        select: { id: true },
      });
      if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found' });
      return { clientId: c.id };
    }
    const l = await ctx.tx.lead.findFirst({
      where: { AND: [this.leadReach(ctx), { id: leadId as string }] },
      select: { id: true },
    });
    if (!l) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found' });
    return { leadId: l.id };
  }

  consent(tenant: TenantContext, userId: string, q: Out<typeof ConsentQ>): Promise<ConsentView> {
    return this.run(tenant, userId, async (ctx) => {
      if ((q.clientId === undefined) === (q.leadId === undefined))
        throw comErrors.invalid('clientId', 'Name a client or a lead');
      const who = await this.person(ctx, q.clientId, q.leadId);
      const rows = await ctx.tx.communicationConsent.findMany({
        where: { businessId: ctx.businessId, ...who },
        orderBy: { channel: 'asc' },
      });
      const names = await memberNames(
        ctx.tx,
        ctx.businessId,
        rows.map((r) => r.changedByUserId),
      );
      return {
        items: rows
          .filter((r) => r.channel === 'EMAIL' || r.channel === 'SMS')
          .map((r) => ({
            channel: r.channel as 'EMAIL' | 'SMS',
            status: r.status,
            source: r.source,
            changedBy: memberRef(names, r.changedByUserId),
            updatedAt: r.updatedAt.toISOString(),
          })),
      };
    });
  }

  setConsent(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof SetConsentBody>,
  ): Promise<ConsentView> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const who = await this.person(ctx, body.clientId, body.leadId);
      const existing = await ctx.tx.communicationConsent.findFirst({
        where: { businessId: ctx.businessId, channel: body.channel, ...who },
      });
      const data = { status: body.status, source: 'staff', changedByUserId: ctx.userId };
      if (existing) await ctx.tx.communicationConsent.update({ where: { id: existing.id }, data });
      else
        await ctx.tx.communicationConsent.create({
          data: { businessId: ctx.businessId, channel: body.channel, ...who, ...data },
        });
      await this.audit.logIn(
        ctx.tx,
        'communication_consent.set',
        { type: body.clientId ? 'client' : 'lead', id: (body.clientId ?? body.leadId) as string },
        { channel: body.channel, status: body.status, hadReason: body.reason != null },
      );
      const rows = await ctx.tx.communicationConsent.findMany({
        where: { businessId: ctx.businessId, ...who },
        orderBy: { channel: 'asc' },
      });
      const names = await memberNames(
        ctx.tx,
        ctx.businessId,
        rows.map((r) => r.changedByUserId),
      );
      return {
        items: rows
          .filter((r) => r.channel === 'EMAIL' || r.channel === 'SMS')
          .map((r) => ({
            channel: r.channel as 'EMAIL' | 'SMS',
            status: r.status,
            source: r.source,
            changedBy: memberRef(names, r.changedByUserId),
            updatedAt: r.updatedAt.toISOString(),
          })),
      };
    });
  }
}

type SegRow = Prisma.CommunicationSegmentGetPayload<object>;
