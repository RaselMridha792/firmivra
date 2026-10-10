import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ESIGN_DEFAULT_CONSENT_MARKDOWN, type EsignField, type EsignPage } from '@firmivra/types';
import type {
  Database,
  EsignDocument as DocumentRow,
  EsignEvent as EventRow,
  EsignRecipient as RecipientRow,
  EsignRequest as RequestRow,
  Prisma,
  TxClient,
} from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';
import { FieldEncryption } from '../../field-encryption/field-encryption.service.js';
import type {
  EsignDocumentRecord,
  EsignEventRecord,
  EsignRecipientRecord,
  EsignRequestParts,
  EsignRequestRecord,
} from './esign.repository.js';

// What the Firm Sign Prisma repositories share (R13): the firm's transaction, the request lock,
// the row mappers and the field values' encryption. Every query runs in the firm's own scope
// (row-level security): forBusiness(businessId) or withScope({ kind: 'business' }), never the
// owner client. A KMS call never runs inside a transaction: values are sealed before it and
// opened after it.

/** An email to queue: a recipient's, or (staff updates) a member's. Never the address or link. */
export type QueuedEmail =
  { recipientId: string; template: string } | { userId: string; template: string };

/** What a request's FOR UPDATE lock reads. */
export interface LockedRequest {
  status: EsignRequestRecord['status'];
  lastActivityAt: Date;
}

/** The request row, locked FOR UPDATE until the transaction ends; null when the firm has none. */
export async function lockRequest(tx: TxClient, id: string): Promise<LockedRequest | null> {
  const [row] = await tx.$queryRaw<{ status: LockedRequest['status']; at: Date }[]>`
    SELECT status, last_activity_at AS at FROM esign_requests WHERE id = ${id}::uuid FOR UPDATE`;
  return row ? { status: row.status, lastActivityAt: row.at } : null;
}

/**
 * The next lastActivityAt: strictly later than `old` (by a millisecond at least), so a write in
 * between is always seen by the `readAt` checks.
 */
export const nextActivity = (old: Date, at = new Date()) =>
  new Date(Math.max(at.getTime(), old.getTime() + 1));

/** True when `readAt` is still the request's lastActivityAt. */
export const fresh = (locked: LockedRequest, readAt: Date) =>
  locked.lastActivityAt.getTime() === readAt.getTime();

export function toRequest(row: RequestRow): EsignRequestRecord {
  return {
    ...{ id: row.id, title: row.title, status: row.status, source: row.source },
    ...{ clientId: row.clientId, engagementId: row.engagementId, senderUserId: row.senderUserId },
    ...{ internalNote: row.internalNote, emailSubject: row.emailSubject },
    ...{ emailMessage: row.emailMessage, routing: row.routing, expiryDays: row.expiryDays },
    reminders: {
      firstAfterDays: row.reminderFirstAfterDays,
      everyDays: row.reminderEveryDays,
      max: row.reminderMax,
    },
    ...{ expiryWarningDays: row.expiryWarningDays, createdAt: row.createdAt },
    ...{ lastActivityAt: row.lastActivityAt, sentAt: row.sentAt, expiresAt: row.expiresAt },
    ...{ completedAt: row.completedAt, originalSha256: row.originalSha256 },
    ...{ expiredAt: row.expiredAt, voidedAt: row.voidedAt, voidReason: row.voidReason },
    ...{ voidedByUserId: row.voidedByUserId, replacesRequestId: row.replacesRequestId },
    ...{ replacedByRequestId: row.replacedByRequestId, expiryWarnedAt: row.expiryWarnedAt },
    template:
      row.templateId && row.templateVersion !== null
        ? { id: row.templateId, version: row.templateVersion }
        : null,
  };
}

