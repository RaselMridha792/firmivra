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
  EsignPendingUpload,
  EsignRecipientRecord,
  EsignRepository,
  EsignRequestParts,
  EsignRequestRecord,
  NewEsignDocument,
  NewEsignRequest,
} from '../../src/esign/requests/esign.repository.js';

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

  defaults(businessId?: string): Promise<EsignDefaults> {
    const own = businessId === undefined ? undefined : this.firmDefaults.get(businessId);
    return Promise.resolve(structuredClone(own ?? ESIGN_TEST_DEFAULTS));
  }

  consentPublished(businessId: string): Promise<boolean> {
    return Promise.resolve(this.consent.has(businessId));
  }

  saveFields(businessId: string, id: string, fields: EsignField[]) {
    return this.write(businessId, id, (row) =>
      Object.assign(row.parts, structuredClone({ fields })),
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
export const fakePdf: Pick<PdfEngine, 'inspect'> = {
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
  const repo = new InMemoryEsignRepository();
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
