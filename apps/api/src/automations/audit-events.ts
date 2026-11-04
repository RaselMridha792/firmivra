import type { TxClient } from '@firmivra/db';
import type { FieldValue } from './logic.js';
import type { Candidate, Scope } from './matching.js';

// AU-F08 to F11 (Octavia's Oct 28 review): events that are a change the source module already
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
  entity: keyof typeof RESOLVERS;
  /** Only the rows whose metadata says so (a client update that changed the status). */
  when?: (meta: Meta) => boolean;
}

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

const changed = (field: string) => (meta: Meta) =>
  Array.isArray(meta['fields']) && (meta['fields'] as unknown[]).includes(field);

const RESOLVERS = {
  client: (async (tx, businessId, ids) => {
    const rows = await tx.client.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, displayName: true, accountType: true, status: true },
    });
    return new Map(
      rows.map((c) => [
        c.id,
        {
          clientId: c.id,
          label: c.displayName,
          fields: { clientType: c.accountType, status: c.status },
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
      },
    });
    return new Map(
      rows.map((l) => [
        l.id,
        {
          clientId: l.clientId,
          label: `${l.firstName} ${l.lastName}`.trim(),
          fields: { stage: l.status, source: l.source },
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
  const records = await RESOLVERS[spec.entity](tx, s.businessId, [
    ...new Set(hits.map((r) => r.entityId!)),
  ]);
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
        fields: record.fields,
      },
    ];
  });
}

const metaOf = (value: unknown): Meta =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {};
