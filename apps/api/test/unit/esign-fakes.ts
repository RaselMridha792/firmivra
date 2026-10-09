// In-memory stand-ins for Firm Sign's ports (R13), keyed by firm so isolation is real: a firm
// only ever sees its own rows. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import {
  ESIGN_MAX_PAGES,
  type EsignAccessRole,
  type EsignDefaults,
  type EsignField,
  type EsignPage,
} from '@firmivra/types';
import type { BusinessModules, FirmModule } from '../../src/common/modules/requires-module.js';
import {
  EsignEngineError,
  type InspectedFile,
  type PdfEngine,
} from '../../src/esign/engine/engine.types.js';
import { MemoryEsignStore } from '../../src/esign/engine/esign-store.js';
import type {
  DirectoryClient,
  DirectoryClientContact,
  DirectoryDocument,
  DirectoryEngagement,
  DirectoryFirm,
  DirectoryLogin,
  DirectoryMember,
  EsignDirectory,
} from '../../src/esign/requests/esign-directory.js';
import type {
  EsignDocumentRecord,
  EsignDraftPatch,
  EsignEventRecord,
  EsignListAfter,
  EsignListedRequest,
  EsignPendingUpload,
  EsignRecipientRecord,
  EsignRepository,
  EsignRequestParts,
  EsignRequestFilter,
  EsignRequestRecord,
  EsignSendWrite,
  NewEsignDocument,
  NewEsignRequest,
} from '../../src/esign/requests/esign.repository.js';
import { ESIGN_OPEN_STATUSES, type EsignRequestStatus } from '@firmivra/types';
import { NotifyDeliveryError } from '../../src/notify/notify.service.js';
import { expiryDue, reminderDue, warningDue } from '../../src/esign/lifecycle/lifecycle.job.js';
import type { NotifyMessage, NotifyService } from '../../src/notify/notify.types.js';
import type {
  CorrectWrite,
  EsignLifecycleRepository,
  IssuedLink,
  LifecycleEmail,
  LifecycleWrite,
  LifecycleWritten,
  RemindWrite,
  Replacement,
  VoidWrite,
} from '../../src/esign/lifecycle/lifecycle.repository.js';
import type {
  EsignListedTemplate,
  EsignTemplateContent,
  EsignTemplateDraft,
  EsignTemplateFilter,
  EsignTemplatePatch,
  EsignTemplateRecord,
  EsignTemplateRepository,
  EsignTemplateVersionRecord,
  NewEsignTemplate,
} from '../../src/esign/templates/templates.repository.js';

export const ESIGN_TEST_DEFAULTS: EsignDefaults = {
  expiryDays: 30,
  reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
  expiryWarningDays: 2,
  authMethod: 'EMAIL_CODE',
  requireApproval: false,
  emailMessage: 'Please review and sign.',
};

export interface Row {
  record: EsignRequestRecord;
  parts: EsignRequestParts;
}

/** Map of firm id to its own map, created on first use. */
class PerFirm<T> {
  private readonly firms = new Map<string, Map<string, T>>();
  of(businessId: string): Map<string, T> {
    let firm = this.firms.get(businessId);
    if (!firm) this.firms.set(businessId, (firm = new Map()));
    return firm;
  }
}

export class InMemoryEsignRepository implements EsignRepository {
  private readonly rows = new PerFirm<Row>();
  /** Each firm's members' Firm Sign access. */
  readonly roles = new PerFirm<EsignAccessRole>();
  /** Set to make the next draft write find the request no longer a DRAFT (a send that won). */
  loseNextWrite = false;

  /** Each firm's Signing Settings defaults (ESIGN_TEST_DEFAULTS unless set). */
  readonly firmDefaults = new Map<string, EsignDefaults>();
  /** The firms that have published a consent version. */
  readonly consent = new Set<string>();
  /** Each firm's timelines, by request id (test set-up writes them). */
  readonly timelines = new PerFirm<EsignEventRecord[]>();

  /** The directory stands in for the joins (client assignment and names, sender names). */
  constructor(private readonly directory?: InMemoryDirectory) {}

  async listRequests(
    businessId: string,
    filter: EsignRequestFilter,
    page: { after: EsignListAfter | null; limit: number },
  ): Promise<EsignListedRequest[]> {
    const { after, limit } = page;
    const rows = (await this.matching(businessId, filter))
      .sort(
        (x, y) =>
          y.record.lastActivityAt.getTime() - x.record.lastActivityAt.getTime() ||
          y.record.id.localeCompare(x.record.id),
      )
      .filter(
        ({ record: r }) =>
          !after ||
          r.lastActivityAt < after.lastActivityAt ||
          (r.lastActivityAt.getTime() === after.lastActivityAt.getTime() && r.id < after.id),
      );
    return structuredClone(
      rows.slice(0, limit).map((x) => ({ record: x.record, recipients: x.parts.recipients })),
    );
  }

  async countRequests(businessId: string, filter: EsignRequestFilter) {
    const counts: Partial<Record<EsignRequestStatus, number>> = {};
    for (const { record } of await this.matching(businessId, filter)) {
      counts[record.status] = (counts[record.status] ?? 0) + 1;
    }
    return counts;
  }

