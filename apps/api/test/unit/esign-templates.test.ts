// R13 step 9, templates: list, get, rename or change, archive and the packet on the in-memory
// ports (esign-fakes.ts): who sees a template (FIRM ones everyone, PRIVATE ones their owner, Owner
// and Admin), who changes one (its owner, Owner, Admin, a Manager for FIRM ones; never a Viewer),
// archived ones, the name check, the optimistic lock, the packet's hash check, the audit (ids
// only) and the 404s across firms. Synthetic data only.
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EsignTemplateDetail, EsignTemplateList } from '@firmivra/types';
import type { EsignActor } from '../../src/esign/requests/requests.service.js';
import { EsignTemplatesService } from '../../src/esign/templates/templates.service.js';
import {
  esignWorld,
  type EsignWorld,
  InMemoryTemplateRepository,
  seedTemplate,
  type TemplateRow,
} from './esign-fakes.js';

let w: EsignWorld;
let repo: InMemoryTemplateRepository;
let svc: EsignTemplatesService;
const actor = (userId: string, role: EsignActor['role']): EsignActor => ({ userId, role });
let owner: EsignActor;
let admin: EsignActor;
let manager: EsignActor;
let staff: EsignActor;
let staff2: EsignActor;
let viewer: EsignActor;
/** FIRM by the owner, PRIVATE by staff, PRIVATE by staff2, and firm B's. */
let firm: TemplateRow;
let mine: TemplateRow;
let theirs: TemplateRow;
let other: TemplateRow;

beforeEach(async () => {
  w = esignWorld();
  repo = new InMemoryTemplateRepository();
  svc = new EsignTemplatesService(repo, w.directory, w.store, w.audit);
  owner = actor(w.users.ownerA, 'OWNER');
  admin = actor(w.users.adminA, 'ADMIN');
  manager = actor(w.users.managerA, 'MANAGER');
  staff = actor(w.users.staffA, 'STAFF');
  staff2 = actor(w.users.staffA2, 'STAFF');
  viewer = actor(w.users.staffA2, 'VIEWER');
  firm = await seedTemplate(w.a, repo, w.store, w.users.ownerA, { name: 'Fake engagement' });
  mine = await seedTemplate(w.a, repo, w.store, w.users.staffA, { visibility: 'PRIVATE' });
  theirs = await seedTemplate(w.a, repo, w.store, w.users.staffA2, { visibility: 'PRIVATE' });
  other = await seedTemplate(w.b, repo, w.store, w.users.ownerB);
});
afterEach(() => vi.restoreAllMocks());

async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}
const ids = (list: EsignTemplateList) => list.items.map((t) => t.id).sort();
const sorted = (...rows: TemplateRow[]) => rows.map((r) => r.record.id).sort();

describe('who sees a template', () => {
  it('lists FIRM ones and the caller’s own PRIVATE ones; Owner and Admin see every one', async () => {
    const all = { archived: false };
    expect(ids(await svc.list(w.a, staff, all))).toEqual(sorted(firm, mine));
    expect(ids(await svc.list(w.a, staff2, all))).toEqual(sorted(firm, theirs));
    expect(ids(await svc.list(w.a, manager, all))).toEqual(sorted(firm));
    for (const who of [owner, admin]) {
      expect(ids(await svc.list(w.a, who, all))).toEqual(sorted(firm, mine, theirs));
    }
    expect(ids(await svc.list(w.b, actor(w.users.ownerB, 'OWNER'), all))).toEqual(sorted(other));
  });

  it('filters by name and by archived', async () => {
    const found = await svc.list(w.a, owner, { archived: false, q: 'ENGAGE' });
    expect(ids(found)).toEqual(sorted(firm));
    await svc.archive(w.a, owner, firm.record.id);
    expect(ids(await svc.list(w.a, owner, { archived: true }))).toEqual(sorted(firm));
    expect(ids(await svc.list(w.a, owner, { archived: false }))).toEqual(sorted(mine, theirs));
  });

  it('answers the contract’s detail, with canEdit for the caller', async () => {
    const detail = EsignTemplateDetail.parse(await svc.get(w.a, staff, firm.record.id));
    expect(detail).toMatchObject({
      id: firm.record.id,
      owner: { userId: w.users.ownerA, name: 'owner-a' },
      pageCount: 2,
      roleCount: 2,
      version: 1,
      canEdit: false,
      packetUrl: `/api/v1/esign/templates/${firm.record.id}/packet`,
    });
    expect(detail.fields).toHaveLength(3);
    expect((await svc.get(w.a, manager, firm.record.id)).canEdit).toBe(true);
    expect((await svc.get(w.a, staff, mine.record.id)).canEdit).toBe(true);
    expect((await svc.get(w.a, viewer, firm.record.id)).canEdit).toBe(false);
    const rows = await svc.list(w.a, owner, { archived: false });
    expect(rows.items.every((t) => t.canEdit)).toBe(true);
  });

  it('answers 404 for another member’s PRIVATE template and another firm’s', async () => {
    for (const work of [
      svc.get(w.a, staff, theirs.record.id),
      svc.get(w.a, manager, mine.record.id),
      svc.packet(w.a, staff, theirs.record.id),
      svc.update(w.a, staff, theirs.record.id, { name: 'Fake' }),
      svc.archive(w.a, manager, theirs.record.id),
      svc.get(w.a, owner, other.record.id),
      svc.packet(w.a, owner, other.record.id),
      svc.update(w.a, owner, other.record.id, { name: 'Fake' }),
      svc.archive(w.a, owner, other.record.id),
    ]) {
      expect(await refused(work)).toEqual([404, 'NOT_FOUND']);
    }
    expect((await repo.find(w.b, other.record.id))?.archivedAt).toBeNull();
  });
});

