// R0 stage B2 (Oct 17): Firmivra's support desk for firms. The Super Admin team sees every ticket;
// a firm's members see and raise only their own firm's tickets and replies, never internal notes,
// note files or the history. Numbers are platform-wide and given by the database; the contact is
// a member of the firm; messages, notes and history are never edited; files live under the
// firm's own prefix and only the scanner records their result.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  ownerA: randomUUID(),
  ownerB: randomUUID(),
  stranger: randomUUID(),
  firmA: '',
  firmB: '',
  category: '',
  priority: '',
};

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId: ids.admin }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(firm: 'A' | 'B', fn: (tx: TxClient) => Promise<T>) =>
  runInScope(
    app,
    {
      kind: 'business',
      businessId: firm === 'A' ? ids.firmA : ids.firmB,
      actorUserId: firm === 'A' ? ids.ownerA : ids.ownerB,
    },
    fn,
  );
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.admin, 'ADMIN'],
      [ids.ownerA, 'STAFF'],
      [ids.ownerB, 'STAFF'],
      [ids.stranger, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@sup.test`, name: 'Fake Person' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin, role: 'SUPER_ADMIN' } });
    ids.firmA = (
      await tx.business.create({ data: { slug: `b2a-${run}`, name: 'Firm A (fake)' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `b2b-${run}`, name: 'Firm B (fake)' } })
    ).id;
  });
  for (const [businessId, userId] of [
    [ids.firmA, ids.ownerA],
    [ids.firmB, ids.ownerB],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.category = (
      await tx.supportCategory.findUniqueOrThrow({ where: { name: 'Technical Issue' } })
    ).id;
    ids.priority = (await tx.supportPriority.findUniqueOrThrow({ where: { code: 'MEDIUM' } })).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const ticket = (firm: 'A' | 'B', extra: Record<string, unknown> = {}) => ({
  businessId: firm === 'A' ? ids.firmA : ids.firmB,
  contactUserId: firm === 'A' ? ids.ownerA : ids.ownerB,
  subject: 'Cannot upload a PDF',
  description: 'The upload spins forever on a 4 MB PDF.',
  categoryId: ids.category,
  priorityId: ids.priority,
  source: 'EMAIL' as const,
  createdByUserId: ids.admin,
  ...extra,
});

describe('support defaults', () => {
  it('ships the spec categories, priorities with SLA targets, settings and rules', async () => {
    const counts = await asAdmin(async (tx) => ({
      categories: await tx.supportCategory.count(),
      priorities: await tx.supportPriority.findMany({ orderBy: { sortOrder: 'asc' } }),
      settings: await tx.supportSettings.count(),
      escalation: await tx.supportEscalationRule.count(),
      notify: await tx.supportNotificationRule.count(),
    }));
    expect(counts.categories).toBeGreaterThanOrEqual(6);
    expect(counts.priorities.map((p) => [p.code, p.responseTargetMinutes])).toEqual([
      ['CRITICAL', 60],
      ['HIGH', 240],
      ['MEDIUM', 480],
      ['LOW', 960],
    ]);
    expect(counts.settings).toBe(1);
    expect(counts.escalation).toBe(3);
    expect(counts.notify).toBeGreaterThanOrEqual(10);
  });
});

describe('support tickets', () => {
  it("numbers platform-wide in order, whoever raises the ticket; the counter is the database's", async () => {
    const t1 = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A', { number: 5 }) }));
    const t2 = await asFirm('B', (tx) =>
      tx.supportTicket.create({
        data: ticket('B', { source: 'PORTAL', createdByUserId: ids.ownerB }),
      }),
    );
    expect(t1.number).toBeGreaterThan(1000);
    expect(t2.number).toBe(t1.number + 1);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.supportTicketCounter.update({ where: { id: 1 }, data: { lastNumber: 1 } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });

  it('a firm sees only its own tickets and raises one only for itself, from the portal, unassigned', async () => {
    await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    const seenByB = await asFirm('B', (tx) => tx.supportTicket.findMany());
    expect(seenByB.every((t) => t.businessId === ids.firmB)).toBe(true);
    const raise = (data: Record<string, unknown>) =>
      outcome(
        asFirm('B', (tx) =>
          tx.supportTicket.create({
            data: ticket('B', { source: 'PORTAL', createdByUserId: ids.ownerB, ...data }),
          }),
        ),
      );
    expect(await raise({ businessId: ids.firmA, contactUserId: ids.ownerA })).toMatch(
      /row-level security/,
    );
    expect(await raise({ source: 'EMAIL' })).toMatch(/row-level security/);
    expect(await raise({ assignedUserId: ids.admin })).toMatch(/row-level security/);
    // A firm never changes a ticket (the team does).
    const t = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('B') }));
    const changed = await asFirm('B', (tx) =>
      tx.supportTicket.updateMany({
        where: { id: t.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      }),
    );
    expect(changed.count).toBe(0);
  });

  it('the contact is a member of the firm, also when the team raises it', async () => {
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.supportTicket.create({ data: ticket('A', { contactUserId: ids.stranger }) }),
        ),
      ),
    ).toMatch(/Foreign key constraint/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.supportTicket.create({ data: ticket('A', { contactUserId: ids.ownerB }) }),
        ),
      ),
    ).toMatch(/Foreign key constraint/);
  });

  it('what a ticket is never changes; closing and merging carry their facts', async () => {
    const t = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    const update = (data: Record<string, unknown>) =>
      outcome(asAdmin((tx) => tx.supportTicket.update({ where: { id: t.id }, data })));
    expect(await update({ subject: 'Re: cannot upload' })).toBe('ok');
    expect(await update({ source: 'PHONE' })).toMatch(/never change/);
    expect(await update({ status: 'CLOSED' })).toMatch(/support_tickets_values/);
    const other = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    expect(await update({ mergedIntoTicketId: other.id })).toMatch(/support_tickets_values/);
    expect(
      await update({
        mergedIntoTicketId: other.id,
        status: 'CLOSED',
        closedAt: new Date(),
        closedByUserId: ids.admin,
      }),
    ).toBe('ok');
  });
});

describe('the conversation, notes, history and files', () => {
  it('replies: the team as STAFF under its own name, a firm member as CUSTOMER under theirs', async () => {
    const t = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    const msg = (scope: 'admin' | 'A' | 'B', data: Record<string, unknown>) => {
      const row = { businessId: ids.firmA, ticketId: t.id, body: 'Hello', ...data };
      return outcome(
        scope === 'admin'
          ? asAdmin((tx) => tx.supportTicketMessage.create({ data: row as never }))
          : asFirm(scope, (tx) => tx.supportTicketMessage.create({ data: row as never })),
      );
    };
    expect(await msg('admin', { authorUserId: ids.admin, authorSide: 'STAFF' })).toBe('ok');
    expect(await msg('admin', { authorUserId: ids.ownerA, authorSide: 'STAFF' })).toMatch(
      /row-level security/,
    );
    expect(await msg('A', { authorUserId: ids.ownerA, authorSide: 'CUSTOMER' })).toBe('ok');
    expect(await msg('A', { authorUserId: ids.ownerA, authorSide: 'STAFF' })).toMatch(
      /row-level security/,
    );
    expect(await msg('B', { authorUserId: ids.ownerB, authorSide: 'CUSTOMER' })).toMatch(
      /row-level security/,
    );
    expect(
      await asFirm('A', (tx) => tx.supportTicketMessage.count({ where: { ticketId: t.id } })),
    ).toBe(2);
    expect(
      await asFirm('B', (tx) => tx.supportTicketMessage.count({ where: { ticketId: t.id } })),
    ).toBe(0);
  });

  it('notes, note files and the history never reach the firm; nothing written is edited or deleted', async () => {
    const t = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    const note = await asAdmin((tx) =>
      tx.supportTicketNote.create({
        data: {
          businessId: ids.firmA,
          ticketId: t.id,
          authorUserId: ids.admin,
          body: 'Internal only.',
        },
      }),
    );
    await asAdmin((tx) =>
      tx.supportTicketEvent.create({
        data: {
          businessId: ids.firmA,
          ticketId: t.id,
          actorUserId: ids.admin,
          actorType: 'USER',
          action: 'ticket.assigned',
        },
      }),
    );
    const file = (noteId: string | null) => ({
      businessId: ids.firmA,
      ticketId: t.id,
      noteId,
      uploadedByUserId: ids.admin,
      fileName: 'log.txt',
      contentType: 'text/plain',
      sizeBytes: 120,
      sha256: createHash('sha256').update(randomUUID()).digest('hex'),
      s3Key: `tenant/${ids.firmA}/support/${randomUUID()}`,
    });
    await asAdmin((tx) => tx.supportTicketAttachment.create({ data: file(note.id) }));
    const seen = await asFirm('A', async (tx) => ({
      notes: await tx.supportTicketNote.count(),
      events: await tx.supportTicketEvent.count(),
      files: await tx.supportTicketAttachment.count({ where: { ticketId: t.id } }),
    }));
    expect(seen).toEqual({ notes: 0, events: 0, files: 0 });
    // A firm cannot add a file to a note.
    expect(
      await outcome(
        asFirm('A', (tx) =>
          tx.supportTicketAttachment.create({
            data: { ...file(note.id), uploadedByUserId: ids.ownerA },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    // One at a time: each attempt starts only when the loop reaches it, so no rejection goes unhandled.
    for (const attempt of [
      () =>
        asAdmin((tx) =>
          tx.supportTicketNote.update({ where: { id: note.id }, data: { body: 'Edited' } }),
        ),
      () => asAdmin((tx) => tx.supportTicketNote.deleteMany({ where: { id: note.id } })),
      () => asAdmin((tx) => tx.supportTicketEvent.deleteMany({ where: { ticketId: t.id } })),
      () => asAdmin((tx) => tx.supportTicketMessage.deleteMany({ where: { ticketId: t.id } })),
    ]) {
      expect(await outcome(attempt())).toMatch(/permission denied/i);
    }
  });

  it('files: under the firm prefix, at most 10 MB, and only the scanner records the result, once', async () => {
    const t = await asAdmin((tx) => tx.supportTicket.create({ data: ticket('A') }));
    const base = {
      businessId: ids.firmA,
      ticketId: t.id,
      uploadedByUserId: ids.admin,
      fileName: 'screen.png',
      contentType: 'image/png',
      sizeBytes: 1000,
      sha256: createHash('sha256').update(randomUUID()).digest('hex'),
    };
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.supportTicketAttachment.create({
            data: { ...base, s3Key: `tenant/${ids.firmB}/support/${randomUUID()}` },
          }),
        ),
      ),
    ).toMatch(/support_ticket_attachments_values/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.supportTicketAttachment.create({
            data: {
              ...base,
              sizeBytes: 10_485_761,
              s3Key: `tenant/${ids.firmA}/support/${randomUUID()}`,
            },
          }),
        ),
      ),
    ).toMatch(/support_ticket_attachments_values/);
    const f = await asAdmin((tx) =>
      tx.supportTicketAttachment.create({
        data: { ...base, s3Key: `tenant/${ids.firmA}/support/${randomUUID()}` },
      }),
    );
    const scan = (data: Record<string, unknown>) =>
      outcome(asPlatform((tx) => tx.supportTicketAttachment.update({ where: { id: f.id }, data })));
    expect(await scan({ fileName: 'other.png' })).toMatch(/only the scan result changes/);
    expect(await scan({ scanStatus: 'CLEAN', scannedAt: new Date() })).toBe('ok');
    expect(await scan({ scanStatus: 'INFECTED' })).toMatch(/only the scan result changes, once/);
  });
});

describe('reference data and settings', () => {
  it('a firm reads the categories and priorities it picks from, nothing else, and writes none', async () => {
    const firm = await asFirm('A', async (tx) => ({
      categories: await tx.supportCategory.count(),
      priorities: await tx.supportPriority.count(),
      settings: await tx.supportSettings.count(),
      canned: await tx.supportCannedResponse.count(),
      rules: await tx.supportNotificationRule.count(),
    }));
    expect(firm.categories).toBeGreaterThan(0);
    expect(firm.priorities).toBe(4);
    expect([firm.settings, firm.canned, firm.rules]).toEqual([0, 0, 0]);
    expect(
      await outcome(
        asFirm('A', (tx) => tx.supportCategory.create({ data: { name: `Mine ${run}` } })),
      ),
    ).toMatch(/row-level security/);
  });
});