  events(businessId: string, id: string): Promise<EsignEventRecord[]> {
    return Promise.resolve(structuredClone(this.timelines.of(businessId).get(id) ?? []));
  }

  /** The firm's rows that match, as the SQL would select them. */
  private async matching(businessId: string, f: EsignRequestFilter): Promise<Row[]> {
    const dir = this.directory;
    if (!dir) throw new Error('InMemoryEsignRepository needs the directory to list');
    const matches = async ({ record: r, parts }: Row) => {
      const client = r.clientId ? await dir.client(businessId, r.clientId) : null;
      const sender = await dir.member(businessId, r.senderUserId);
      const approver = (userId: string, pending: boolean) =>
        parts.recipients.some(
          (x) =>
            x.kind === 'APPROVER' &&
            x.link.type === 'STAFF' &&
            x.link.userId === userId &&
            (!pending || x.status !== 'APPROVED'),
        );
      const within = (d: Date | null, from?: Date, before?: Date) =>
        (!from || (d !== null && d >= from)) && (!before || (d !== null && d < before));
      const search = f.search?.toLowerCase();
      const names = [
        r.title,
        client?.displayName ?? '',
        sender?.name ?? '',
        ...parts.recipients.filter((x) => x.kind === 'SIGNER').map((x) => x.name),
      ];
      return (
        (f.visibleTo === null ||
          r.senderUserId === f.visibleTo ||
          client?.assignedUserId === f.visibleTo ||
          approver(f.visibleTo, false)) &&
        (!f.statuses || f.statuses.includes(r.status)) &&
        (!f.clientId || r.clientId === f.clientId) &&
        (!f.senderUserId || r.senderUserId === f.senderUserId) &&
        within(r.lastActivityAt, f.lastActivityFrom, f.lastActivityBefore) &&
        within(r.expiresAt, f.expiresFrom, f.expiresBefore) &&
        within(r.completedAt, f.completedFrom) &&
        (!f.pendingApprover || approver(f.pendingApprover, true)) &&
        (!search || names.some((n) => n.toLowerCase().includes(search)))
      );
    };
    const rows = [...this.rows.of(businessId).values()];
    const keep = await Promise.all(rows.map(matches));
    return rows.filter((_, i) => keep[i]);
  }

  defaults(businessId?: string): Promise<EsignDefaults> {
    const own = businessId === undefined ? undefined : this.firmDefaults.get(businessId);
    return Promise.resolve(structuredClone(own ?? ESIGN_TEST_DEFAULTS));
  }

  consentPublished(businessId: string): Promise<boolean> {
    return Promise.resolve(this.consent.has(businessId));
  }

  saveFields(businessId: string, id: string, fields: EsignField[], readAt: Date) {
    return this.written(
      businessId,
      id,
      (row) => Object.assign(row.parts, structuredClone({ fields })),
      readAt,
    );
  }

  createRequest(businessId: string, input: NewEsignRequest): Promise<EsignRequestRecord> {
    const now = new Date();
    const record: EsignRequestRecord = {
      ...structuredClone(input),
      id: randomUUID(),
      status: 'DRAFT',
      createdAt: now,
      lastActivityAt: now,
      sentAt: null,
      expiresAt: null,
      completedAt: null,
      originalSha256: null,
      expiredAt: null,
      voidedAt: null,
      voidReason: null,
      voidedByUserId: null,
      replacesRequestId: null,
      replacedByRequestId: null,
      expiryWarnedAt: null,
      template: null,
    };
    const parts = { documents: [], pagePlan: [], recipients: [], fields: [] };
    this.rows.of(businessId).set(record.id, { record, parts });
    return Promise.resolve(structuredClone(record));
  }

  esignRole(businessId: string, userId: string): Promise<EsignAccessRole | null> {
    return Promise.resolve(this.roles.of(businessId).get(userId) ?? null);
  }

  findRequest(businessId: string, id: string): Promise<EsignRequestRecord | null> {
    const row = this.rows.of(businessId).get(id);
    return Promise.resolve(row ? structuredClone(row.record) : null);
  }

  parts(businessId: string, id: string): Promise<EsignRequestParts> {
    const row = this.rows.of(businessId).get(id);
    const empty = { documents: [], pagePlan: [], recipients: [], fields: [] };
    return Promise.resolve(structuredClone(row?.parts ?? empty));
  }

  async updateDraft(
    businessId: string,
    id: string,
    patch: EsignDraftPatch,
    options: { clientChange?: boolean } = {},
  ): Promise<EsignRequestRecord | 'INVALID_STATE' | 'RECIPIENTS_LINKED'> {
    const row = this.rows.of(businessId).get(id);
    const linked = row?.parts.recipients.some((r) => r.link.type === 'CLIENT_LOGIN');
    if (row?.record.status === 'DRAFT' && options.clientChange && linked) {
      return 'RECIPIENTS_LINKED';
    }
    const written = await this.write(businessId, id, (r) =>
      Object.assign(r.record, structuredClone(patch)),
    );
    return written && row ? structuredClone(row.record) : 'INVALID_STATE';
  }

