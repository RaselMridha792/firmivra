import type { TxClient } from '@firmivra/db';
import { PROVIDERS } from '../integrations/catalog.js';
import type { FieldValue } from './logic.js';
import type { Candidate, Scope } from './matching.js';

// AU-F08 to F18 (Octavia's Oct 28 review): events that are a change the source module already
// records in its own audit log (a status changed, a form submitted, a lead converted). Each audit
// row is one occurrence, so a rule runs once for it; nothing is inferred from a record's current
// state. The record, its client and its label come from the module's own table, in the firm's
// scope (the audit log's own policy keeps another firm's rows out).

type Meta = Record<string, unknown>;
type Resolved = { clientId: string | null; label: string; fields: Record<string, FieldValue> };
type Resolver = (tx: TxClient, businessId: string, ids: string[]) => Promise<Map<string, Resolved>>;

export interface AuditEvent {
  /** The source module's audit actions that are this event. */
  actions: readonly string[];
  /** The record the audit row is about (its entity type). */
  entity: string;
  /**
   * How the record's client is found: from the module's own table (`RESOLVERS`), or (`meta`) from
   * the client id the module wrote on the row, for records that belong to one client's service
   * (a bookkeeping period, a payroll run).
   */
  via?: 'meta';
  /** The record kind runs show, when it isn't the entity type. */
  recordKind?: string;
  /** Only the rows whose metadata says so (a client update that changed the assignment). */
  when?: (meta: Meta) => boolean;
  /** What a condition can test from the row itself (a status change's old and new status). */
  fieldsOf?: (meta: Meta) => Record<string, FieldValue>;
}

/** A status change the module records with `from` and `to`. */
const statusMove = (meta: Meta): Record<string, FieldValue> => ({
  newStatus: typeof meta['to'] === 'string' ? meta['to'] : null,
  previousStatus: typeof meta['from'] === 'string' ? meta['from'] : null,
});

/** Each client's account type (Individual or Business), for the records that only keep its id. */
export async function clientTypes(
  tx: TxClient,
  businessId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const rows = await tx.client.findMany({
    where: { businessId, id: { in: [...new Set(ids)] } },
    select: { id: true, accountType: true },
  });
  return new Map(rows.map((c) => [c.id, c.accountType]));
}

/** A provider's name as Integrations shows it ("QuickBooks Online"), or its code. */
export const providerName = (code: string) =>
  PROVIDERS.find((p) => p.provider === code)?.name ?? code;

const changed = (field: string) => (meta: Meta) =>
  Array.isArray(meta['fields']) && (meta['fields'] as unknown[]).includes(field);

