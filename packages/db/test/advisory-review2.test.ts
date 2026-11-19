// Business Advisory Review Two (R1, migration r1_advisory_review2): the firm's industry list
// (A-X02), its own resources and their files (A-X10), and progress notes on action items (A-X11).
// Every row is its own firm's; runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { type Firm, r39Fixtures } from './r39-fixtures.js';

const urls = inject('dbUrls');
const { A, B, as, ownerIn, setup, close, outcome, owner } = r39Fixtures(urls);
/** The app role for interactive transactions (the scoped client has none). */
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const advisoryClient = new Map<Firm, string>();
const LONG = { maxWait: 15_000, timeout: 60_000 };

const industry = (f: Firm, data: object = {}) =>
  as(f).advisoryIndustry.create({
    data: { businessId: f.id, name: `Retail ${randomUUID().slice(0, 8)}`, ...data } as never,
  });

const file = (f: Firm, data: object = {}) =>
  as(f).advisoryResourceFile.create({
    data: {
      businessId: f.id,
      fileName: 'pricing-worksheet.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'b'.repeat(64),
      s3Key: `tenant/${f.id}/advisory-resources/${randomUUID()}/pricing-worksheet.pdf`,
      uploadedByUserId: f.owner,
      ...data,
    } as never,
  });

const resource = (f: Firm, data: object = {}) =>
  as(f).advisoryResource.create({
    data: {
      businessId: f.id,
      title: 'Pricing Worksheet',
      category: 'Financial Management',
      kind: 'GUIDE',
      summary: 'How to set prices that cover your costs.',
      createdByUserId: f.owner,
      ...data,
    } as never,
  });

const item = (f: Firm, data: object = {}) =>
  as(f).advisoryActionItem.create({
    data: {
      businessId: f.id,
      advisoryClientId: advisoryClient.get(f),
      title: 'Gather three vendor quotes',
      createdByUserId: f.owner,
      assigneeUserId: f.owner,
      ...data,
    } as never,
  });

const noteData = (f: Firm, actionItemId: string, data: object = {}) =>
  ({
    businessId: f.id,
    actionItemId,
    body: 'Called two vendors.',
    status: 'NOT_STARTED',
    authorUserId: f.owner,
    ...data,
  }) as never;
const note = (f: Firm, actionItemId: string, data: object = {}) =>
  as(f).advisoryActionItemNote.create({ data: noteData(f, actionItemId, data) });

beforeAll(async () => {
  await setup('BUSINESS_DEVELOPMENT');
  for (const f of [A, B]) {
    const row = await as(f).advisoryClient.create({
      data: { businessId: f.id, clientId: f.client },
    });
    advisoryClient.set(f, row.id);
  }
});
afterAll(async () => {
  await Promise.all([close(), app.$disconnect()]);
});

describe('row-level security', () => {
  it("keeps every new table's rows from another firm and refuses links across firms", async () => {
    await industry(A);
    const f = await file(A);
    await resource(A, { kind: 'PDF', fileId: f.id });
    const i = await item(A);
    await note(A, i.id);
    expect(await as(B).advisoryIndustry.findMany()).toEqual([]);
    expect(await as(B).advisoryResource.findMany()).toEqual([]);
    expect(await as(B).advisoryResourceFile.findMany()).toEqual([]);
    expect(await as(B).advisoryActionItemNote.findMany()).toEqual([]);
    // With no scope, the app role sees nothing at all.
    expect(await app.advisoryIndustry.count()).toBe(0);
    expect(await app.advisoryActionItemNote.count()).toBe(0);
    expect(await outcome(note(B, i.id))).toMatch(/Foreign key/);
    expect(await outcome(resource(B, { kind: 'PDF', fileId: f.id }))).toMatch(/Foreign key/);
    // A row naming another firm is refused by the policy.
    expect(
      await outcome(
        as(B).advisoryIndustry.create({ data: { businessId: A.id, name: 'Retail elsewhere' } }),
      ),
    ).toMatch(/row-level security|violates/i);
  });
});