describe('changing a template', () => {
  it('renames, describes and shares it, and audits the keys only', async () => {
    const saved = await svc.update(w.a, staff, mine.record.id, {
      name: 'Fake renamed',
      description: 'Fake words',
      visibility: 'FIRM',
    });
    expect(saved).toMatchObject({ name: 'Fake renamed', description: 'Fake words' });
    expect(saved.visibility).toBe('FIRM');
    expect(+new Date(saved.updatedAt)).toBeGreaterThan(+mine.record.updatedAt);
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.template_updated',
        entity: { type: 'esign_template', id: mine.record.id },
        metadata: { changed: ['name', 'description', 'visibility'] },
      },
    ]);
    const cleared = await svc.update(w.a, staff, mine.record.id, { description: null });
    expect(cleared.description).toBeNull();
  });

  it('lets its owner, Owner, Admin and a Manager (FIRM) change it; others get 403', async () => {
    for (const who of [owner, admin, manager]) {
      const saved = await svc.update(w.a, who, firm.record.id, { description: 'Fake' });
      expect(saved.description).toBe('Fake');
    }
    const saved = await svc.update(w.a, owner, mine.record.id, { description: 'Fake' });
    expect(saved.description).toBe('Fake');
    for (const [who, id] of [
      [staff, firm.record.id],
      [viewer, firm.record.id],
      [actor(w.users.staffA, 'VIEWER'), mine.record.id],
    ] as const) {
      expect(await refused(svc.update(w.a, who, id, { name: 'Fake' }))).toEqual([403, 'FORBIDDEN']);
      expect(await refused(svc.archive(w.a, who, id))).toEqual([403, 'FORBIDDEN']);
    }
  });

  it('refuses a name another active template has (409 TEMPLATE_NAME_TAKEN), any case', async () => {
    const res = svc.update(w.a, staff, mine.record.id, { name: 'FAKE ENGAGEMENT' });
    expect(await refused(res)).toEqual([409, 'TEMPLATE_NAME_TAKEN']);
    // Firm B's names and archived ones are free.
    await svc.update(w.a, owner, firm.record.id, { name: other.record.name });
    await svc.archive(w.a, owner, firm.record.id);
    const saved = await svc.update(w.a, staff, mine.record.id, { name: other.record.name });
    expect(saved.name).toBe(other.record.name);
    expect(w.audit.entries.map((e) => e.action)).toEqual([
      'esign.template_updated',
      'esign.template_archived',
      'esign.template_updated',
    ]);
  });

  it('archives once: then it changes no more (409 TEMPLATE_ARCHIVED) but still reads', async () => {
    const archived = await svc.archive(w.a, staff, mine.record.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.canEdit).toBe(false);
    expect(await refused(svc.archive(w.a, staff, mine.record.id))).toEqual([
      409,
      'TEMPLATE_ARCHIVED',
    ]);
    const rename = svc.update(w.a, staff, mine.record.id, { name: 'Fake' });
    expect(await refused(rename)).toEqual([409, 'TEMPLATE_ARCHIVED']);
    expect((await svc.get(w.a, staff, mine.record.id)).archivedAt).toBe(archived.archivedAt);
    expect(await svc.packet(w.a, staff, mine.record.id)).toBeInstanceOf(Uint8Array);
    expect(w.audit.entries).toEqual([
      {
        action: 'esign.template_archived',
        entity: { type: 'esign_template', id: mine.record.id },
        metadata: {},
      },
    ]);
  });

  it('refuses a write over a change it did not see (409 INVALID_STATE), writing nothing', async () => {
    const stale = await repo.find(w.a, mine.record.id);
    await svc.update(w.a, staff, mine.record.id, { name: 'Fake first' });
    vi.spyOn(repo, 'find').mockResolvedValue(stale);
    const second = svc.update(w.a, staff, mine.record.id, { name: 'Fake second' });
    expect(await refused(second)).toEqual([409, 'INVALID_STATE']);
    expect(await refused(svc.archive(w.a, staff, mine.record.id))).toEqual([409, 'INVALID_STATE']);
    vi.restoreAllMocks();
    const now = await repo.find(w.a, mine.record.id);
    expect([now?.name, now?.archivedAt]).toEqual(['Fake first', null]);
    expect(w.audit.entries).toHaveLength(1);
  });
});

describe('the packet', () => {
  it('answers the stored bytes to anyone who sees the template', async () => {
    for (const who of [staff, viewer, manager]) {
      const bytes = await svc.packet(w.a, who, firm.record.id);
      expect(Buffer.from(bytes).toString()).toBe('pdf:2');
    }
    expect(w.audit.entries).toEqual([]);
  });

  it('refuses bytes that are not the saved ones (409 FILE_BLOCKED), logging ids only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { s3Key } = firm.versions[0]!;
    await w.store.put(w.a, s3Key, new Uint8Array(Buffer.from('pdf:3')), 'application/pdf');
    expect(await refused(svc.packet(w.a, owner, firm.record.id))).toEqual([409, 'FILE_BLOCKED']);
    await w.store.remove(w.a, s3Key);
    expect(await refused(svc.packet(w.a, owner, firm.record.id))).toEqual([409, 'FILE_BLOCKED']);
    expect(warn.mock.calls.flat().join(' ')).not.toContain(s3Key);
  });
});