const RESOLVERS = {
  client: (async (tx, businessId, ids) => {
    const rows = await tx.client.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        displayName: true,
        accountType: true,
        status: true,
        assignedUserId: true,
        tags: { select: { tagId: true } },
      },
    });
    return new Map(
      rows.map((c) => [
        c.id,
        {
          clientId: c.id,
          label: c.displayName,
          fields: {
            clientType: c.accountType,
            status: c.status,
            tags: c.tags.map((t) => t.tagId),
            assignedUserId: c.assignedUserId,
          },
        },
      ]),
    );
  }) satisfies Resolver,
  lead: (async (tx, businessId, ids) => {
    const rows = await tx.lead.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        source: true,
        clientId: true,
        assignedUserId: true,
        tags: { select: { tagId: true } },
      },
    });
    return new Map(
      rows.map((l) => [
        l.id,
        {
          clientId: l.clientId,
          label: `${l.firstName} ${l.lastName}`.trim(),
          fields: {
            stage: l.status,
            source: l.source,
            tags: l.tags.map((t) => t.tagId),
            assignedUserId: l.assignedUserId,
          },
        },
      ]),
    );
  }) satisfies Resolver,
  intake: (async (tx, businessId, ids) => {
    const rows = await tx.intake.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        status: true,
        form: { select: { title: true } },
        engagement: { select: { clientId: true, client: { select: { accountType: true } } } },
      },
    });
    return new Map(
      rows.map((i) => [
        i.id,
        {
          clientId: i.engagement?.clientId ?? null,
          label: i.form.title,
          fields: { clientType: i.engagement?.client.accountType ?? null, status: i.status },
        },
      ]),
    );
  }) satisfies Resolver,
  tax_return: (async (tx, businessId, ids) => {
    const rows = await tx.taxReturn.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        clientId: true,
        taxYear: true,
        formType: true,
        workflowStatus: true,
        client: { select: { accountType: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          clientId: r.clientId,
          label: `${r.formType ?? 'Tax return'} ${r.taxYear}`,
          fields: {
            clientType: r.client.accountType,
            workflowStatus: r.workflowStatus,
            taxYear: r.taxYear,
          },
        },
      ]),
    );
  }) satisfies Resolver,
  tax_plan: (async (tx, businessId, ids) => {
    const rows = await tx.taxPlan.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        clientId: true,
        name: true,
        planYear: true,
        status: true,
        client: { select: { accountType: true } },
      },
    });
    return new Map(
      rows.map((p) => [
        p.id,
        {
          clientId: p.clientId,
          label: p.name,
          fields: { clientType: p.client.accountType, status: p.status, planYear: p.planYear },
        },
      ]),
    );
  }) satisfies Resolver,
  advisory_plan: (async (tx, businessId, ids) => {
    const rows = await tx.advisoryPlan.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        status: true,
        advisoryClient: { select: { clientId: true, client: { select: { accountType: true } } } },
      },
    });
    return new Map(
      rows.map((p) => [
        p.id,
        {
          clientId: p.advisoryClient.clientId,
          label: p.name,
          fields: { clientType: p.advisoryClient.client.accountType, status: p.status },
        },
      ]),
    );
  }) satisfies Resolver,
  advisory_client: (async (tx, businessId, ids) => {
    const rows = await tx.advisoryClient.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        clientId: true,
        client: { select: { displayName: true, accountType: true } },
      },
    });
    return new Map(
      rows.map((a) => [
        a.id,
        {
          clientId: a.clientId,
          label: a.client.displayName,
          fields: { clientType: a.client.accountType },
        },
      ]),
    );
  }) satisfies Resolver,
  document: (async (tx, businessId, ids) => {
    const rows = await tx.document.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, fileName: true, clientId: true },
    });
    const types = await clientTypes(
      tx,
      businessId,
      rows.map((d) => d.clientId),
    );
    return new Map(
      rows.map((d) => [
        d.id,
        {
          clientId: d.clientId,
          label: d.fileName,
          fields: { clientType: types.get(d.clientId) ?? null },
        },
      ]),
    );
  }) satisfies Resolver,
  document_request_packet: (async (tx, businessId, ids) => {
    const rows = await tx.documentRequestPacket.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, title: true, clientId: true },
    });
    const types = await clientTypes(
      tx,
      businessId,
      rows.map((p) => p.clientId),
    );
    return new Map(
      rows.map((p) => [
        p.id,
        {
          clientId: p.clientId,
          label: p.title,
          fields: { clientType: types.get(p.clientId) ?? null },
        },
      ]),
    );
  }) satisfies Resolver,
  // AU-F19, F20, F18: the firm's own records, with no client.
  membership: (async (tx, businessId, ids) => {
    const rows = await tx.membership.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    return new Map(
      rows.map((m) => [m.id, { clientId: null, label: m.user.name, fields: { role: m.role } }]),
    );
  }) satisfies Resolver,
  team: (async (tx, businessId, ids) => {
    const rows = await tx.team.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((t) => [t.id, { clientId: null, label: t.name, fields: {} }]));
  }) satisfies Resolver,
  integration_connection: (async (tx, businessId, ids) => {
    const rows = await tx.integrationConnection.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, provider: true },
    });
    return new Map(
      rows.map((c) => [
        c.id,
        { clientId: null, label: providerName(c.provider), fields: { provider: c.provider } },
      ]),
    );
  }) satisfies Resolver,
  communication: (async (tx, businessId, ids) => {
    const rows = await tx.communication.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, name: true, channel: true },
    });
    return new Map(
      rows.map((c) => [c.id, { clientId: null, label: c.name, fields: { channel: c.channel } }]),
    );
  }) satisfies Resolver,
};