describe('industries (A-X02)', () => {
  it('have a one-line name of 1 to 80 characters and a small position', async () => {
    expect(await outcome(industry(A, { name: '   ' }))).toMatch(/advisory_industries_name/);
    expect(await outcome(industry(A, { name: 'x'.repeat(81) }))).toMatch(
      /advisory_industries_name/,
    );
    expect(await outcome(industry(A, { name: 'Retail\nOnline' }))).toMatch(
      /advisory_industries_name/,
    );
    expect(await outcome(industry(A, { name: 'Re\u200btail' }))).toMatch(
      /advisory_industries_name/,
    );
    expect(await outcome(industry(A, { sortOrder: 1000 }))).toMatch(
      /advisory_industries_sort_order/,
    );
    expect(await outcome(industry(A, { sortOrder: -1 }))).toMatch(/advisory_industries_sort_order/);
    expect(await outcome(industry(A, { sortOrder: 999, name: 'x'.repeat(80) }))).toBe('ok');
  });

  it('keep live names unique per firm, ignoring case, and are archived, never deleted', async () => {
    const name = `Construction ${randomUUID().slice(0, 8)}`;
    const first = await industry(A, { name });
    expect(await outcome(industry(A, { name: ` ${name.toUpperCase()} ` }))).toMatch(
      /unique constraint/i,
    );
    expect(await outcome(industry(B, { name }))).toBe('ok');
    await as(A).advisoryIndustry.update({
      where: { id: first.id },
      data: { archivedAt: new Date() },
    });
    // An archived name may be added again; the archived one then can't come back beside it.
    expect(await outcome(industry(A, { name }))).toBe('ok');
    expect(
      await outcome(
        as(A).advisoryIndustry.update({ where: { id: first.id }, data: { archivedAt: null } }),
      ),
    ).toMatch(/unique constraint/i);
    expect(
      await outcome(
        as(A).advisoryIndustry.update({ where: { id: first.id }, data: { name: 'Mining' } }),
      ),
    ).toBe('ok');
    expect(await outcome(as(A).advisoryIndustry.deleteMany())).toMatch(/permission denied/);
  });
});

describe('resources (A-X10)', () => {
  it('need their words in shape; the summary may have lines', async () => {
    const words = /advisory_resources_words/;
    expect(await outcome(resource(A, { title: ' ' }))).toMatch(words);
    expect(await outcome(resource(A, { title: 'x'.repeat(201) }))).toMatch(words);
    expect(await outcome(resource(A, { title: 'Pricing\nWorksheet' }))).toMatch(words);
    expect(await outcome(resource(A, { category: 'x'.repeat(101) }))).toMatch(words);
    expect(await outcome(resource(A, { summary: ' \n ' }))).toMatch(words);
    expect(await outcome(resource(A, { summary: 'x'.repeat(1001) }))).toMatch(words);
    expect(await outcome(resource(A, { summary: 'Prices\u202ecosts' }))).toMatch(words);
    expect(await outcome(resource(A, { catalogKey: 'Cash Flow' }))).toMatch(words);
    expect(await outcome(resource(A, { summary: 'Step one.\nStep two.' }))).toBe('ok');
  });

  it('take only an https link with a host and no user name', async () => {
    const link = (url: string) => outcome(resource(A, { kind: 'LINK', url }));
    for (const bad of [
      'http://example.com/grants',
      'https://',
      'https:///grants',
      'https://user@example.com/grants',
      'https://example.com/grants list',
      'https://example.com/"grants"',
      'https://example.com/<grants>',
      `https://example.com/${'g'.repeat(2000)}`,
      'javascript:alert(1)',
    ])
      expect(await link(bad), bad).toMatch(/advisory_resources_url/);
    for (const good of [
      'https://example.com',
      'https://example.com/grants?state=tx#apply',
      'https://example.com:8443/grants/a@b',
    ])
      expect(await link(good), good).toBe('ok');
  });

  it('have at most one link or one file, and a link or a video is a link', async () => {
    const source = /advisory_resources_source/;
    const f = await file(A);
    expect(await outcome(resource(A, { kind: 'LINK' }))).toMatch(source);
    expect(await outcome(resource(A, { kind: 'VIDEO', fileId: f.id }))).toMatch(source);
    expect(
      await outcome(resource(A, { kind: 'PDF', url: 'https://example.com/a.pdf', fileId: f.id })),
    ).toMatch(source);
    expect(await outcome(resource(A, { kind: 'VIDEO', url: 'https://example.com/v' }))).toBe('ok');
    expect(await outcome(resource(A, { kind: 'PDF', url: 'https://example.com/a.pdf' }))).toBe(
      'ok',
    );
  });

  it('edit a built-in one at most once per firm, and keep its key, creator and creation time', async () => {
    const copy = await resource(A, { catalogKey: 'cash-flow-basics' });
    expect(await outcome(resource(A, { catalogKey: 'cash-flow-basics' }))).toMatch(
      /unique constraint/i,
    );
    expect(await outcome(resource(B, { catalogKey: 'cash-flow-basics' }))).toBe('ok');
    const update = (data: object) =>
      outcome(as(A).advisoryResource.update({ where: { id: copy.id }, data: data as never }));
    const fixed = /built-in key, the creator and the creation time are fixed/;
    expect(await update({ catalogKey: 'brand-basics-guide' })).toMatch(fixed);
    expect(await update({ catalogKey: null })).toMatch(fixed);
    expect(await update({ createdByUserId: randomUUID() })).toMatch(fixed);
    expect(await update({ createdAt: new Date('2020-01-01') })).toMatch(fixed);
    expect(await update({ title: 'Cash Flow Basics (our version)', clientFacing: true })).toBe(
      'ok',
    );
    expect(await outcome(as(A).advisoryResource.deleteMany())).toMatch(/permission denied/);
  });

  it('link a file of their own firm, one resource per file, never one the scan refused', async () => {
    const pending = await file(A);
    const linked = await resource(A, { kind: 'PDF', fileId: pending.id });
    expect(await outcome(resource(A, { kind: 'PDF', fileId: pending.id }))).toMatch(
      /unique constraint/i,
    );
    const infected = await file(A);
    await as(A).advisoryResourceFile.update({
      where: { id: infected.id },
      data: { scanStatus: 'INFECTED' },
    });
    const refused = /a file the scan refused cannot be linked/;
    expect(await outcome(resource(A, { kind: 'PDF', fileId: infected.id }))).toMatch(refused);
    expect(
      await outcome(
        as(A).advisoryResource.update({ where: { id: linked.id }, data: { fileId: infected.id } }),
      ),
    ).toMatch(refused);
    // A file the scan refuses after it was linked stays linked (the API offers only CLEAN ones),
    // so the resource can still change its words or drop the file.
    const later = await file(A);
    const kept = await resource(A, { kind: 'PDF', fileId: later.id });
    await as(A).advisoryResourceFile.update({
      where: { id: later.id },
      data: { scanStatus: 'FAILED' },
    });
    expect(
      await outcome(
        as(A).advisoryResource.update({ where: { id: kept.id }, data: { title: 'Renamed' } }),
      ),
    ).toBe('ok');
    expect(
      await outcome(
        as(A).advisoryResource.update({ where: { id: kept.id }, data: { fileId: null } }),
      ),
    ).toBe('ok');
  });
});

