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
import type { EsignRequestStatus } from '@firmivra/types';
import type { EsignCodeKind } from '../../src/esign/engine/engine.types.js';
import type {
  CompletionWrite,
  EsignCompletionRepository,
} from '../../src/esign/completion/completion.repository.js';
import type {
  EsignSignerRepository,
  SignerAdoption,
  SignerFinishWrite,
  SignerLink,
} from '../../src/esign/signer/signer.repository.js';

export const ESIGN_TEST_DEFAULTS: EsignDefaults = {
  expiryDays: 30,
  reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
  expiryWarningDays: 2,
  authMethod: 'EMAIL_CODE',
  requireApproval: false,
  emailMessage: 'Please review and sign.',
};

interface Row {
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
    return this.write(
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
    return this.write(
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
    return this.write(
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
    recipientId: string;
    template: string;
    status: 'QUEUED' | 'SENT' | 'FAILED';
    error: string | null;
  }>();

  sendDraft(
    businessId: string,
    id: string,
    write: EsignSendWrite,
    readAt: Date,
  ): Promise<string[] | null> {
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
      lastActivityAt: write.sentAt,
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
    return Promise.resolve(ids);
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
    return this.write(
      businessId,
      id,
      (row) => {
        row.parts.documents = row.parts.documents.filter((d) => d.id !== documentId);
        Object.assign(row.parts, structuredClone({ pagePlan, fields }));
      },
      readAt,
    );
  }

  /** Test set-up: change a stored request directly (status, documents, fields...). */
  seed(businessId: string, id: string, change: (row: Row) => void): void {
    const row = this.rows.of(businessId).get(id);
    if (!row) throw new Error('no such request');
    change(row);
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

/**
 * The signer tables over InMemoryEsignRepository's requests: link hashes, token versions, pinned
 * consent, codes (only hashes, with their tries and the sends of the last hour) and consents.
 */
export class InMemorySignerRepository implements EsignSignerRepository {
  /** Each firm's links, by token hash. */
  readonly links = new PerFirm<SignerLink>();
  /** Each firm's recipients' token versions (0 unless set) and pinned consent. */
  readonly versions = new PerFirm<number>();
  readonly pinned = new PerFirm<string>();
  /** Each firm's open codes, by `${recipientId}:${kind}`. */
  readonly codes = new PerFirm<{
    hash: string | null;
    expiresAt: Date | null;
    tries: number;
    sends: Date[];
  }>();
  /** Each firm's newest consent version. */
  readonly consents = new Map<string, { id: string; version: number; bodyMarkdown: string }>();

  constructor(private readonly requests: InMemoryEsignRepository) {}

  findLink(businessId: string, tokenHash: string) {
    return Promise.resolve(structuredClone(this.links.of(businessId).get(tokenHash) ?? null));
  }

  async signer(businessId: string, requestId: string, recipientId: string) {
    const request = await this.requests.findRequest(businessId, requestId);
    const { recipients } = await this.requests.parts(businessId, requestId);
    const recipient = recipients.find((r) => r.id === recipientId && r.kind === 'SIGNER');
    if (!request || !recipient) return null;
    const tokenVersion = this.versions.of(businessId).get(recipientId) ?? 0;
    const consentVersionId = this.pinned.of(businessId).get(recipientId) ?? null;
    const adoption = this.adoptions.of(businessId).get(recipientId);
    const adopted = adoption
      ? { method: adoption.signature.method, hasInitials: adoption.initials !== null }
      : null;
    return { request, recipient, tokenVersion, consentVersionId, adopted };
  }

  issueCode(
    businessId: string,
    recipientId: string,
    code: { hash: string; sentAt: Date; expiresAt: Date },
  ): Promise<'OK' | 'TOO_SOON'> {
    const key = `${recipientId}:EMAIL`;
    const old = this.codes.of(businessId).get(key);
    const at = code.sentAt.getTime();
    const sends = (old?.sends ?? []).filter((d) => d.getTime() > at - 3_600_000);
    const last = sends.at(-1);
    if ((last && at - last.getTime() < 60_000) || sends.length >= 5) {
      return Promise.resolve('TOO_SOON');
    }
    const row = {
      hash: code.hash,
      expiresAt: code.expiresAt,
      tries: 0,
      sends: [...sends, code.sentAt],
    };
    this.codes.of(businessId).set(key, row);
    return Promise.resolve('OK');
  }

  takeCodeTry(businessId: string, recipientId: string, kind: EsignCodeKind) {
    const codes = this.codes.of(businessId);
    const key = `${recipientId}:${kind}`;
    let row = codes.get(key);
    if (!row && kind === 'EMAIL') return Promise.resolve(null);
    if (!row) codes.set(key, (row = { hash: null, expiresAt: null, tries: 0, sends: [] }));
    const triesBefore = row.tries++;
    return Promise.resolve({ hash: row.hash, expiresAt: row.expiresAt, triesBefore });
  }

  clearCode(businessId: string, recipientId: string, kind: EsignCodeKind) {
    const key = `${recipientId}:${kind}`;
    const row = this.codes.of(businessId).get(key);
    if (row && kind === 'ACCESS') row.tries = 0;
    else this.codes.of(businessId).delete(key);
    return Promise.resolve();
  }

  addEvent(businessId: string, requestId: string, event: EsignEventRecord) {
    const timeline = this.requests.timelines.of(businessId);
    timeline.set(requestId, [...(timeline.get(requestId) ?? []), structuredClone(event)]);
    return Promise.resolve();
  }

  currentConsent(businessId: string) {
    return Promise.resolve(this.consents.get(businessId) ?? null);
  }

  async acceptConsent(
    businessId: string,
    requestId: string,
    recipientId: string,
    versionId: string,
    event: EsignEventRecord,
  ) {
    if (this.consents.get(businessId)?.id !== versionId) return false;
    this.pinned.of(businessId).set(recipientId, versionId);
    await this.addEvent(businessId, requestId, event);
    return true;
  }

  /** Each firm's adopted signatures, by recipient. */
  readonly adoptions = new PerFirm<SignerAdoption>();
  /** Each firm's signer values, by field id, and the requests marked for completion. */
  readonly values = new PerFirm<string>();
  readonly completionDue = new Set<string>();

  /**
   * Applies the change while the request is open and the recipient has not finished (and, with
   * `readAt`, unchanged since), bumping lastActivityAt like the Prisma writes.
   */
  private change(
    businessId: string,
    requestId: string,
    recipientId: string,
    apply: (row: { record: EsignRequestRecord; parts: EsignRequestParts }) => void,
    readAt?: Date,
  ): boolean {
    let ok = false;
    this.requests.seed(businessId, requestId, (row) => {
      const me = row.parts.recipients.find((r) => r.id === recipientId);
      const open = ['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'];
      if (!me || !open.includes(row.record.status) || ['SIGNED', 'DECLINED'].includes(me.status))
        return;
      if (readAt && row.record.lastActivityAt.getTime() !== readAt.getTime()) return;
      const last = row.record.lastActivityAt.getTime();
      row.record.lastActivityAt = new Date(Math.max(Date.now(), last + 1));
      apply(row);
      ok = true;
    });
    return ok;
  }

  async markViewed(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: { at: Date; status: EsignRequestStatus; event: EsignEventRecord },
  ) {
    if ((await this.signer(businessId, requestId, recipientId))?.recipient.viewedAt) return false;
    const ok = this.change(businessId, requestId, recipientId, (row) => {
      const me = row.parts.recipients.find((r) => r.id === recipientId)!;
      Object.assign(me, { status: 'VIEWED', viewedAt: write.at });
      row.record.status = write.status;
    });
    if (ok) await this.addEvent(businessId, requestId, write.event);
    return ok;
  }

  adopt(businessId: string, requestId: string, recipientId: string, adoption: SignerAdoption) {
    const ok = this.change(businessId, requestId, recipientId, () =>
      this.adoptions.of(businessId).set(recipientId, adoption),
    );
    return Promise.resolve(ok);
  }

  async finish(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: SignerFinishWrite,
    readAt: Date,
  ) {
    const outbox = this.requests.outbox.of(businessId);
    const ids: string[] = [];
    const ok = this.change(
      businessId,
      requestId,
      recipientId,
      (row) => {
        const me = row.parts.recipients.find((r) => r.id === recipientId)!;
        Object.assign(me, { status: 'SIGNED', signedAt: write.signedAt });
        row.record.status = write.status;
        for (const v of write.values) this.values.of(businessId).set(v.fieldId, v.value);
        if (write.allSigned) this.completionDue.add(requestId);
        for (const t of write.turn) {
          const r = row.parts.recipients.find((x) => x.id === t.recipientId)!;
          Object.assign(r, { status: 'SENT', sentAt: write.signedAt });
          if (t.tokenHash) {
            const link = {
              requestId,
              recipientId: r.id,
              tokenVersion: 0,
              purpose: 'SIGN' as const,
            };
            this.links.of(businessId).set(t.tokenHash, link);
          }
        }
        for (const e of write.emails) {
          const emailId = randomUUID();
          outbox.set(emailId, { ...e, status: 'QUEUED', error: null });
          ids.push(emailId);
        }
      },
      readAt,
    );
    if (!ok) return null;
    await this.addEvent(businessId, requestId, write.event);
    return ids;
  }

  async decline(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: { at: Date; reason: string | null; event: EsignEventRecord },
  ) {
    const ok = this.change(businessId, requestId, recipientId, (row) => {
      row.record.status = 'DECLINED';
      const me = row.parts.recipients.find((r) => r.id === recipientId)!;
      Object.assign(me, { status: 'DECLINED', declinedAt: write.at, declineReason: write.reason });
    });
    if (ok) await this.addEvent(businessId, requestId, write.event);
    return ok;
  }
}

/** A vault document filed by completion (the documents row's columns that matter here). */
export interface FiledDocument {
  id: string;
  clientId: string;
  engagementId: string;
  categoryId: string;
  direction: 'FIRM_TO_CLIENT';
  scanStatus: 'CLEAN';
  legalHold: true;
  retentionUntil: null;
  contentType: 'application/pdf';
  key: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

/** Completion over the request and signer fakes: the vault, the copy links and the due marks. */
export class InMemoryCompletionRepository implements EsignCompletionRepository {
  /** The job's firms (ACTIVE with Firm Sign on). */
  readonly firmIds: string[] = [];
  /** Each firm's filed documents, by id, and its categories, by name. */
  readonly documents = new PerFirm<FiledDocument>();
  readonly categories = new PerFirm<string>();
  /** Each firm's completed requests' hashes and document ids. */
  readonly completed = new PerFirm<{
    finalSha256: string;
    certificateSha256: string;
    finalDocumentId: string;
    certificateDocumentId: string;
  }>();
  /** Each firm's copy-link expiry, by recipient id. */
  readonly copyExpiry = new PerFirm<Date>();
  /** Each request's next try after a failure. */
  readonly retryAt = new Map<string, Date>();
  /** Set to make `complete` throw once (a database failure mid-way). */
  failNextComplete = false;
  /** Set while another task holds the job's lock. */
  lockedElsewhere = false;

  constructor(
    private readonly requests: InMemoryEsignRepository,
    private readonly signers: InMemorySignerRepository,
  ) {}

  async withJobLock<T>(work: () => Promise<T>): Promise<T | null> {
    return this.lockedElsewhere ? null : work();
  }

  firms() {
    return Promise.resolve([...this.firmIds]);
  }

  async due(businessId: string, now: Date, limit: number) {
    const ids: string[] = [];
    for (const id of this.signers.completionDue) {
      const q = await this.requests.findRequest(businessId, id);
      const at = this.retryAt.get(id);
      if (q?.status === 'PARTIALLY_SIGNED' && (!at || at <= now)) ids.push(id);
    }
    return ids.slice(0, limit);
  }

  async inputs(businessId: string, requestId: string) {
    const { recipients, fields } = await this.requests.parts(businessId, requestId);
    const values = this.signers.values.of(businessId);
    const adoptions = this.signers.adoptions.of(businessId);
    const consent = this.signers.consents.get(businessId);
    const pinned = this.signers.pinned.of(businessId);
    return {
      values: fields.flatMap((f) =>
        values.has(f.id) ? [{ fieldId: f.id, value: values.get(f.id)! }] : [],
      ),
      adoptions: recipients.flatMap((r) => {
        const adoption = adoptions.get(r.id);
        return adoption ? [{ recipientId: r.id, adoption }] : [];
      }),
      consentVersions: recipients.flatMap((r) =>
        consent && pinned.get(r.id) === consent.id
          ? [{ recipientId: r.id, version: consent.version }]
          : [],
      ),
    };
  }

  async complete(businessId: string, requestId: string, write: CompletionWrite) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      throw new Error('fake database failure');
    }
    // Checked and marked in one synchronous step, as under the FOR UPDATE lock.
    let q: EsignRequestRecord | null = null;
    if (!(await this.requests.findRequest(businessId, requestId))) return null;
    this.requests.seed(businessId, requestId, (row) => {
      const signers = row.parts.recipients.filter((r) => r.kind === 'SIGNER');
      const due = this.signers.completionDue.has(requestId);
      if (row.record.status !== 'PARTIALLY_SIGNED' || !due) return;
      if (signers.some((r) => r.status !== 'SIGNED')) return;
      const at = write.completedAt;
      Object.assign(row.record, { status: 'COMPLETED', completedAt: at, lastActivityAt: at });
      q = structuredClone(row.record);
    });
    if (!q) return null;
    const { clientId, engagementId } = q as EsignRequestRecord;
    const categories = this.categories.of(businessId);
    if (!categories.has('Signed Documents')) categories.set('Signed Documents', randomUUID());
    const file = (f: CompletionWrite['final']) => {
      const doc: FiledDocument = {
        id: randomUUID(),
        clientId: clientId!,
        engagementId: engagementId!,
        categoryId: categories.get('Signed Documents')!,
        direction: 'FIRM_TO_CLIENT',
        scanStatus: 'CLEAN',
        legalHold: true,
        retentionUntil: null,
        contentType: 'application/pdf',
        ...f,
      };
      this.documents.of(businessId).set(doc.id, doc);
      return doc.id;
    };
    const finalDocumentId = file(write.final);
    const certificateDocumentId = file(write.certificate);
    this.completed.of(businessId).set(requestId, {
      finalSha256: write.final.sha256,
      certificateSha256: write.certificate.sha256,
      finalDocumentId,
      certificateDocumentId,
    });
    this.signers.completionDue.delete(requestId);
    for (const l of write.copyLinks) {
      const { recipientId, tokenHash, expiresAt } = l;
      const link = { requestId, recipientId, tokenVersion: 0, purpose: 'COPY' as const };
      this.signers.links.of(businessId).set(tokenHash, link);
      this.copyExpiry.of(businessId).set(recipientId, expiresAt);
    }
    const outbox = this.requests.outbox.of(businessId);
    const emailIds = write.emails.map((e) => {
      const id = randomUUID();
      outbox.set(id, { ...e, status: 'QUEUED', error: null });
      return id;
    });
    await this.signers.addEvent(businessId, requestId, write.event);
    return { finalDocumentId, certificateDocumentId, emailIds };
  }

  async retryLater(businessId: string, requestId: string, retryAt: Date) {
    if (await this.requests.findRequest(businessId, requestId)) {
      this.retryAt.set(requestId, retryAt);
    }
  }
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
  }[] = [];
  log(action: string, entity: { type: string; id?: string }, metadata?: Record<string, unknown>) {
    this.entries.push({ action, entity, metadata });
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