/** The audit-sourced events, by event code. */
export const AUDIT_EVENTS: Record<string, AuditEvent> = {
  // Clients (AU-F08)
  'client.assignment_changed': {
    actions: ['client.updated'],
    entity: 'client',
    when: changed('assignedUserId'),
  },
  'client.tags_changed': { actions: ['client.tags_set'], entity: 'client' },
  'client.profile_changed': { actions: ['client.profile_updated'], entity: 'client' },
  'client.archived': { actions: ['client.archived'], entity: 'client' },
  'client.reactivated': { actions: ['client.restored'], entity: 'client' },
  // Leads (AU-F09)
  'lead.created': { actions: ['lead.created', 'begin_online.submitted'], entity: 'lead' },
  'lead.stage_changed': { actions: ['lead.updated'], entity: 'lead', when: changed('stage') },
  'lead.assignment_changed': {
    actions: ['lead.updated'],
    entity: 'lead',
    when: changed('assignedUserId'),
  },
  'lead.converted': { actions: ['lead.converted'], entity: 'lead' },
  'lead.disqualified': { actions: ['lead.declined'], entity: 'lead' },
  // Intake Forms (AU-F10): a first submission and a later version are distinct events.
  'intake.sent': { actions: ['intake.sent'], entity: 'intake' },
  'intake.submitted': {
    actions: ['intake.submitted'],
    entity: 'intake',
    when: (m) => typeof m['version'] !== 'number' || m['version'] <= 1,
  },
  'intake.resubmitted': {
    actions: ['intake.submitted'],
    entity: 'intake',
    when: (m) => typeof m['version'] === 'number' && m['version'] > 1,
  },
  'intake.returned': { actions: ['intake.correction_requested'], entity: 'intake' },
  'intake.approved': { actions: ['intake.completed'], entity: 'intake' },
  // Documents (AU-F11)
  'document.requested': {
    actions: ['document_request_packet.sent'],
    entity: 'document_request_packet',
  },
  'document.uploaded': { actions: ['document.uploaded'], entity: 'document' },
  'document.approved': {
    actions: ['document.reviewed'],
    entity: 'document',
    when: (m) => m['action'] === 'VERIFY' || m['action'] === 'COMPLETE',
  },
  'document.returned': {
    actions: ['document.reviewed'],
    entity: 'document',
    when: (m) => m['action'] === 'REQUEST_REPLACEMENT',
  },
  'document.request_completed': {
    actions: ['document_request_packet.completed'],
    entity: 'document_request_packet',
  },
  'document.archived': { actions: ['document.archived'], entity: 'document' },
  'document.restored': { actions: ['document.restored'], entity: 'document' },
  // Tax Returns (AU-F12): Ready for Review, Signature, Transmitted, Accepted and Rejected are
  // workflow statuses, so one event with the new and previous status covers them.
  'tax_return.created': { actions: ['tax_return.created'], entity: 'tax_return' },
  'tax_return.status_changed': {
    actions: ['tax_return.status_changed'],
    entity: 'tax_return',
    fieldsOf: statusMove,
  },
  'tax_return.amended': { actions: ['tax_return.amended'], entity: 'tax_return' },
  'tax_return.archived': { actions: ['tax_return.archived'], entity: 'tax_return' },
  'tax_return.reopened': { actions: ['tax_return.restored'], entity: 'tax_return' },
  // Tax Planning (AU-F13)
  'tax_plan.created': { actions: ['tax_plan.created'], entity: 'tax_plan' },
  'tax_plan.status_changed': {
    actions: ['tax_plan.status_changed'],
    entity: 'tax_plan',
    fieldsOf: statusMove,
  },
  'tax_plan.finalized': { actions: ['tax_plan.finalized'], entity: 'tax_plan' },
  'tax_plan.shared': { actions: ['tax_plan.sent'], entity: 'tax_plan' },
  'tax_plan.archived': { actions: ['tax_plan.archived'], entity: 'tax_plan' },
  // Business Advisory (AU-F14)
  'advisory.engagement_created': { actions: ['advisory_client.added'], entity: 'advisory_client' },
  'advisory.engagement_archived': {
    actions: ['advisory_client.archived'],
    entity: 'advisory_client',
  },
  'advisory_plan.created': { actions: ['advisory_plan.created'], entity: 'advisory_plan' },
  'advisory_plan.status_changed': {
    actions: ['advisory_plan.status_changed'],
    entity: 'advisory_plan',
    fieldsOf: statusMove,
  },
  'advisory_plan.finalized': { actions: ['advisory_plan.finalized'], entity: 'advisory_plan' },
  'advisory_plan.shared': { actions: ['advisory_plan.sent'], entity: 'advisory_plan' },
  // Bookkeeping (AU-F16): the client's bookkeeping service and its periods, reconciliations,
  // reports and accounting connection.
  'bookkeeping.enrolled': {
    actions: ['bookkeeping.client.added'],
    entity: 'bookkeeping_client',
    via: 'meta',
  },
  'bookkeeping.status_changed': {
    actions: ['bookkeeping.client.status_changed'],
    entity: 'bookkeeping_client',
    via: 'meta',
    fieldsOf: statusMove,
  },
  'bookkeeping.assignment_changed': {
    actions: ['bookkeeping.client.assigned'],
    entity: 'bookkeeping_client',
    via: 'meta',
  },
  'bookkeeping.period_opened': {
    actions: ['bookkeeping.period.created'],
    entity: 'bookkeeping_period',
    via: 'meta',
  },
  'bookkeeping.reconciliation_started': {
    actions: ['bookkeeping.reconciliation.created'],
    entity: 'bookkeeping_reconciliation',
    via: 'meta',
  },
  'bookkeeping.report_ready': {
    actions: ['bookkeeping.report.added'],
    entity: 'bookkeeping_report',
    via: 'meta',
  },
  'bookkeeping.connection_disconnected': {
    actions: ['bookkeeping.connection.disconnected'],
    entity: 'bookkeeping_connection',
    via: 'meta',
  },
  // Payroll (AU-F17): recording a run's step never starts or submits a payroll run.
  'payroll.enrolled': { actions: ['payroll.client.added'], entity: 'payroll_client', via: 'meta' },
  'payroll.status_changed': {
    actions: ['payroll.client.status_changed'],
    entity: 'payroll_client',
    via: 'meta',
    fieldsOf: statusMove,
  },
  'payroll.run_created': { actions: ['payroll.run.created'], entity: 'payroll_run', via: 'meta' },
  'payroll.run_ready': {
    actions: ['payroll.run.marked_ready'],
    entity: 'payroll_run',
    via: 'meta',
  },
  'payroll.run_approved': { actions: ['payroll.run.approved'], entity: 'payroll_run', via: 'meta' },
  'payroll.run_returned': { actions: ['payroll.run.reopened'], entity: 'payroll_run', via: 'meta' },
  'payroll.run_submitted': {
    actions: ['payroll.run.submitted'],
    entity: 'payroll_run',
    via: 'meta',
  },
  'payroll.run_completed': {
    actions: ['payroll.run.completed'],
    entity: 'payroll_run',
    via: 'meta',
  },
  'payroll.report_ready': {
    actions: ['payroll.report.added'],
    entity: 'payroll_report',
    via: 'meta',
  },
  // Communications (AU-F18), the client's own: an unsubscribe or a spam report is a consent
  // change. Firm-wide sends are below, with the firm's other events that have no client.
  'communication.consent_changed': {
    actions: ['communication_consent.set'],
    entity: 'client',
    fieldsOf: (m) => ({
      channel: typeof m['channel'] === 'string' ? m['channel'] : null,
      consentStatus: typeof m['status'] === 'string' ? m['status'] : null,
    }),
  },
  // Staff Management (AU-F19): the Team and Staff modules' own entries. A trigger only tells:
  // it never grants or changes anyone's rights.
  'staff.invited': { actions: ['membership.invited'], entity: 'membership' },
  'staff.invitation_accepted': { actions: ['membership.activated'], entity: 'membership' },
  'staff.role_changed': {
    actions: ['membership.role_changed'],
    entity: 'membership',
    fieldsOf: (m) => ({
      newRole: typeof m['to'] === 'string' ? m['to'] : null,
      previousRole: typeof m['from'] === 'string' ? m['from'] : null,
    }),
  },
  'staff.permissions_changed': {
    actions: ['staff.permissions_saved', 'staff.permissions_overridden'],
    entity: 'membership',
  },
  'staff.team_changed': { actions: ['team.members_set'], entity: 'team' },
  'staff.deactivated': { actions: ['membership.deactivated'], entity: 'membership' },
  'staff.reactivated': { actions: ['staff.reactivated'], entity: 'membership' },
  // Integrations (AU-F20): the firm's own connect, reconnect and disconnect. Syncs are in
  // matching.ts (the sync runs themselves).
  'integration.connected': { actions: ['integration.connected'], entity: 'integration_connection' },
  'integration.reconnected': {
    actions: ['integration.reconnected'],
    entity: 'integration_connection',
  },
  'integration.disconnected': {
    actions: ['integration.disconnected'],
    entity: 'integration_connection',
  },
  // Communications (AU-F18), firm-wide: the Communications module's own entries. No opens or
  // clicks (the review says not to add them).
  'communication.draft_created': { actions: ['communication.created'], entity: 'communication' },
  'communication.scheduled': { actions: ['communication.scheduled'], entity: 'communication' },
  'communication.sent': { actions: ['communication.sent'], entity: 'communication' },
  'communication.delivered': { actions: ['communication.finished'], entity: 'communication' },
  'communication.failed': {
    actions: ['communication.failed', 'communication.schedule_failed'],
    entity: 'communication',
  },
  'communication.announcement_expired': {
    actions: ['communication.expired'],
    entity: 'communication',
  },
};

