import type { TxClient } from '@firmivra/db';

/**
 * Audit Log Review 2, M01a: the readable name of each record the log names, looked up when the
 * log is read (lead decision 1a: nothing new is stored, so a renamed record shows its current
 * name). A record of a known type that is gone shows as "Deleted <type>"; a type not listed here,
 * or a record id that is not a UUID, has no name. Every read runs in the firm's business scope
 * and filters by the firm too, so only the firm's own records are ever named.
 */

type Named = { id: string; name: string };
type Finder = (tx: TxClient, businessId: string, ids: string[]) => Promise<Named[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const person = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim();

/** Each record type the log names, with the words for it ("compliance deadline"). */
const FINDERS: Record<string, { words: string; find: Finder }> = {
  client: {
    words: 'client',
    find: async (tx, businessId, ids) =>
      (
        await tx.client.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, displayName: true },
        })
      ).map((r) => ({ id: r.id, name: r.displayName })),
  },
  lead: {
    words: 'lead',
    find: async (tx, businessId, ids) =>
      (
        await tx.lead.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((r) => ({ id: r.id, name: person(r) })),
  },
  intake: {
    words: 'intake form',
    find: async (tx, businessId, ids) =>
      (
        await tx.intake.findMany({
          where: { businessId, id: { in: ids } },
          select: {
            id: true,
            form: { select: { title: true } },
            engagement: { select: { client: { select: { displayName: true } } } },
            lead: { select: { firstName: true, lastName: true } },
          },
        })
      ).map((r) => {
        const whose = r.engagement?.client.displayName ?? (r.lead ? person(r.lead) : null);
        return { id: r.id, name: whose ? `${r.form.title} (${whose})` : r.form.title };
      }),
  },
  task: {
    words: 'task',
    find: async (tx, businessId, ids) =>
      (
        await tx.task.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, title: true },
        })
      ).map((r) => ({ id: r.id, name: r.title })),
  },
  appointment: {
    words: 'appointment',
    find: async (tx, businessId, ids) =>
      (
        await tx.appointment.findMany({
          where: { businessId, id: { in: ids } },
          select: {
            id: true,
            type: { select: { name: true } },
            client: { select: { displayName: true } },
            lead: { select: { firstName: true, lastName: true } },
          },
        })
      ).map((r) => {
        const what = r.type?.name ?? 'Appointment';
        const whom = r.client?.displayName ?? (r.lead ? person(r.lead) : null);
        return { id: r.id, name: whom ? `${what} with ${whom}` : what };
      }),
  },
  invoice: {
    words: 'invoice',
    find: async (tx, businessId, ids) =>
      (
        await tx.invoice.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, number: true, client: { select: { displayName: true } } },
        })
      ).map((r) => ({ id: r.id, name: `Invoice ${r.number} (${r.client.displayName})` })),
  },
  engagement: {
    words: 'engagement',
    find: async (tx, businessId, ids) =>
      (
        await tx.engagement.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, title: true, client: { select: { displayName: true } } },
        })
      ).map((r) => ({ id: r.id, name: `${r.title} (${r.client.displayName})` })),
  },
  document: {
    words: 'document',
    find: async (tx, businessId, ids) =>
      (
        await tx.document.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, fileName: true },
        })
      ).map((r) => ({ id: r.id, name: r.fileName })),
  },
  tax_return: {
    words: 'tax return',
    find: async (tx, businessId, ids) =>
      (
        await tx.taxReturn.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, taxYear: true, client: { select: { displayName: true } } },
        })
      ).map((r) => ({ id: r.id, name: `${r.taxYear} return (${r.client.displayName})` })),
  },
  compliance_deadline: {
    words: 'compliance deadline',
    find: async (tx, businessId, ids) =>
      (
        await tx.complianceDeadline.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true, client: { select: { displayName: true } } },
        })
      ).map((r) => ({ id: r.id, name: `${r.name} (${r.client.displayName})` })),
  },
  compliance_rule: {
    words: 'applicability rule',
    find: async (tx, businessId, ids) =>
      (
        await tx.complianceApplicabilityRule.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  compliance_recurrence: {
    words: 'recurrence',
    find: async (tx, businessId, ids) =>
      (
        await tx.complianceRecurrence.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  membership: {
    words: 'team member',
    find: async (tx, businessId, ids) =>
      (
        await tx.membership.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, user: { select: { name: true } } },
        })
      ).map((r) => ({ id: r.id, name: r.user.name })),
  },
  client_account: {
    words: 'portal account',
    find: async (tx, businessId, ids) =>
      (
        await tx.clientAccount.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, email: true, client: { select: { displayName: true } } },
        })
      ).map((r) => ({ id: r.id, name: r.client?.displayName ?? r.email })),
  },
  firm_office: {
    words: 'location',
    find: async (tx, businessId, ids) =>
      (
        await tx.firmOffice.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  team: {
    words: 'team',
    find: async (tx, businessId, ids) =>
      (
        await tx.team.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  department: {
    words: 'department',
    find: async (tx, businessId, ids) =>
      (
        await tx.department.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  automation_rule: {
    words: 'automation',
    find: async (tx, businessId, ids) =>
      (
        await tx.automationRule.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  communication: {
    words: 'communication',
    find: async (tx, businessId, ids) =>
      (
        await tx.communication.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ id: r.id, name: r.name })),
  },
  message_thread: {
    words: 'message thread',
    find: async (tx, businessId, ids) =>
      (
        await tx.messageThread.findMany({
          where: { businessId, id: { in: ids } },
          select: { id: true, subject: true },
        })
      ).map((r) => ({ id: r.id, name: r.subject })),
  },
};

/** A record's name as the log shows it, and whether the record is gone. */
export interface RecordName {
  name: string;
  deleted: boolean;
}

/** `${type}:${id}` → its name, for the records of the rows that have one. */
export type RecordNames = ReadonlyMap<string, RecordName>;

export const recordKey = (type: string, id: string) => `${type}:${id.toLowerCase()}`;

/** The names of the rows' records, read in the firm's scope, one query per record type. */
export async function recordNames(
  tx: TxClient,
  businessId: string,
  rows: readonly { entityType: string; entityId: string | null }[],
): Promise<RecordNames> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.entityId || !UUID.test(row.entityId) || !FINDERS[row.entityType]) continue;
    const ids = byType.get(row.entityType) ?? new Set<string>();
    ids.add(row.entityId.toLowerCase());
    byType.set(row.entityType, ids);
  }
  const names = new Map<string, RecordName>();
  for (const [type, ids] of byType) {
    const finder = FINDERS[type]!;
    const found = new Map(
      (await finder.find(tx, businessId, [...ids])).map((r) => [r.id.toLowerCase(), r.name]),
    );
    for (const id of ids) {
      const name = found.get(id);
      names.set(
        recordKey(type, id),
        name === undefined
          ? { name: `Deleted ${finder.words}`, deleted: true }
          : { name, deleted: false },
      );
    }
  }
  return names;
}