describe('resource files (A-X10)', () => {
  it("live under the firm's own advisory-resources prefix, within 25 MB", async () => {
    const values = /advisory_resource_files_values/;
    const key = /advisory_resource_files_key/;
    const id = randomUUID();
    expect(
      await outcome(file(A, { s3Key: `tenant/${B.id}/advisory-resources/${id}/a.pdf` })),
    ).toMatch(key);
    expect(await outcome(file(A, { s3Key: `tenant/${A.id}/documents/${id}/a.pdf` }))).toMatch(key);
    expect(
      await outcome(file(A, { s3Key: `tenant/${A.id}/advisory-resources/../documents/a.pdf` })),
    ).toMatch(key);
    expect(
      await outcome(file(A, { s3Key: `tenant/${A.id}/advisory-resources/${id}/a b.pdf` })),
    ).toMatch(key);
    expect(await outcome(file(A, { sizeBytes: 0 }))).toMatch(values);
    expect(await outcome(file(A, { sizeBytes: 26_214_401 }))).toMatch(values);
    expect(await outcome(file(A, { contentType: 'PDF' }))).toMatch(values);
    expect(await outcome(file(A, { sha256: 'abc' }))).toMatch(values);
    expect(await outcome(file(A, { fileName: ' ' }))).toMatch(values);
    expect(await outcome(file(A, { sizeBytes: 26_214_400 }))).toBe('ok');
  });

  it("start unscanned, keep their file, and take one scan result at the database's time", async () => {
    expect(await outcome(file(A, { scanStatus: 'CLEAN', scannedAt: new Date() }))).toMatch(
      /a new file starts unscanned/,
    );
    const f = await file(A);
    const before = Date.now();
    const clean = await as(A).advisoryResourceFile.update({
      where: { id: f.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date('2020-01-01') },
    });
    expect(clean.scannedAt!.getTime()).toBeGreaterThan(before - 60_000);
    expect(
      await outcome(
        as(A).advisoryResourceFile.update({
          where: { id: f.id },
          data: { scanStatus: 'INFECTED' },
        }),
      ),
    ).toMatch(/the file is fixed and its scan result is set once/);
    // The app role may change only the scan result; the owner role is held by the trigger.
    expect(
      await outcome(
        as(A).advisoryResourceFile.update({ where: { id: f.id }, data: { fileName: 'b.pdf' } }),
      ),
    ).toMatch(/permission denied/);
    expect(
      await outcome(
        ownerIn(A, (tx) =>
          tx.advisoryResourceFile.update({ where: { id: f.id }, data: { fileName: 'b.pdf' } }),
        ),
      ),
    ).toMatch(/the file is fixed/);
    expect(
      await outcome(ownerIn(A, (tx) => tx.advisoryResourceFile.delete({ where: { id: f.id } }))),
    ).toMatch(/a file is kept, never deleted/);
    expect(await outcome(as(A).advisoryResourceFile.deleteMany())).toMatch(/permission denied/);
  });
});