const LIMIT = 2_000;

/** The occurrences of an audit-sourced event since the rule's version began. */
export async function loadAuditEvent(
  tx: TxClient,
  spec: AuditEvent,
  s: Scope,
): Promise<Candidate[]> {
  const rows = await tx.auditLog.findMany({
    where: {
      businessId: s.businessId,
      action: { in: [...spec.actions] },
      entityType: spec.entity,
      entityId: s.recordId ? s.recordId : { not: null },
      createdAt: { gte: s.since, lte: s.now },
    },
    select: { id: true, entityId: true, metadata: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: s.limit ?? LIMIT,
  });
  const hits = rows.filter((r) => !spec.when || spec.when(metaOf(r.metadata)));
  if (hits.length === 0) return [];
  if (spec.via === 'meta') return byMetaClient(tx, spec, s, hits);
  const resolve = RESOLVERS[spec.entity as keyof typeof RESOLVERS];
  if (!resolve) return [];
  const records = await resolve(tx, s.businessId, [...new Set(hits.map((r) => r.entityId!))]);
  return hits.flatMap((r) => {
    const record = records.get(r.entityId!);
    if (!record) return [];
    return [
      {
        recordKind: spec.entity === 'document_request_packet' ? 'document_request' : spec.entity,
        recordId: r.entityId!,
        clientId: record.clientId,
        label: record.label,
        at: r.createdAt,
        // One run per audit row: the same change is never acted on twice.
        occurrence: r.id,
        fields: { ...record.fields, ...(spec.fieldsOf?.(metaOf(r.metadata)) ?? {}) },
      },
    ];
  });
}

/** A record of one client's service: its client is the id the module wrote on the row. */
async function byMetaClient(
  tx: TxClient,
  spec: AuditEvent,
  s: Scope,
  hits: { id: string; entityId: string | null; metadata: unknown; createdAt: Date }[],
): Promise<Candidate[]> {
  const clientOf = (meta: Meta) => (typeof meta['clientId'] === 'string' ? meta['clientId'] : null);
  const ids = hits.flatMap((r) => clientOf(metaOf(r.metadata)) ?? []);
  const clients = new Map(
    (
      await tx.client.findMany({
        where: { businessId: s.businessId, id: { in: [...new Set(ids)] } },
        select: { id: true, displayName: true, accountType: true },
      })
    ).map((c) => [c.id, c]),
  );
  return hits.flatMap((r) => {
    const meta = metaOf(r.metadata);
    const client = clients.get(clientOf(meta) ?? '');
    if (!client) return [];
    return [
      {
        recordKind: spec.recordKind ?? spec.entity,
        recordId: r.entityId!,
        clientId: client.id,
        label: client.displayName,
        at: r.createdAt,
        occurrence: r.id,
        fields: { clientType: client.accountType, ...(spec.fieldsOf?.(meta) ?? {}) },
      },
    ];
  });
}

const metaOf = (value: unknown): Meta =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {};