  async deleteDraft(businessId: string, id: string) {
    const docs = this.rows.of(businessId).get(id)?.parts.documents ?? [];
    const gone = docs.map(({ id: docId, s3Key }) => ({ id: docId, s3Key }));
    const deleted = await this.write(businessId, id, () => this.rows.of(businessId).delete(id));
    return deleted ? gone : null;
  }

  savePagePlan(
    businessId: string,
    id: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ) {
    return this.written(
      businessId,
      id,
      (row) => Object.assign(row.parts, structuredClone({ pagePlan, fields })),
      readAt,
    );
  }

  saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
    fields: EsignField[],
    readAt: Date,
  ) {
    return this.written(
      businessId,
      id,
      (row) => Object.assign(row.parts, structuredClone({ recipients, fields })),
      readAt,
    );
  }

  /** Each firm's stored link-token hashes, by recipient id (only hashes, as the table). */
  readonly tokenHashes = new PerFirm<string>();
  /** Each firm's queued Firm Sign emails, by id. */
  readonly outbox = new PerFirm<{
    /** A recipient's email, or (staff updates) a member's. */
    recipientId?: string;
    userId?: string;
    template: string;
    status: 'QUEUED' | 'SENT' | 'FAILED';
    error: string | null;
  }>();

  sendDraft(
    businessId: string,
    id: string,
    write: EsignSendWrite,
    readAt: Date,
  ): Promise<{ request: EsignRequestRecord; emailIds: string[] } | null> {
    const row = this.rows.of(businessId).get(id);
    if (
      row?.record.status !== 'DRAFT' ||
      row.record.lastActivityAt.getTime() !== readAt.getTime()
    ) {
      return Promise.resolve(null);
    }
    Object.assign(row.record, {
      status: 'SENT',
      sentAt: write.sentAt,
      expiresAt: write.expiresAt,
      originalSha256: write.originalSha256,
      // Strictly later than the value it replaces, as every write.
      lastActivityAt: new Date(
        Math.max(write.sentAt.getTime(), row.record.lastActivityAt.getTime() + 1),
      ),
    });
    for (const t of write.turn) {
      const r = row.parts.recipients.find((x) => x.id === t.recipientId);
      if (r) Object.assign(r, { status: 'SENT', sentAt: write.sentAt });
      if (t.tokenHash) this.tokenHashes.of(businessId).set(t.recipientId, t.tokenHash);
    }
    const timeline = this.timelines.of(businessId);
    timeline.set(id, [...(timeline.get(id) ?? []), structuredClone(write.event)]);
    const ids = write.emails.map((e) => {
      const emailId = randomUUID();
      this.outbox.of(businessId).set(emailId, { ...e, status: 'QUEUED', error: null });
      return emailId;
    });
    return Promise.resolve({ request: structuredClone(row.record), emailIds: ids });
  }

  emailOutcome(
    businessId: string,
    emailId: string,
    outcome: { sent: true } | { sent: false; error: string },
  ): Promise<void> {
    const email = this.outbox.of(businessId).get(emailId);
    if (email) {
      email.status = outcome.sent ? 'SENT' : 'FAILED';
      email.error = outcome.sent ? null : outcome.error;
    }
    return Promise.resolve();
  }

  /** Each firm's started uploads, by token hash. */
  readonly uploads = new PerFirm<EsignPendingUpload>();

  saveUpload(businessId: string, upload: EsignPendingUpload): Promise<void> {
    this.uploads.of(businessId).set(upload.tokenHash, structuredClone(upload));
    return Promise.resolve();
  }

  takeUpload(businessId: string, requestId: string, userId: string, tokenHash: string) {
    const found = this.uploads.of(businessId).get(tokenHash);
    if (found?.requestId !== requestId || found.userId !== userId) return Promise.resolve(null);
    this.uploads.of(businessId).delete(tokenHash);
    return Promise.resolve(found);
  }

  async addDocument(
    businessId: string,
    id: string,
    document: NewEsignDocument,
  ): Promise<EsignDocumentRecord | 'NOT_DRAFT' | 'TOO_MANY_PAGES'> {
    const pages = this.rows.of(businessId).get(id)?.parts.pagePlan.length ?? 0;
    if (pages + document.pageCount > ESIGN_MAX_PAGES) return 'TOO_MANY_PAGES';
    let added: EsignDocumentRecord | undefined;
    const ok = await this.write(businessId, id, (row) => {
      added = { ...structuredClone(document), position: row.parts.documents.length };
      row.parts.documents.push(added);
      for (let page = 0; page < document.pageCount; page++) {
        row.parts.pagePlan.push({ documentId: document.id, page, rotation: 0 });
      }
    });
    return ok && added ? structuredClone(added) : 'NOT_DRAFT';
  }

  removeDocument(
    businessId: string,
    id: string,
    documentId: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ) {
    return this.written(
      businessId,
      id,
      (row) => {
        row.parts.documents = row.parts.documents.filter((d) => d.id !== documentId);
        Object.assign(row.parts, structuredClone({ pagePlan, fields }));
      },
      readAt,
    );
  }

  /** The stored row itself, read and changed synchronously (as under a lock); lifecycle fake. */
  peek(businessId: string, id: string): Row | undefined {
    return this.rows.of(businessId).get(id);
  }

  insert(businessId: string, row: Row): void {
    this.rows.of(businessId).set(row.record.id, structuredClone(row));
  }

  /** Test set-up: change a stored request directly (status, documents, fields...). */
  seed(businessId: string, id: string, change: (row: Row) => void): void {
    const row = this.rows.of(businessId).get(id);
    if (!row) throw new Error('no such request');
    change(row);
  }

  /** A write that answers the request as written, or null when refused. */
  private async written(
    businessId: string,
    id: string,
    change: (row: Row) => unknown,
    readAt: Date,
  ): Promise<EsignRequestRecord | null> {
    if (!(await this.write(businessId, id, change, readAt))) return null;
    const row = this.rows.of(businessId).get(id);
    return row ? structuredClone(row.record) : null;
  }

  private write(
    businessId: string,
    id: string,
    change: (row: Row) => unknown,
    readAt?: Date,
  ): Promise<boolean> {
    const row = this.rows.of(businessId).get(id);
    if (!row || row.record.status !== 'DRAFT') return Promise.resolve(false);
    if (readAt && row.record.lastActivityAt.getTime() !== readAt.getTime()) {
      return Promise.resolve(false);
    }
    if (this.loseNextWrite) {
      // Cleared only when it caused the refusal, so it waits for a write that would have applied.
      this.loseNextWrite = false;
      return Promise.resolve(false);
    }
    // Strictly later than the last write, so a stale readAt is always seen.
    const last = row.record.lastActivityAt.getTime();
    row.record.lastActivityAt = new Date(Math.max(Date.now(), last + 1));
    change(row);
    // An edit asks for approval again.
    for (const r of row.parts.recipients) if (r.kind === 'APPROVER') r.status = 'WAITING';
    return Promise.resolve(true);
  }
}

