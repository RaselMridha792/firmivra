import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  ADMIN_AUDIT_EXPORT_MAX,
  type AdminAuditAvailableAction,
  type AdminAuditEvent,
  type AdminAuditEventDetail,
  type AdminAuditEventPage,
  type AdminAuditEventQuery,
  type AdminAuditExport,
  type AdminAuditExportRequest,
  type AdminAuditFacets,
  type AdminAuditNote,
  type AdminAuditSummary,
  type AdminAuditSummaryQuery,
  type AdminSecurityAlert,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { csvRow } from '../bookkeeping/bookkeeping.shared.js';
import { PlatformPrisma } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { notFound } from '../workspaces/common.js';
import {
  actionLabel,
  categoryWhere,
  changesOf,
  classify,
  deviceOf,
  failedLoginWhere,
  outcomeWhere,
  referenceOf,
  severityWhere,
  viewWhere,
} from './classify.js';
import { conflict } from './admin-audit.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Query = Out<typeof AdminAuditEventQuery>;

export const eventSelect = {
  id: true,
  businessId: true,
  actorUserId: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  ip: true,
  userAgent: true,
  requestId: true,
  createdAt: true,
  category: true,
  severity: true,
  outcome: true,
  actorType: true,
  actorName: true,
  actorRole: true,
  sessionId: true,
  authMethod: true,
  targetLabel: true,
  subjectUserId: true,
  subjectBusinessId: true,
  parentEventId: true,
  riskScore: true,
  ruleId: true,
  itemCount: true,
} satisfies Prisma.AuditLogSelect;
export type EventRow = Prisma.AuditLogGetPayload<{ select: typeof eventSelect }>;

export const alertSelect = {
  id: true,
  auditLogId: true,
  businessId: true,
  ruleId: true,
  severity: true,
  title: true,
  summary: true,
  riskScore: true,
  status: true,
  assignedToUserId: true,
  acknowledgedAt: true,
  closedAt: true,
  resolutionNote: true,
  createdAt: true,
} satisfies Prisma.SecurityAlertSelect;
export type AlertRow = Prisma.SecurityAlertGetPayload<{ select: typeof alertSelect }>;

const REVIEWED = 'audit.event_reviewed';
const DAY = 86_400_000;

/** The range a query names; left out, the last 14 days. */
export function rangeOf(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 14 * DAY);
  return { from, to };
}

