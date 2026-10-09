// In-memory stand-ins for Firm Sign's ports (R13), keyed by firm so isolation is real: a firm
// only ever sees its own rows. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { EsignDefaults, EsignField, EsignPage } from '@firmivra/types';
import type { BusinessModules, FirmModule } from '../../src/common/modules/requires-module.js';
import type {
  DirectoryClient,
  DirectoryEngagement,
  DirectoryLogin,
  DirectoryMember,
  EsignDirectory,
} from '../../src/esign/requests/esign-directory.js';
import type {
  EsignDraftPatch,
  EsignRecipientRecord,
  EsignRepository,
  EsignRequestParts,
  EsignRequestRecord,
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
  /** Set to make the next draft write find the request no longer a DRAFT (a send that won). */
  loseNextWrite = false;

  defaults(): Promise<EsignDefaults> {
    return Promise.resolve(structuredClone(ESIGN_TEST_DEFAULTS));
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

  findRequest(businessId: string, id: string): Promise<EsignRequestRecord | null> {
    const row = this.rows.of(businessId).get(id);
    return Promise.resolve(row ? structuredClone(row.record) : null);
  }

  parts(businessId: string, id: string): Promise<EsignRequestParts> {
    const row = this.rows.of(businessId).get(id);
    const empty = { documents: [], pagePlan: [], recipients: [], fields: [] };
    return Promise.resolve(structuredClone(row?.parts ?? empty));
  }

  updateDraft(businessId: string, id: string, patch: EsignDraftPatch): Promise<boolean> {
    return this.write(businessId, id, (row) => Object.assign(row.record, structuredClone(patch)));
  }

  deleteDraft(businessId: string, id: string): Promise<boolean> {
    return this.write(businessId, id, () => this.rows.of(businessId).delete(id));
  }

  savePagePlan(businessId: string, id: string, pagePlan: EsignPage[], fields: EsignField[]) {
    return this.write(businessId, id, (row) =>
      Object.assign(row.parts, structuredClone({ pagePlan, fields })),
    );
  }

  saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
    fields: EsignField[],
  ) {
    return this.write(businessId, id, (row) =>
      Object.assign(row.parts, structuredClone({ recipients, fields })),
    );
  }

  /** Test set-up: change a stored request directly (status, documents, fields...). */
  seed(businessId: string, id: string, change: (row: Row) => void): void {
    const row = this.rows.of(businessId).get(id);
    if (!row) throw new Error('no such request');
    change(row);
  }

  private write(businessId: string, id: string, change: (row: Row) => unknown): Promise<boolean> {
    const row = this.rows.of(businessId).get(id);
    if (!row || row.record.status !== 'DRAFT' || this.loseNextWrite) {
      this.loseNextWrite = false;
      return Promise.resolve(false);
    }
    row.record.lastActivityAt = new Date();
    change(row);
    return Promise.resolve(true);
  }
}

/** A firm's clients, services, portal logins and members. */
export class InMemoryDirectory implements EsignDirectory {
  readonly clients = new PerFirm<DirectoryClient>();
  readonly engagements = new PerFirm<DirectoryEngagement>();
  readonly logins = new PerFirm<DirectoryLogin>();
  readonly members = new PerFirm<DirectoryMember>();

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

export class FakeStore {
  readonly removed: { businessId: string; key: string }[] = [];
  remove(businessId: string, key: string): Promise<void> {
    this.removed.push({ businessId, key });
    return Promise.resolve();
  }
}

/** CodeHasher.hash in the engine's shape (an HMAC there; a plain hash is enough here). */
export const fakeHasher = {
  hash: (recipientId: string, code: string) =>
    createHash('sha256').update(`${recipientId}:${code}`).digest('hex'),
};

/**
 * Two firms. Firm A: owner, staff (c1 is assigned to them), staff2 (nothing assigned) and a
 * deactivated member; client c1 with PRIMARY, SPOUSE, AUTHORIZED and DISABLED logins and an
 * ACTIVE, a PENDING and a COMPLETED service; client c2 (unassigned, own login and service); an
 * archived client. Firm B: its owner, client and login. Firm Sign is on for both.
 */
export function esignWorld() {
  const id = () => randomUUID();
  const a = id();
  const b = id();
  const users = { ownerA: id(), staffA: id(), staffA2: id(), goneA: id(), ownerB: id() };
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
    directory.members.of(firm).set(userId, { userId, name, email: `${name}@firm.test`, active });
  member(a, users.ownerA, 'owner-a');
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
    repo: new InMemoryEsignRepository(),
    audit: new FakeAudit(),
    store: new FakeStore(),
  };
}
export type EsignWorld = ReturnType<typeof esignWorld>;