/** Lifecycle writes over the requests fake: each checks and writes in one synchronous step. */
export class InMemoryLifecycleRepository implements EsignLifecycleRepository {
  /** Each firm's signing links by token hash, with the token_version they were issued at. */
  readonly links = new PerFirm<{ requestId: string; recipientId: string; tokenVersion: number }>();
  /** Each firm's recipients' token_version (0 unless raised). */
  readonly tokenVersions = new PerFirm<number>();

  constructor(private readonly requests: InMemoryEsignRepository) {}

  remind(businessId: string, id: string, write: RemindWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (row) => {
      for (const r of row.parts.recipients) {
        if (!write.recipientIds.includes(r.id)) continue;
        r.lastRemindedAt = write.at;
        r.reminderCount += 1;
      }
      for (const l of write.links) this.link(businessId, id, l);
    });
  }

  warn(businessId: string, id: string, write: RemindWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (row) => {
      row.record.expiryWarnedAt = write.at;
      for (const l of write.links) this.link(businessId, id, l);
    });
  }

  expire(businessId: string, id: string, write: LifecycleWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (row) =>
      Object.assign(row.record, { status: 'EXPIRED', expiredAt: write.at }),
    );
  }

  /** The job's firms (ACTIVE with Firm Sign on). */
  readonly firmIds: string[] = [];
  /** Set while another task holds the job's lock. */
  lockedElsewhere = false;

  withJobLock<T>(work: () => Promise<T>): Promise<T | null> {
    return this.lockedElsewhere ? Promise.resolve(null) : work();
  }

  firms() {
    return Promise.resolve([...this.firmIds]);
  }

  /** As the SQL would select them, with the job's own rules. */
  async due(businessId: string, now: Date, limit: number) {
    const open = { visibleTo: null, statuses: ESIGN_OPEN_STATUSES };
    const rows = await this.requests.listRequests(businessId, open, { after: null, limit: 1000 });
    return rows
      .filter(
        ({ record: q, recipients: rs }) =>
          expiryDue(q, rs, now) || warningDue(q, now) || rs.some((r) => reminderDue(q, r, now)),
      )
      .sort((x, y) => +x.record.expiresAt! - +y.record.expiresAt!)
      .slice(0, limit)
      .map((x) => x.record.id);
  }

  void(businessId: string, id: string, write: VoidWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (row) => voided(row, write));
  }

  correct(businessId: string, id: string, write: CorrectWrite, readAt: Date) {
    return this.apply(businessId, id, write, readAt, (row) => {
      const r = row.parts.recipients.find((x) => x.id === write.recipientId);
      if (r) Object.assign(r, structuredClone(write.patch));
      const versions = this.tokenVersions.of(businessId);
      versions.set(write.recipientId, (versions.get(write.recipientId) ?? 0) + 1);
      if (write.link) this.link(businessId, id, write.link);
    });
  }

  async replace(
    businessId: string,
    id: string,
    write: VoidWrite & { replacement: Replacement },
    readAt: Date,
  ) {
    const { record, parts, event } = write.replacement;
    const written = await this.apply(businessId, id, write, readAt, (row) => {
      voided(row, write);
      row.record.replacedByRequestId = record.id;
      this.requests.insert(businessId, { record, parts });
      this.requests.timelines.of(businessId).set(record.id, [structuredClone(event)]);
    });
    return written && { ...written, created: structuredClone(record) };
  }

  /** The link's recipient, while its request is open and its version is the recipient's. */
  findLink(businessId: string, tokenHash: string): string | null {
    const link = this.links.of(businessId).get(tokenHash);
    const row = link && this.requests.peek(businessId, link.requestId);
    if (!link || !row || !ESIGN_OPEN_STATUSES.some((s) => s === row.record.status)) return null;
    const version = this.tokenVersions.of(businessId).get(link.recipientId) ?? 0;
    return link.tokenVersion === version ? link.recipientId : null;
  }

  private link(businessId: string, requestId: string, l: IssuedLink) {
    const tokenVersion = this.tokenVersions.of(businessId).get(l.recipientId) ?? 0;
    const link = { requestId, recipientId: l.recipientId, tokenVersion };
    this.links.of(businessId).set(l.tokenHash, link);
  }

  private apply(
    businessId: string,
    id: string,
    write: { at: Date; events: EsignEventRecord[]; emails: LifecycleEmail[] },
    readAt: Date,
    change: (row: Row) => void,
  ): Promise<LifecycleWritten | null> {
    const row = this.requests.peek(businessId, id);
    if (!row || row.record.lastActivityAt.getTime() !== readAt.getTime()) {
      return Promise.resolve(null);
    }
    change(row);
    const last = row.record.lastActivityAt.getTime();
    row.record.lastActivityAt = new Date(Math.max(write.at.getTime(), last + 1));
    const timeline = this.requests.timelines.of(businessId);
    timeline.set(id, [...(timeline.get(id) ?? []), ...structuredClone(write.events)]);
    const outbox = this.requests.outbox.of(businessId);
    const emailIds = write.emails.map((e) => {
      const emailId = randomUUID();
      outbox.set(emailId, { ...e, status: 'QUEUED', error: null });
      return emailId;
    });
    return Promise.resolve({ request: structuredClone(row.record), emailIds });
  }
}