describe('progress notes (A-X11)', () => {
  it('have words, lines allowed, and are kept: never edited or deleted', async () => {
    const i = await item(A);
    const body = /advisory_action_item_notes_body/;
    expect(await outcome(note(A, i.id, { body: ' \n ' }))).toMatch(body);
    expect(await outcome(note(A, i.id, { body: 'x'.repeat(2001) }))).toMatch(body);
    expect(await outcome(note(A, i.id, { body: 'Called\u202evendors' }))).toMatch(body);
    const n = await note(A, i.id, { body: 'Called two vendors.\nThe third quote is due Friday.' });
    expect(
      await outcome(
        as(A).advisoryActionItemNote.update({ where: { id: n.id }, data: { body: 'Changed' } }),
      ),
    ).toMatch(/permission denied/);
    expect(await outcome(as(A).advisoryActionItemNote.deleteMany())).toMatch(/permission denied/);
  });

  it("record the item's status at the database's time, also when both change together", async () => {
    const i = await item(A, { status: 'IN_PROGRESS' });
    expect(await outcome(note(A, i.id, { status: 'NOT_STARTED' }))).toMatch(
      /a note records the status its item has/,
    );
    const before = Date.now();
    const n = await note(A, i.id, { status: 'IN_PROGRESS', createdAt: new Date('2020-01-01') });
    expect(n.createdAt.getTime()).toBeGreaterThan(before - 60_000);
    // The API's "add a note and mark it done": the item first, then the note, in one transaction.
    await runInScope(app, { kind: 'business', businessId: A.id }, async (tx) => {
      await tx.advisoryActionItem.update({
        where: { id: i.id },
        data: { status: 'DONE', completedAt: new Date() },
      });
      await tx.advisoryActionItemNote.create({ data: noteData(A, i.id, { status: 'DONE' }) });
    });
    const history = await as(A).advisoryActionItemNote.findMany({
      where: { actionItemId: i.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { status: true, authorUserId: true },
    });
    expect(history).toEqual([
      { status: 'IN_PROGRESS', authorUserId: A.owner },
      { status: 'DONE', authorUserId: A.owner },
    ]);
  });

  it('wait for a status change being written, then refuse a note with the old status', async () => {
    const i = await item(A, { status: 'IN_PROGRESS' });
    const scope = { kind: 'business', businessId: A.id } as const;
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const first = outcome(
      runInScope(
        app,
        scope,
        async (tx) => {
          await tx.advisoryActionItem.update({
            where: { id: i.id },
            data: { status: 'CANCELLED' },
          });
          held();
          await released;
        },
        LONG,
      ),
    );
    void first.then(() => held());
    await holding;

    let pid = 0;
    let started!: () => void;
    const hasPid = new Promise<void>((resolve) => (started = resolve));
    let secondDone = false;
    const second = outcome(
      runInScope(
        app,
        scope,
        async (tx) => {
          const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pid = row!.pid;
          started();
          await tx.advisoryActionItemNote.create({
            data: noteData(A, i.id, { status: 'IN_PROGRESS' }),
          });
        },
        LONG,
      ),
    );
    void second.then(() => {
      secondDone = true;
      started();
    });
    await hasPid;
    let waited = false;
    for (let n = 0; n < 500 && !secondDone; n++) {
      const [row] = await owner.$queryRaw<{ n: number }[]>`
        SELECT cardinality(pg_blocking_pids(${pid}::int))::int AS n`;
      if (row!.n > 0) {
        waited = true;
        break;
      }
      await sleep(20);
    }
    release();
    expect(await first).toBe('ok');
    const result = await second;
    expect(waited, `the note did not wait for the status change: ${result}`).toBe(true);
    expect(result).toMatch(/a note records the status its item has/);
  });
});