/** The columns a request record writes (the reminders spread over their three columns). */
export function requestColumns<R extends Partial<EsignRequestRecord>>(r: R) {
  const { reminders, template, ...rest } = r;
  return {
    ...(rest as Omit<R, 'reminders' | 'template'>),
    ...(reminders && {
      reminderFirstAfterDays: reminders.firstAfterDays,
      reminderEveryDays: reminders.everyDays,
      reminderMax: reminders.max,
    }),
    ...(template !== undefined && {
      templateId: template?.id ?? null,
      templateVersion: template?.version ?? null,
    }),
  };
}

export function toRecipient(row: RecipientRow): EsignRecipientRecord {
  const link: EsignRecipientRecord['link'] =
    row.linkType === 'CLIENT_LOGIN'
      ? { type: 'CLIENT_LOGIN', clientAccountId: row.clientAccountId! }
      : row.linkType === 'STAFF'
        ? { type: 'STAFF', userId: row.staffUserId! }
        : { type: 'EXTERNAL' };
  return {
    ...{ id: row.id, kind: row.kind, role: row.role, roleLabel: row.roleLabel },
    ...{ routingOrder: row.routingOrder, name: row.name, email: row.email, phone: row.phone },
    link,
    delivery: row.delivery,
    authMethod: row.authMethod as EsignRecipientRecord['authMethod'],
    ...{ accessCodeHash: row.accessCodeHash, colorIndex: row.colorIndex, status: row.status },
    ...{ sentAt: row.sentAt, viewedAt: row.viewedAt, signedAt: row.signedAt },
    ...{ declinedAt: row.declinedAt, declineReason: row.declineReason },
    ...{ lastRemindedAt: row.lastRemindedAt, reminderCount: row.reminderCount },
  };
}

/** A recipient's columns, at `position` on the request. */
export function recipientColumns(r: EsignRecipientRecord, position: number) {
  const { link, ...rest } = r;
  return {
    ...rest,
    position,
    linkType: link.type,
    clientAccountId: link.type === 'CLIENT_LOGIN' ? link.clientAccountId : null,
    staffUserId: link.type === 'STAFF' ? link.userId : null,
  };
}

export function toDocument(row: DocumentRow): EsignDocumentRecord {
  return {
    ...{ id: row.id, position: row.position, fileName: row.fileName },
    contentType: row.contentType as EsignDocumentRecord['contentType'],
    ...{ sizeBytes: row.sizeBytes, pageCount: row.pageCount },
    pageSizes: row.pageSizes as EsignDocumentRecord['pageSizes'],
    ...{ sourceDocumentId: row.sourceDocumentId, scanStatus: row.scanStatus },
    ...{ createdAt: row.createdAt, s3Key: row.s3Key, sha256: row.sha256 },
  };
}

/** A document's columns (a scan result has its time; PENDING has none). */
export function documentColumns(d: Omit<EsignDocumentRecord, 'createdAt'> & { createdAt?: Date }) {
  return {
    ...d,
    pageSizes: d.pageSizes as Prisma.InputJsonValue,
    scannedAt: d.scanStatus === 'PENDING' ? null : (d.createdAt ?? new Date()),
  };
}

export function toEvent(row: EventRow): EsignEventRecord {
  return {
    ...{ id: row.id, type: row.type, createdAt: row.createdAt, actorKind: row.actorKind },
    actorName: row.actorName,
    recipient:
      row.recipientId && row.recipientName !== null
        ? { id: row.recipientId, name: row.recipientName }
        : null,
    ...{ reason: row.reason, authMethod: row.authMethod },
  };
}