function voided(row: Row, write: VoidWrite) {
  Object.assign(row.record, {
    status: 'VOIDED',
    voidedAt: write.at,
    voidReason: write.reason,
    voidedByUserId: write.byUserId,
  });
}

/** A firm's clients, services, portal logins and members. */
export class InMemoryDirectory implements EsignDirectory {
  readonly clients = new PerFirm<DirectoryClient>();
  readonly engagements = new PerFirm<DirectoryEngagement>();
  readonly logins = new PerFirm<DirectoryLogin>();
  readonly members = new PerFirm<DirectoryMember>();
  readonly documents = new PerFirm<DirectoryDocument>();
  readonly contacts = new PerFirm<DirectoryClientContact>();
  readonly firms = new Map<string, DirectoryFirm>();

  client(businessId: string, id: string) {
    return Promise.resolve(this.clients.of(businessId).get(id) ?? null);
  }
  engagement(businessId: string, id: string) {
    return Promise.resolve(this.engagements.of(businessId).get(id) ?? null);
  }
  clientLogin(businessId: string, id: string) {
    return Promise.resolve(this.logins.of(businessId).get(id) ?? null);
  }
  clientLogins(businessId: string, clientId: string) {
    const all = [...this.logins.of(businessId).values()];
    return Promise.resolve(all.filter((l) => l.clientId === clientId));
  }
  member(businessId: string, userId: string) {
    return Promise.resolve(this.members.of(businessId).get(userId) ?? null);
  }
  document(businessId: string, id: string) {
    return Promise.resolve(this.documents.of(businessId).get(id) ?? null);
  }
  clientContact(businessId: string, id: string) {
    return Promise.resolve(this.contacts.of(businessId).get(id) ?? null);
  }
  firm(businessId: string) {
    const firm = this.firms.get(businessId);
    return firm ? Promise.resolve(firm) : Promise.reject(new Error('no such firm'));
  }
}

export class InMemoryModules implements BusinessModules {
  private readonly on = new Set<string>();
  set(businessId: string, module: FirmModule, enabled: boolean): void {
    if (enabled) this.on.add(`${businessId}:${module}`);
    else this.on.delete(`${businessId}:${module}`);
  }
  isEnabled(businessId: string, module: FirmModule): Promise<boolean> {
    return Promise.resolve(this.on.has(`${businessId}:${module}`));
  }
}

export class FakeAudit {
  readonly entries: {
    action: string;
    entity: { type: string; id?: string };
    metadata?: unknown;
    /** The firm a job names (no request context); absent from a route. */
    at?: { businessId?: string };
  }[] = [];
  log(
    action: string,
    entity: { type: string; id?: string },
    metadata?: Record<string, unknown>,
    at?: { businessId?: string },
  ) {
    this.entries.push({ action, entity, metadata, ...(at && { at }) });
    return Promise.resolve();
  }
}

/** R18's in-memory store, recording what is removed. */
export class FakeStore extends MemoryEsignStore {
  readonly removed: { businessId: string; key: string }[] = [];
  override remove(businessId: string, key: string): Promise<void> {
    this.removed.push({ businessId, key });
    return super.remove(businessId, key);
  }
}

/**
 * A PDF engine for tests: a "PDF" is the text `pdf:<pages>`, or `encrypted` or anything else
 * (unreadable); an image is one page of 600x400.
 */