/**
 * The Super Admin's audit and security log across firms (R55; contract in
 * packages/types/src/admin-audit). Admin scope reads every audit row (R0's `audit_logs_team_read`).
 * Names come from the rows' snapshots, else from the platform's users and firms (platform
 * tables, read for a Super Admin). Rows are never changed: reviews and responses are new rows.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly platform: PlatformPrisma,
    private readonly audit: AuditService,
  ) {}

  // ---------- Filters ----------

  where(q: Omit<Query, 'page' | 'pageSize'>): Prisma.AuditLogWhereInput {
    const { from, to } = rangeOf(q);
    const and: Prisma.AuditLogWhereInput[] = [
      { createdAt: { gte: from, lte: to } },
      viewWhere(q.view),
      // The reviews of events are part of their event's timeline, not the log.
      { NOT: { action: REVIEWED } },
    ];
    if (q.firm === 'platform') and.push({ businessId: null, subjectBusinessId: null });
    else if (q.firm) and.push({ OR: [{ businessId: q.firm }, { subjectBusinessId: q.firm }] });
    if (q.user) and.push({ actorUserId: q.user });
    if (q.action) and.push({ action: q.action });
    if (q.resource) and.push({ entityType: q.resource });
    if (q.category) and.push(categoryWhere([q.category]));
    if (q.severity) and.push(severityWhere([q.severity]));
    if (q.outcome) and.push(outcomeWhere([q.outcome]));
    if (q.alert === 'NONE') and.push({ securityAlerts: { none: {} } });
    else if (q.alert) and.push({ securityAlerts: { some: { status: q.alert } } });
    if (q.search) {
      const s = q.search;
      const or: Prisma.AuditLogWhereInput[] = [
        { actorName: { contains: s, mode: 'insensitive' } },
        { targetLabel: { contains: s, mode: 'insensitive' } },
        { entityId: { contains: s, mode: 'insensitive' } },
        { ip: { contains: s } },
        { action: { contains: s, mode: 'insensitive' } },
      ];
      if (/^[0-9a-f-]{36}$/i.test(s)) or.push({ id: s.toLowerCase() });
      const ref = /^EVT-(\d{8})-([0-9A-F]{6})$/i.exec(s);
      if (ref) {
        const day = new Date(
          `${ref[1]!.slice(0, 4)}-${ref[1]!.slice(4, 6)}-${ref[1]!.slice(6)}T00:00:00Z`,
        );
        or.push({ createdAt: { gte: day, lt: new Date(day.getTime() + DAY) } });
      }
      and.push({ OR: or });
    }
    return { AND: and };
  }

  // ---------- Views ----------

  /** Names for the rows' actors and firms, and their alerts and reviews. */
  async views(tx: TxClient, rows: EventRow[]): Promise<AdminAuditEvent[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const firmIds = [
      ...new Set(
        rows.flatMap((r) => [r.businessId, r.subjectBusinessId]).filter((x): x is string => !!x),
      ),
    ];
    const userIds = [
      ...new Set(
        rows.filter((r) => !r.actorName && r.actorUserId).map((r) => r.actorUserId as string),
      ),
    ];
    const [firms, users, alerts, reviews] = await Promise.all([
      firmIds.length
        ? tx.business.findMany({ where: { id: { in: firmIds } }, select: { id: true, name: true } })
        : [],
      userIds.length
        ? this.platform.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [],
      tx.securityAlert.findMany({
        where: { auditLogId: { in: ids } },
        select: { auditLogId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      tx.auditLog.findMany({
        where: { parentEventId: { in: ids }, action: REVIEWED },
        select: { parentEventId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const firmName = new Map(firms.map((f) => [f.id, f.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const alertOf = new Map<string, AdminAuditEvent['alertState']>();
    for (const a of alerts) if (!alertOf.has(a.auditLogId)) alertOf.set(a.auditLogId, a.status);
    const reviewedOf = new Map<string, Date>();
    for (const r of reviews)
      if (r.parentEventId && !reviewedOf.has(r.parentEventId))
        reviewedOf.set(r.parentEventId, r.createdAt);
    return rows.map((r) => this.view(r, { firmName, userName, alertOf, reviewedOf }));
  }

  private view(
    r: EventRow,
    m: {
      firmName: Map<string, string>;
      userName: Map<string, string>;
      alertOf: Map<string, AdminAuditEvent['alertState']>;
      reviewedOf: Map<string, Date>;
    },
  ): AdminAuditEvent {
    const c = classify(r);
    const firmId = r.businessId ?? r.subjectBusinessId;
    const actorName =
      r.actorName ??
      (r.actorUserId ? m.userName.get(r.actorUserId) : undefined) ??
      (r.actorUserId ? 'Unknown user' : 'System');
    const label = actionLabel(r.action);
    const device = deviceOf(r.userAgent);
    return {
      id: r.id,
      reference: referenceOf(r.id, r.createdAt),
      type: r.action,
      action: label,
      category: c.category,
      severity: c.severity,
      outcome: c.outcome,
      classified: c.classified,
      alertState: m.alertOf.get(r.id) ?? null,
      at: r.createdAt.toISOString(),
      summary: r.targetLabel ? `${label}: ${r.targetLabel}` : label,
      actor: {
        type: r.actorType ?? (r.actorUserId ? (r.businessId ? 'STAFF' : 'PLATFORM') : 'SYSTEM'),
        id: r.actorUserId,
        name: actorName,
        role: r.actorRole,
      },
      firm: firmId
        ? { id: firmId, name: m.firmName.get(firmId) ?? 'Unknown firm' }
        : { id: null, name: 'Firmivra' },
      authMethod: r.authMethod,
      sessionId: r.sessionId,
      requestId: r.requestId,
      device: { ip: r.ip, location: null, userAgent: r.userAgent, ...device },
      target: { type: r.entityType, id: r.entityId, name: r.targetLabel },
      subjectUserId: r.subjectUserId,
      relatedEventId: r.parentEventId,
      reviewedAt: m.reviewedOf.get(r.id)?.toISOString() ?? null,
      risk: { score: r.riskScore, rule: r.ruleId, reason: null },
      itemCount: r.itemCount,
    };
  }

  // ---------- The dashboard ----------

  async events(q: Query): Promise<AdminAuditEventPage> {
    return this.admin.transaction(async (tx) => {
      const where = this.where(q);
      const order: Prisma.AuditLogOrderByWithRelationInput[] =
        q.sort === 'action'
          ? [{ action: q.descending ? 'desc' : 'asc' }, { createdAt: 'desc' }]
          : q.sort === 'severity'
            ? [
                { severity: { sort: q.descending ? 'desc' : 'asc', nulls: 'last' } },
                { createdAt: 'desc' },
              ]
            : [{ createdAt: q.descending ? 'desc' : 'asc' }];
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          select: eventSelect,
          orderBy: [...order, { id: q.descending ? 'desc' : 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: await this.views(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async facets(): Promise<AdminAuditFacets> {
    return this.admin.transaction(async (tx) => {
      const since = new Date(Date.now() - 90 * DAY);
      const [firms, actions, resources, actors] = await Promise.all([
        tx.business.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 500,
        }),
        tx.auditLog.findMany({
          where: { createdAt: { gte: since } },
          select: { action: true },
          distinct: ['action'],
          orderBy: { action: 'asc' },
          take: 500,
        }),
        tx.auditLog.findMany({
          where: { createdAt: { gte: since } },
          select: { entityType: true },
          distinct: ['entityType'],
          orderBy: { entityType: 'asc' },
          take: 200,
        }),
        tx.auditLog.findMany({
          where: { createdAt: { gte: since }, actorUserId: { not: null } },
          select: { actorUserId: true, actorName: true },
          distinct: ['actorUserId'],
          take: 300,
        }),
      ]);
      const missing = actors.filter((a) => !a.actorName).map((a) => a.actorUserId as string);
      const names = new Map(
        (missing.length
          ? await this.platform.db.user.findMany({
              where: { id: { in: missing } },
              select: { id: true, name: true },
            })
          : []
        ).map((u) => [u.id, u.name]),
      );
      return {
        firms,
        users: actors
          .map((a) => ({
            id: a.actorUserId as string,
            name: a.actorName ?? names.get(a.actorUserId as string) ?? 'Unknown user',
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        actions: actions.map((a) => a.action).filter((a) => a !== REVIEWED),
        resources: resources.map((r) => r.entityType),
      };
    });
  }

  async summary(q: Out<typeof AdminAuditSummaryQuery>): Promise<AdminAuditSummary> {
    const { from, to } = rangeOf(q);
    const span = to.getTime() - from.getTime();
    const prev = { from: new Date(from.getTime() - span), to: new Date(from.getTime()) };
    return this.admin.transaction(async (tx) => {
      const count = (r: { from: Date; to: Date }, w: Prisma.AuditLogWhereInput) =>
        tx.auditLog.count({ where: { AND: [{ createdAt: { gte: r.from, lte: r.to } }, w] } });
      const alerts = (r: { from: Date; to: Date }) =>
        tx.securityAlert.count({
          where: { status: 'OPEN', createdAt: { gte: r.from, lte: r.to } },
        });
      const pair = async (fn: (r: { from: Date; to: Date }) => Promise<number>) => {
        const [value, previous] = await Promise.all([fn({ from, to }), fn(prev)]);
        return { value, previous };
      };
      const [openAlerts, failedLogins, highRiskEvents, criticalEvents, permissionChanges] =
        await Promise.all([
          pair(alerts),
          pair((r) => count(r, failedLoginWhere)),
          pair((r) => count(r, severityWhere(['HIGH', 'CRITICAL']))),
          pair((r) => count(r, severityWhere(['CRITICAL']))),
          pair((r) => count(r, categoryWhere(['AUTHORIZATION']))),
        ]);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        openAlerts,
        failedLogins,
        highRiskEvents,
        criticalEvents,
        permissionChanges,
        // Sessions are firm data (staff_sessions): not readable in admin scope.
        activeSessions: null,
      };
    });
  }

  // ---------- One event ----------

  async find(tx: TxClient, id: string): Promise<EventRow> {
    const row = await tx.auditLog.findUnique({ where: { id }, select: eventSelect });
    if (!row) throw notFound();
    return row;
  }

  async detail(id: string): Promise<AdminAuditEventDetail> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const row = await this.find(tx, id);
      const around = {
        gte: new Date(row.createdAt.getTime() - DAY),
        lte: new Date(row.createdAt.getTime() + DAY),
      };
      const same: Prisma.AuditLogWhereInput[] = [
        ...(row.actorUserId ? [{ actorUserId: row.actorUserId }] : []),
        ...(row.sessionId ? [{ sessionId: row.sessionId }] : []),
        ...(row.ip ? [{ ip: row.ip }] : []),
        ...(row.entityId ? [{ entityType: row.entityType, entityId: row.entityId }] : []),
      ];
      const relatedWhere: Prisma.AuditLogWhereInput = same.length
        ? {
            AND: [
              { createdAt: around },
              { id: { not: id } },
              { parentEventId: null },
              { OR: same },
            ],
          }
        : { id: { in: [] } };
      const [children, related, relatedTotal, alerts, notes, newer, older] = await Promise.all([
        tx.auditLog.findMany({
          where: { parentEventId: id },
          select: eventSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        }),
        tx.auditLog.findMany({
          where: relatedWhere,
          select: eventSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
        }),
        tx.auditLog.count({ where: relatedWhere }),
        tx.securityAlert.findMany({
          where: { auditLogId: id },
          select: alertSelect,
          orderBy: { createdAt: 'desc' },
        }),
        tx.auditInvestigationNote.findMany({
          where: { auditLogId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.auditLog.findFirst({
          where: {
            NOT: { action: REVIEWED },
            OR: [
              { createdAt: { gt: row.createdAt } },
              { createdAt: row.createdAt, id: { gt: id } },
            ],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        }),
        tx.auditLog.findFirst({
          where: {
            NOT: { action: REVIEWED },
            OR: [
              { createdAt: { lt: row.createdAt } },
              { createdAt: row.createdAt, id: { lt: id } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        }),
      ]);
      const [event, ...rest] = await this.views(tx, [row, ...children, ...related]);
      const authors = await this.adminNames([
        ...notes.map((n) => n.authorUserId),
        ...alerts.map((a) => a.assignedToUserId),
      ]);
      return {
        event: event!,
        changes: changesOf(row.metadata),
        timeline: rest.slice(0, children.length),
        related: rest.slice(children.length),
        relatedTotal,
        alerts: alerts.map((a) => this.alertView(a, event!.firm, authors)),
        notes: notes.map((n): AdminAuditNote => ({
          id: n.id,
          author: { id: n.authorUserId, name: authors.get(n.authorUserId) ?? 'Super Admin' },
          text: n.body,
          at: n.createdAt.toISOString(),
          supersedesId: n.supersedesNoteId,
          retractedAt: n.retractedAt?.toISOString() ?? null,
          isYours: n.authorUserId === adminUserId,
        })),
        previousId: newer?.id ?? null,
        nextId: older?.id ?? null,
        actions: this.actionsFor(event!, alerts),
      };
    });
  }

  /** Super Admins' names (platform tables), for notes and assignments. */
  async adminNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map();
    const users = await this.platform.db.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  alertView(
    a: AlertRow,
    firm: AdminSecurityAlert['firm'],
    names: Map<string, string>,
  ): AdminSecurityAlert {
    return {
      id: a.id,
      eventId: a.auditLogId,
      firm,
      ruleId: a.ruleId,
      severity: a.severity,
      title: a.title,
      summary: a.summary,
      riskScore: a.riskScore,
      status: a.status,
      assignedTo: a.assignedToUserId
        ? { id: a.assignedToUserId, name: names.get(a.assignedToUserId) ?? 'Super Admin' }
        : null,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
      closedAt: a.closedAt?.toISOString() ?? null,
      resolutionNote: a.resolutionNote,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** Event Details' buttons: what works from the admin console today, and why not otherwise. */
  actionsFor(event: AdminAuditEvent, alerts: { status: string }[]): AdminAuditAvailableAction[] {
    const firmAccount =
      'Firm accounts are changed from the firm (Staff Management) until the console has a path into them';
    const user = event.subjectUserId ?? event.actor.id;
    return [
      {
        action: 'MARK_REVIEWED',
        label: 'Mark as Reviewed',
        enabled: !event.reviewedAt,
        reason: event.reviewedAt ? 'Already reviewed' : null,
      },
      {
        action: 'SEND_ALERT',
        label: 'Send Security Alert',
        enabled: alerts.length === 0,
        reason: alerts.length ? 'An alert exists for this event' : null,
      },
      ...(
        [
          ['RESET_PASSWORD', 'Reset Password'],
          ['UNLOCK_ACCOUNT', 'Unlock Account'],
          ['FORCE_LOGOUT', 'Force Logout (All Devices)'],
          ['SUSPEND_USER', 'Suspend User'],
          ['RESET_MFA', 'Reset MFA'],
        ] as const
      ).map(([action, label]) => ({
        action,
        label,
        enabled: false,
        reason: user ? firmAccount : 'No user is named by this event',
      })),
      {
        action: 'DISABLE_INTEGRATION',
        label: 'Disable Integration',
        enabled: false,
        reason: 'Integrations are disabled from the Integrations module',
      },
    ];
  }

  // ---------- Export ----------

  async export(body: Out<typeof AdminAuditExportRequest>): Promise<AdminAuditExport> {
    const q = (body.query ?? { view: 'audit', sort: 'at', descending: true }) as Omit<
      Query,
      'page' | 'pageSize'
    >;
    const result = await this.admin.transaction(async (tx) => {
      const where = this.where(q);
      const total = await tx.auditLog.count({ where });
      if (total > ADMIN_AUDIT_EXPORT_MAX)
        throw conflict(
          'EXPORT_TOO_LARGE',
          `That is ${total} events; narrow the filters to at most ${ADMIN_AUDIT_EXPORT_MAX}`,
        );
      const rows = await tx.auditLog.findMany({
        where,
        select: eventSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return this.views(tx, rows);
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const fields = Object.keys(q)
      .filter((k) => (q as Record<string, unknown>)[k] !== undefined)
      .sort();
    await this.audit.log(
      'audit.exported',
      { type: 'audit_log' },
      { format: body.format, rowCount: result.length, filters: fields },
      { businessId: null },
    );
    if (body.format === 'JSON')
      return {
        fileName: `firmivra-audit-${stamp}.json`,
        mimeType: 'application/json',
        content: JSON.stringify(result, null, 2),
        rowCount: result.length,
      };
    const head = csvRow([
      'Event ID',
      'Date & Time (UTC)',
      'Category',
      'Severity',
      'Outcome',
      'Action',
      'User',
      'Role',
      'Firm',
      'Record Type',
      'Record',
      'IP Address',
      'Device',
    ]);
    const lines = result.map((e) =>
      csvRow([
        e.reference,
        e.at,
        e.category,
        e.severity,
        e.outcome,
        e.type,
        e.actor.name,
        e.actor.role,
        e.firm.name,
        e.target.type,
        e.target.name ?? e.target.id,
        e.device.ip,
        e.device.label,
      ]),
    );
    return {
      fileName: `firmivra-audit-${stamp}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      content: `${String.fromCharCode(0xfeff)}${[head, ...lines].join('\r\n')}\r\n`,
      rowCount: result.length,
    };
  }
}