/** Inserts timeline events (never a field value). */
export async function addEvents(
  tx: TxClient,
  businessId: string,
  requestId: string,
  events: EsignEventRecord[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.esignEvent.createMany({
    data: events.map(({ recipient, ...e }) => ({
      ...e,
      businessId,
      requestId,
      recipientId: recipient?.id ?? null,
      recipientName: recipient?.name ?? null,
      reason: e.reason?.trim() ? e.reason : null,
    })),
  });
}

/** Queues emails (esign_emails, QUEUED) and answers their ids, in order. */
export async function queueEmails(
  tx: TxClient,
  businessId: string,
  requestId: string,
  emails: readonly QueuedEmail[],
): Promise<string[]> {
  const rows = emails.map((e) => ({
    id: randomUUID(),
    businessId,
    requestId,
    template: e.template,
    recipientId: 'recipientId' in e ? e.recipientId : null,
    userId: 'userId' in e ? e.userId : null,
  }));
  if (rows.length > 0) await tx.esignEmail.createMany({ data: rows });
  return rows.map((r) => r.id);
}

/**
 * Stores links by their token's SHA-256, each at its recipient's current token_version: SIGN
 * (no expiry), COPY or IN_PERSON (until `expiresAt`).
 */
export async function addLinks(
  tx: TxClient,
  businessId: string,
  requestId: string,
  links: readonly { recipientId: string; tokenHash: string; expiresAt?: Date }[],
  purpose: 'SIGN' | 'COPY' | 'IN_PERSON',
): Promise<void> {
  if (links.length === 0) return;
  const versions = await tx.esignRecipient.findMany({
    where: { requestId, id: { in: links.map((l) => l.recipientId) } },
    select: { id: true, tokenVersion: true },
  });
  const version = new Map(versions.map((v) => [v.id, v.tokenVersion]));
  await tx.esignSigningLink.createMany({
    data: links.map((l) => ({
      ...{ businessId, requestId, recipientId: l.recipientId, tokenHash: l.tokenHash, purpose },
      tokenVersion: version.get(l.recipientId) ?? 0,
      expiresAt: l.expiresAt ?? null,
    })),
  });
}

/**
 * Publishes ESIGN_DEFAULT_CONSENT_MARKDOWN as version 1 when the firm has no consent version, in
 * the caller's transaction; its id when this call made it, else null. Two sends at once both try:
 * the unique (business_id, version) keeps one, and the other does nothing.
 */
export async function ensureDefaultConsent(
  tx: TxClient,
  businessId: string,
): Promise<string | null> {
  const body = ESIGN_DEFAULT_CONSENT_MARKDOWN;
  const sha = createHash('sha256').update(body, 'utf8').digest('hex');
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO esign_consent_versions (id, business_id, version, body_markdown, sha256)
    SELECT ${randomUUID()}::uuid, ${businessId}::uuid, 1, ${body}, ${sha}
    WHERE NOT EXISTS (SELECT 1 FROM esign_consent_versions WHERE business_id = ${businessId}::uuid)
    ON CONFLICT (business_id, version) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Sealed field values by field id (only the fields with a value). */
export type SealedValues = Map<string, Uint8Array<ArrayBuffer>>;

/** A field's columns at `position`, its value sealed (never the plain value). */
export function fieldColumns(f: EsignField, position: number, sealed: SealedValues) {
  const { value: _value, ...rest } = f;
  return { ...rest, position, valueEnc: sealed.get(f.id) ?? null };
}

/**
 * esign_fields.value_enc: each value encrypted with the firm's key (the field-encryption
 * helper), bound to the firm, the table, the field's id and the column. Never logged.
 */
@Injectable()
export class EsignFieldValues {
  constructor(@Inject(FieldEncryption) private readonly fe: FieldEncryption) {}

  private context(businessId: string, fieldId: string) {
    return { businessId, table: 'esign_fields', recordId: fieldId, field: 'value' };
  }

  /** Seals every given value (null and undefined ones are left out). Call before a transaction. */
  async seal(
    businessId: string,
    values: readonly { id: string; value: string | null | undefined }[],
  ): Promise<SealedValues> {
    const sealed: SealedValues = new Map();
    for (const { id, value } of values) {
      if (value !== null && value !== undefined) {
        sealed.set(id, await this.fe.encrypt(this.context(businessId, id), value));
      }
    }
    return sealed;
  }

  /** The value of one sealed field. Call after the transaction that read it. */
  open(businessId: string, fieldId: string, blob: Uint8Array): Promise<string> {
    return this.fe.decrypt(this.context(businessId, fieldId), blob);
  }
}

/**
 * Inserts a new DRAFT (a replacement, or one made from a template) with its own ids throughout:
 * the request, its documents, page plan, recipients and fields (values sealed before the
 * transaction) and its CREATED event. Answers it as written.
 */
export async function insertDraft(
  tx: TxClient,
  businessId: string,
  record: EsignRequestRecord,
  parts: EsignRequestParts,
  sealed: SealedValues,
  event: EsignEventRecord,
): Promise<EsignRequestRecord> {
  const row = await tx.esignRequest.create({
    data: {
      ...requestColumns(record),
      ...REMINDERS(record),
      businessId,
      pagePlan: planJson(parts.pagePlan),
    },
  });
  const requestId = row.id;
  if (parts.documents.length > 0) {
    await tx.esignDocument.createMany({
      data: parts.documents.map((d) => ({ ...documentColumns(d), businessId, requestId })),
    });
  }
  await saveRecipientRows(tx, businessId, requestId, parts.recipients, false);
  await replaceFields(tx, businessId, requestId, parts.fields, sealed);
  await addEvents(tx, businessId, requestId, [event]);
  return toRequest(row);
}

/** The reminders' three columns (required on insert). */
export const REMINDERS = ({ reminders: r }: Pick<EsignRequestRecord, 'reminders'>) => ({
  reminderFirstAfterDays: r.firstAfterDays,
  reminderEveryDays: r.everyDays,
  reminderMax: r.max,
});

/**
 * Makes the request's recipients `recipients`, in that order: those no longer listed are removed
 * (their fields, approval notes and links go with them), the others updated in place, new ones
 * added. `existing`: false for a request that has none yet.
 */
export async function saveRecipientRows(
  tx: TxClient,
  businessId: string,
  requestId: string,
  recipients: readonly EsignRecipientRecord[],
  existing = true,
): Promise<void> {
  const ids = recipients.map((r) => r.id);
  const known = new Set<string>();
  if (existing) {
    await tx.esignRecipient.deleteMany({ where: { requestId, id: { notIn: ids } } });
    const rows = await tx.esignRecipient.findMany({ where: { requestId }, select: { id: true } });
    for (const r of rows) known.add(r.id);
  }
  for (const [position, r] of recipients.entries()) {
    const data = recipientColumns(r, position);
    if (known.has(r.id)) {
      await tx.esignRecipient.update({ where: { id: r.id }, data });
    } else {
      await tx.esignRecipient.create({ data: { ...data, businessId, requestId } });
    }
  }
}

/** Replaces the request's fields with `fields`, in that order. */
export async function replaceFields(
  tx: TxClient,
  businessId: string,
  requestId: string,
  fields: readonly EsignField[],
  sealed: SealedValues,
): Promise<void> {
  await tx.esignField.deleteMany({ where: { requestId } });
  if (fields.length === 0) return;
  await tx.esignField.createMany({
    data: fields.map((f, i) => ({ ...fieldColumns(f, i, sealed), businessId, requestId })),
  });
}

/** The page plan as stored (JSON). */
export const planJson = (plan: readonly EsignPage[]) => plan as unknown as Prisma.InputJsonValue;

/** Runs `fn` in one transaction in the firm's scope. */
export function inFirm<T>(
  database: Database,
  businessId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return database.withScope({ kind: 'business', businessId }, fn);
}

/** The Database, for the repositories' constructors. */
export const InjectDatabase = () => Inject(DATABASE);

/** Thrown inside a transaction to roll it back and answer `code` (refusable() catches it). */
export class Refused<C extends string> extends Error {
  constructor(readonly code: C) {
    super(code);
  }
}

/** Runs `work`; a Refused thrown in it (its transaction rolled back) answers its code. */
export async function refusable<T, C extends string = never>(
  work: () => Promise<T>,
): Promise<T | C> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refused) return error.code as C;
    throw error;
  }
}