export const fakePdf: Pick<PdfEngine, 'inspect' | 'compose'> = {
  /** The packet: `packet:` and each planned page as `<documentId>/<page>/<rotation>`. */
  compose: (files, plan) => {
    const known = new Set(files.map((f) => f.documentId));
    if (plan.some((p) => !known.has(p.documentId))) {
      return Promise.reject(new EsignEngineError('PDF_UNREADABLE'));
    }
    const pages = plan.map((p) => `${p.documentId}/${p.page}/${p.rotation}`).join(',');
    return Promise.resolve(new Uint8Array(Buffer.from(`packet:${pages}`)));
  },
  inspect: ({ contentType, bytes }): Promise<InspectedFile> => {
    if (contentType !== 'application/pdf') {
      return Promise.resolve({ pageCount: 1, pageSizes: [{ width: 600, height: 400 }] });
    }
    const text = Buffer.from(bytes).toString();
    if (text === 'encrypted') return Promise.reject(new EsignEngineError('PDF_ENCRYPTED'));
    const pages = /^pdf:(\d+)$/.exec(text);
    if (!pages) return Promise.reject(new EsignEngineError('PDF_UNREADABLE'));
    const pageCount = Number(pages[1]);
    if (pageCount > ESIGN_MAX_PAGES) return Promise.reject(new EsignEngineError('TOO_MANY_PAGES'));
    const pageSizes = Array.from({ length: pageCount }, () => ({ width: 612, height: 792 }));
    return Promise.resolve({ pageCount, pageSizes });
  },
};

/** CodeHasher.hash in the engine's shape (an HMAC there; a plain hash is enough here). */
export const fakeHasher = {
  hash: (recipientId: string, kind: string, code: string) =>
    createHash('sha256').update(`${recipientId}:${kind}:${code}`).digest('hex'),
};

/**
 * Two firms. Firm A: owner, admin, a Firm Sign manager, staff (c1 is assigned to them), staff2
 * (nothing assigned) and a deactivated member; client c1 with PRIMARY, SPOUSE, AUTHORIZED and DISABLED logins and an
 * ACTIVE, a PENDING and a COMPLETED service; client c2 (unassigned, own login and service); an
 * archived client. Firm B: its owner, client and login. Firm Sign is on for both.
 */
export function esignWorld() {
  const id = () => randomUUID();
  const a = id();
  const b = id();
  const users = {
    ownerA: id(),
    adminA: id(),
    managerA: id(),
    staffA: id(),
    staffA2: id(),
    goneA: id(),
    ownerB: id(),
  };
  const ids = {
    c1: id(),
    c2: id(),
    archived: id(),
    cB: id(),
    e1: id(),
    e1Pending: id(),
    e1Done: id(),
    e2: id(),
    eB: id(),
    primary: id(),
    spouse: id(),
    authorized: id(),
    disabled: id(),
    c2Login: id(),
    loginB: id(),
  };
  const directory = new InMemoryDirectory();
  const member = (firm: string, userId: string, name: string, active = true) =>
    directory.members.of(firm).set(userId, {
      userId,
      name,
      email: `${name}@firm.test`,
      phone: '+15555550100',
      jobTitle: null,
      active,
    });
  member(a, users.ownerA, 'owner-a');
  member(a, users.adminA, 'admin-a');
  member(a, users.managerA, 'manager-a');
  member(a, users.staffA, 'staff-a');
  member(a, users.staffA2, 'staff-a2');
  member(a, users.goneA, 'gone-a', false);
  member(b, users.ownerB, 'owner-b');
  const client = (
    firm: string,
    cid: string,
    name: string,
    assigned: string | null,
    archived = false,
  ) =>
    directory.clients
      .of(firm)
      .set(cid, { id: cid, displayName: name, assignedUserId: assigned, archived });
  client(a, ids.c1, 'Fake Client One', users.staffA);
  for (const [firm, cid, name] of [
    [a, ids.c1, 'Fake Client One'],
    [a, ids.c2, 'Fake Client Two'],
    [b, ids.cB, 'Fake Client B'],
  ] as const) {
    directory.contacts.of(firm).set(cid, {
      displayName: name,
      accountType: 'INDIVIDUAL',
      firstName: 'Fake',
      lastName: name.slice(5),
      businessName: null,
      email: `${cid.slice(0, 8)}@client.test`,
      phone: '+15555550111',
      address: '1 Sample St, Testville, NY 10001',
      spouseName: null,
    });
  }
  const firmOf = (name: string): DirectoryFirm => ({
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    address: '2 Example Ave, Testville, NY 10002',
    phone: '+15555550123',
    email: 'office@firm.test',
    timeZone: 'America/New_York',
  });
  directory.firms.set(a, firmOf('Fake Firm A'));
  directory.firms.set(b, firmOf('Fake Firm B'));
  client(a, ids.c2, 'Fake Client Two', null);
  client(a, ids.archived, 'Fake Archived', users.staffA, true);
  client(b, ids.cB, 'Fake Client B', null);
  const service = (
    firm: string,
    eid: string,
    clientId: string,
    status: DirectoryEngagement['status'],
  ) =>
    directory.engagements
      .of(firm)
      .set(eid, { id: eid, clientId, title: `Service ${status}`, status });
  service(a, ids.e1, ids.c1, 'ACTIVE');
  service(a, ids.e1Pending, ids.c1, 'PENDING');
  service(a, ids.e1Done, ids.c1, 'COMPLETED');
  service(a, ids.e2, ids.c2, 'ACTIVE');
  service(b, ids.eB, ids.cB, 'ACTIVE');
  const login = (
    firm: string,
    lid: string,
    clientId: string,
    portalRole: DirectoryLogin['portalRole'],
    status: DirectoryLogin['status'] = 'ACTIVE',
  ) =>
    directory.logins.of(firm).set(lid, {
      id: lid,
      clientId,
      portalRole,
      status,
      name: `Fake ${portalRole.toLowerCase()}`,
      email: `${lid.slice(0, 8)}@client.test`,
    });
  login(a, ids.primary, ids.c1, 'PRIMARY');
  login(a, ids.spouse, ids.c1, 'SPOUSE');
  login(a, ids.authorized, ids.c1, 'AUTHORIZED');
  login(a, ids.disabled, ids.c1, 'PRIMARY', 'DISABLED');
  login(a, ids.c2Login, ids.c2, 'PRIMARY');
  login(b, ids.loginB, ids.cB, 'PRIMARY');
  const repo = new InMemoryEsignRepository(directory);
  const roles: [string, string, EsignAccessRole][] = [
    [a, users.ownerA, 'OWNER'],
    [a, users.adminA, 'ADMIN'],
    [a, users.managerA, 'MANAGER'],
    [a, users.staffA, 'STAFF'],
    [a, users.staffA2, 'STAFF'],
    [a, users.goneA, 'STAFF'],
    [b, users.ownerB, 'OWNER'],
  ];
  for (const [firm, userId, role] of roles) repo.roles.of(firm).set(userId, role);
  repo.consent.add(a);
  repo.consent.add(b);
  const modules = new InMemoryModules();
  modules.set(a, 'esign', true);
  modules.set(b, 'esign', true);
  return {
    a,
    b,
    users,
    ids,
    directory,
    modules,
    repo,
    audit: new FakeAudit(),
    store: new FakeStore(),
  };
}
export type EsignWorld = ReturnType<typeof esignWorld>;

/** Records what it sends; `fail` rejects as the provider would. */
export class FakeNotify implements NotifyService {
  readonly sent: NotifyMessage[] = [];
  fail = false;
  send(message: NotifyMessage): Promise<void> {
    if (this.fail) return Promise.reject(new NotifyDeliveryError(message.template, 'email', 'X'));
    this.sent.push(structuredClone(message));
    return Promise.resolve();
  }
}

/** A recipient of a request sent 4 days ago: SENT by email to c1's primary login unless given. */
export const sentRecipient = (
  w: EsignWorld,
  extra: Partial<EsignRecipientRecord> = {},
): EsignRecipientRecord => ({
  id: randomUUID(),
  kind: 'SIGNER',
  role: 'CLIENT',
  roleLabel: null,
  routingOrder: 1,
  name: 'Fake primary',
  email: 'primary@client.test',
  phone: null,
  link: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.primary },
  delivery: 'EMAIL',
  authMethod: 'EMAIL_CODE',
  accessCodeHash: null,
  colorIndex: 0,
  status: 'SENT',
  sentAt: new Date(Date.now() - 4 * 86_400_000),
  viewedAt: null,
  signedAt: null,
  declinedAt: null,
  declineReason: null,
  lastRemindedAt: null,
  reminderCount: 0,
  ...extra,
});

/** A stored template and its versions, oldest first. */
export interface TemplateRow {
  record: EsignTemplateRecord;
  versions: EsignTemplateVersionRecord[];
}

/** Templates per firm; each write checks and writes in one synchronous step (as under a lock). */
export class InMemoryTemplateRepository implements EsignTemplateRepository {
  readonly rows = new PerFirm<TemplateRow>();

  /** `use` writes its drafts into the requests fake. */
  constructor(private readonly requests?: InMemoryEsignRepository) {}

  create(
    businessId: string,
    template: NewEsignTemplate,
    first: EsignTemplateContent & { note: string | null },
  ): Promise<EsignTemplateRecord | 'NAME_TAKEN'> {
    if (this.taken(businessId, template.name)) return Promise.resolve('NAME_TAKEN');
    const now = new Date();
    const record = { ...template, version: 1, createdAt: now, updatedAt: now, archivedAt: null };
    const version = { ...first, version: 1, savedAt: now, savedByUserId: template.ownerUserId };
    this.insert(businessId, { record, versions: [version] });
    return Promise.resolve(structuredClone(record));
  }

  createDraft(businessId: string, draft: EsignTemplateDraft): Promise<EsignRequestRecord> {
    if (!this.requests) throw new Error('InMemoryTemplateRepository needs the requests fake');
    this.requests.insert(businessId, { record: draft.record, parts: draft.parts });
    this.requests.timelines.of(businessId).set(draft.record.id, [structuredClone(draft.event)]);
    return Promise.resolve(structuredClone(draft.record));
  }

  list(businessId: string, f: EsignTemplateFilter): Promise<EsignListedTemplate[]> {
    const search = f.search?.toLowerCase();
    const listed = [...this.rows.of(businessId).values()]
      .filter(
        ({ record: t }) =>
          (f.visibleTo === null || t.visibility === 'FIRM' || t.ownerUserId === f.visibleTo) &&
          (t.archivedAt !== null) === f.archived &&
          (!search || t.name.toLowerCase().includes(search)),
      )
      .sort((x, y) => +y.record.updatedAt - +x.record.updatedAt)
      .map(({ record, versions }) => ({
        template: record,
        current: versions.find((v) => v.version === record.version)!,
      }));
    return Promise.resolve(structuredClone(listed));
  }

  find(businessId: string, id: string): Promise<EsignTemplateRecord | null> {
    const row = this.rows.of(businessId).get(id);
    return Promise.resolve(row ? structuredClone(row.record) : null);
  }

  version(businessId: string, id: string, version: number) {
    const found = this.rows
      .of(businessId)
      .get(id)
      ?.versions.find((v) => v.version === version);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  update(businessId: string, id: string, patch: EsignTemplatePatch, readAt: Date) {
    if (patch.name && this.taken(businessId, patch.name, id)) {
      return Promise.resolve('NAME_TAKEN' as const);
    }
    return this.write(businessId, id, readAt, (row) => Object.assign(row.record, patch));
  }

  archive(businessId: string, id: string, readAt: Date) {
    return this.write(businessId, id, readAt, (row) => (row.record.archivedAt = new Date()));
  }

  /** Test set-up: stores a template and its versions as given. */
  insert(businessId: string, row: TemplateRow): void {
    this.rows.of(businessId).set(row.record.id, structuredClone(row));
  }

  /** Another active template of the firm has the name (case-insensitive). */
  taken(businessId: string, name: string, except?: string): boolean {
    return [...this.rows.of(businessId).values()].some(
      ({ record: t }) =>
        t.id !== except && !t.archivedAt && t.name.toLowerCase() === name.toLowerCase(),
    );
  }

  /** A write while the template is active and unchanged since `readAt`; updatedAt moves on. */
  write(
    businessId: string,
    id: string,
    readAt: Date,
    change: (row: TemplateRow) => unknown,
  ): Promise<EsignTemplateRecord | null> {
    const row = this.rows.of(businessId).get(id);
    if (!row || row.record.archivedAt || +row.record.updatedAt !== +readAt) {
      return Promise.resolve(null);
    }
    change(row);
    row.record.updatedAt = new Date(Math.max(Date.now(), +readAt + 1));
    return Promise.resolve(structuredClone(row.record));
  }
}

/**
 * A FIRM template owned by `ownerUserId` with one version: a 2-page packet stored in `store`,
 * a CLIENT and a PREPARER role, a field each and a merge field. `extra` changes the record.
 */
export async function seedTemplate(
  businessId: string,
  repo: InMemoryTemplateRepository,
  store: FakeStore,
  ownerUserId: string,
  extra: Partial<EsignTemplateRecord> = {},
): Promise<TemplateRow> {
  const id = randomUUID();
  const bytes = new Uint8Array(Buffer.from('pdf:2'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const s3Key = store.keyFor(businessId, id, `template-${sha256}.pdf`);
  await store.put(businessId, s3Key, bytes, 'application/pdf');
  const at = new Date(Date.now() - 86_400_000);
  const role = (key: string, r: 'CLIENT' | 'PREPARER', i: number) => ({
    key,
    kind: 'SIGNER' as const,
    role: r,
    roleLabel: null,
    routingOrder: i + 1,
    authMethod: 'EMAIL_CODE' as const,
    colorIndex: i,
  });
  const field = (roleKey: string | null, extraField: object = {}) => ({
    id: randomUUID(),
    roleKey,
    type: 'SIGNATURE' as const,
    pageIndex: 1,
    ...{ x: 0.1, y: 0.8, w: 0.3, h: 0.05 },
    required: true,
    label: null,
    mergeKey: null,
    options: [],
    groupKey: null,
    value: null,
    ...extraField,
  });
  const row: TemplateRow = {
    record: {
      id,
      name: `Fake template ${id.slice(0, 8)}`,
      description: null,
      visibility: 'FIRM',
      ownerUserId,
      version: 1,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      ...extra,
    },
    versions: [
      {
        version: 1,
        savedAt: at,
        savedByUserId: ownerUserId,
        note: null,
        s3Key,
        sha256,
        sizeBytes: bytes.byteLength,
        pageSizes: [
          { width: 612, height: 792 },
          { width: 612, height: 792 },
        ],
        roles: [role('client', 'CLIENT', 0), role('preparer', 'PREPARER', 1)],
        fields: [
          field('client'),
          field('preparer', { y: 0.9 }),
          field(null, { type: 'TEXT', pageIndex: 0, mergeKey: 'CLIENT_FULL_NAME' }),
        ],
        routing: 'SEQUENTIAL',
        expiryDays: 30,
        reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
        expiryWarningDays: 2,
        emailSubject: null,
        emailMessage: null,
      },
    ],
  };
  repo.insert(businessId, row);
  return structuredClone(row);
}
