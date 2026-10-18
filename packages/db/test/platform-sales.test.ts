// R0 stage B5 (Oct 17): the Super Admin Sales Pipeline. One dataset (contacts, opportunities in a
// pipeline's stages); the database keeps the lifecycle rules (lost needs a reason, Under Contract
// and Closed follow the linked transaction, required fields, inactive stages), writes the stage and
// assignment history itself, and protects shipped stages and stages holding records. Platform
// data: no firm scope reaches it.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  ceo: randomUUID(),
  rep: randomUUID(),
  outsider: randomUUID(),
  firm: '',
  pipeline: '',
};
const stages: Record<string, string> = {};

const asAdmin = <T>(adminUserId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.ceo, ids.rep, ids.outsider]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.rep, role: 'TEAM_MEMBER' } });
    await tx.platformAdmin.create({ data: { userId: ids.outsider, role: 'TEAM_MEMBER' } });
    const code = run.toUpperCase();
    const dept = await tx.platformDepartment.create({
      data: { code: `B5_DEPT_${code}`, name: 'Sales' },
    });
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B5_CEO_${code}`,
        title: 'CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    const repRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B5_REP_${code}`,
        title: 'Account Executive',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.ceo,
        roleDefinitionId: ceoRole.id,
        departmentId: dept.id,
        scopeType: 'COMPANY',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.rep,
        roleDefinitionId: repRole.id,
        departmentId: dept.id,
        reportsToUserId: ids.ceo,
        scopeType: 'OWN_RECORDS',
      },
    });
    ids.firm = (await tx.business.create({ data: { slug: `b5-${run}`, name: 'Firm' } })).id;
    const pipeline = await tx.salesPipeline.findUniqueOrThrow({
      where: { systemKey: 'firmivra_default' },
      include: { stages: true },
    });
    ids.pipeline = pipeline.id;
    for (const s of pipeline.stages) stages[s.systemKey!] = s.id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

/** A contact and an opportunity in New Lead, created by the rep. */
const newDeal = async (extra: Record<string, unknown> = {}) =>
  asAdmin(ids.rep, async (tx) => {
    const contact = await tx.salesContact.create({
      data: { name: 'Jordan Ellis', email: ` Jordan.Ellis@Example.TEST `, phone: '(512) 555-0199' },
    });
    return tx.salesOpportunity.create({
      data: {
        pipelineId: ids.pipeline,
        stageId: stages.new_lead!,
        contactId: contact.id,
        title: `Ellis Tax ${run}`,
        assignedToUserId: ids.rep,
        ...extra,
      },
    });
  });
const move = (adminUserId: string, id: string, data: Record<string, unknown>) =>
  asAdmin(adminUserId, (tx) => tx.salesOpportunity.update({ where: { id }, data }));
const history = (opportunityId: string) =>
  asAdmin(ids.ceo, (tx) =>
    tx.salesStageHistory.findMany({ where: { opportunityId }, orderBy: { createdAt: 'asc' } }),
  );

describe('sales: who reaches it', () => {
  it('ships the default pipeline; the team and the platform read it; no firm and no outsider does', async () => {
    expect(Object.keys(stages).sort()).toEqual(
      [
        'active_client',
        'appointment_set',
        'attempted_contact',
        'closed_past_client',
        'contacted',
        'nurturing',
        'new_lead',
        'qualified',
        'under_contract',
        'unqualified_lost',
      ].sort(),
    );
    const deal = await newDeal();
    const where = { where: { id: deal.id } };
    expect(await asAdmin(ids.ceo, (tx) => tx.salesOpportunity.count(where))).toBe(1);
    expect(await asPlatform((tx) => tx.salesOpportunity.count(where))).toBe(1);
    expect(await asAdmin(ids.outsider, (tx) => tx.salesOpportunity.count(where))).toBe(0);
    expect(await asFirm((tx) => tx.salesOpportunity.count())).toBe(0);
    expect(await asFirm((tx) => tx.salesPipeline.count())).toBe(0);
    expect(
      await outcome(asFirm((tx) => tx.salesContact.create({ data: { name: 'From a firm' } }))),
    ).toMatch(/row-level security/);
  });
});

describe('sales: contacts and history', () => {
  it('normalizes email and phone; writes the creation and the owner change itself', async () => {
    const deal = await newDeal();
    const contact = await asAdmin(ids.ceo, (tx) =>
      tx.salesContact.findUniqueOrThrow({ where: { id: deal.contactId } }),
    );
    expect(contact).toMatchObject({
      emailNormalized: 'jordan.ellis@example.test',
      phoneNormalized: '5125550199',
      createdByUserId: ids.rep,
    });
    expect(deal.createdByUserId).toBe(ids.rep);
    await move(ids.ceo, deal.id, { assignedToUserId: ids.ceo });
    const owners = await asAdmin(ids.ceo, (tx) =>
      tx.salesAssignmentHistory.findMany({
        where: { opportunityId: deal.id },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(owners.map((o) => [o.fromUserId, o.toUserId, o.actorUserId])).toEqual([
      [null, ids.rep, ids.rep],
      [ids.rep, ids.ceo, ids.ceo],
    ]);
    // The app never writes history itself.
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) =>
          tx.salesStageHistory.create({
            data: {
              opportunityId: deal.id,
              toStageName: 'Forged',
              toStageType: 'CLOSED',
              source: 'MANUAL',
            },
          }),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) => tx.salesOpportunity.deleteMany({ where: { id: deal.id } })),
      ),
    ).toMatch(/permission denied/i);
  });

  it('a stage change keeps the names of the time; an automation is recorded as one', async () => {
    const deal = await newDeal();
    await move(ids.rep, deal.id, { stageId: stages.attempted_contact });
    await asAdmin(ids.rep, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.sales_change_source', 'AUTOMATION', true)`;
      await tx.salesOpportunity.update({
        where: { id: deal.id },
        data: { stageId: stages.contacted },
      });
    });
    const rows = await history(deal.id);
    expect(rows.map((r) => [r.fromStageName, r.toStageName, r.source, r.actorUserId])).toEqual([
      [null, 'New Lead', 'MANUAL', ids.rep],
      ['New Lead', 'Attempted Contact', 'MANUAL', ids.rep],
      ['Attempted Contact', 'Contacted', 'AUTOMATION', ids.rep],
    ]);
  });
});

describe('sales: the lifecycle rules', () => {
  it('a lost record needs a reason (and a note for OTHER); leaving lost clears them, history keeps them', async () => {
    const deal = await newDeal();
    expect(await outcome(move(ids.rep, deal.id, { stageId: stages.unqualified_lost }))).toMatch(
      /needs a reason/,
    );
    expect(
      await outcome(
        move(ids.rep, deal.id, { stageId: stages.unqualified_lost, lostReason: 'OTHER' }),
      ),
    ).toMatch(/needs a note/);
    expect(await outcome(move(ids.rep, deal.id, { lostReason: 'BUDGET' }))).toMatch(
      /comes with a lost stage/,
    );
    const lost = await move(ids.rep, deal.id, {
      stageId: stages.unqualified_lost,
      lostReason: 'CHOSE_COMPETITOR',
      lostNote: 'Went with their current vendor for one more season.',
    });
    expect(lost.lostAt).not.toBeNull();
    const back = await move(ids.rep, deal.id, { stageId: stages.nurturing });
    expect(back).toMatchObject({ lostReason: null, lostNote: null, lostAt: null });
    const rows = await history(deal.id);
    expect(rows.find((r) => r.toStageName === 'Unqualified / Lost')).toMatchObject({
      lostReason: 'CHOSE_COMPETITOR',
    });
  });

  it("converting stamps the conversion once; a stage's required fields and an inactive stage hold", async () => {
    const deal = await newDeal();
    const converted = await move(ids.rep, deal.id, { stageId: stages.active_client });
    expect(converted.convertedAt).not.toBeNull();
    const again = await move(ids.rep, deal.id, { stageId: stages.nurturing });
    expect(again.convertedAt).toEqual(converted.convertedAt);
    const custom = await asAdmin(ids.ceo, (tx) =>
      tx.salesPipelineStage.create({
        data: {
          pipelineId: ids.pipeline,
          name: `Proposal ${run}`,
          stageType: 'ACTIVE',
          position: 20,
          requiredFields: ['value'],
        },
      }),
    );
    expect(await outcome(move(ids.rep, deal.id, { stageId: custom.id }))).toMatch(/needs value/);
    await move(ids.rep, deal.id, { stageId: custom.id, valueCents: 120_000 });
    // Holding a record: its type stays and it can't be deleted; deactivated, it takes no new one.
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) =>
          tx.salesPipelineStage.update({ where: { id: custom.id }, data: { stageType: 'CLOSED' } }),
        ),
      ),
    ).toMatch(/move the records out/);
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) => tx.salesPipelineStage.delete({ where: { id: custom.id } })),
      ),
    ).toMatch(/foreign key|Foreign key/);
    await asAdmin(ids.ceo, (tx) =>
      tx.salesPipelineStage.update({
        where: { id: custom.id },
        data: { isActive: false, name: `Old ${run}` },
      }),
    );
    const other = await newDeal({ valueCents: 5_000 });
    expect(await outcome(move(ids.rep, other.id, { stageId: custom.id }))).toMatch(/inactive/);
    // History keeps the name it had.
    expect((await history(deal.id)).at(-1)!.toStageName).toBe(`Proposal ${run}`);
  });

  it('shipped stages keep their key and type and are never deleted; only the migration ships keys', async () => {
    for (const attempt of [
      () =>
        asAdmin(ids.ceo, (tx) =>
          tx.salesPipelineStage.delete({ where: { id: stages.nurturing! } }),
        ),
      () =>
        asAdmin(ids.ceo, (tx) =>
          tx.salesPipelineStage.update({
            where: { id: stages.nurturing! },
            data: { stageType: 'CONVERTED' },
          }),
        ),
      () =>
        asAdmin(ids.ceo, (tx) =>
          tx.salesPipelineStage.create({
            data: {
              pipelineId: ids.pipeline,
              name: `Keyed ${run}`,
              systemKey: 'keyed',
              stageType: 'ACTIVE',
              position: 30,
            },
          }),
        ),
    ]) {
      expect(await outcome(attempt())).toMatch(/sales stages:/);
    }
    // Renaming a shipped stage is fine.
    await asAdmin(ids.ceo, (tx) =>
      tx.salesPipelineStage.update({ where: { id: stages.nurturing! }, data: { name: 'Nurture' } }),
    );
    await asAdmin(ids.ceo, (tx) =>
      tx.salesPipelineStage.update({
        where: { id: stages.nurturing! },
        data: { name: 'Nurturing' },
      }),
    );
  });
});

describe('sales: the transaction sync (no double entry)', () => {
  it('Under Contract, Terminated and Closed follow the transaction; a person cannot move them', async () => {
    const deal = await newDeal();
    await move(ids.rep, deal.id, { stageId: stages.active_client });
    expect(await outcome(move(ids.rep, deal.id, { stageId: stages.under_contract }))).toMatch(
      /the stage Under Contract needs transaction|Under Contract follows/,
    );
    const subscription = randomUUID();
    await move(ids.rep, deal.id, {
      transactionKind: 'platform_subscription',
      transactionId: subscription,
      transactionStatus: 'OPEN',
    });
    const signed = await asPlatform((tx) =>
      tx.salesOpportunity.update({
        where: { id: deal.id },
        data: { transactionStatus: 'UNDER_CONTRACT' },
      }),
    );
    expect(signed.stageId).toBe(stages.under_contract);
    expect(signed.transactionSyncedAt).not.toBeNull();
    for (const data of [
      { stageId: stages.nurturing },
      { transactionKind: null, transactionId: null, transactionStatus: null },
    ]) {
      expect(await outcome(move(ids.rep, deal.id, data))).toMatch(
        /follows the UNDER_CONTRACT transaction|not unlinked/,
      );
    }
    const terminated = await asPlatform((tx) =>
      tx.salesOpportunity.update({
        where: { id: deal.id },
        data: { transactionStatus: 'TERMINATED' },
      }),
    );
    expect(terminated.stageId).toBe(stages.active_client);
    await asPlatform((tx) =>
      tx.salesOpportunity.update({
        where: { id: deal.id },
        data: { transactionStatus: 'UNDER_CONTRACT' },
      }),
    );
    const closed = await asPlatform((tx) =>
      tx.salesOpportunity.update({ where: { id: deal.id }, data: { transactionStatus: 'CLOSED' } }),
    );
    expect(closed.stageId).toBe(stages.closed_past_client);
    const rows = await history(deal.id);
    expect(rows.slice(-4).map((r) => [r.toStageName, r.source, r.transactionStatus])).toEqual([
      ['Under Contract', 'TRANSACTION', 'UNDER_CONTRACT'],
      ['Active Client', 'TRANSACTION', 'TERMINATED'],
      ['Under Contract', 'TRANSACTION', 'UNDER_CONTRACT'],
      ['Closed / Past Client', 'TRANSACTION', 'CLOSED'],
    ]);
  });
});

describe('sales: activity, follow-ups and notes', () => {
  it('activity is logged once by the signed-in member, never in the future, and only on its own follow-up', async () => {
    const deal = await newDeal();
    const other = await newDeal();
    const followUp = await asAdmin(ids.rep, (tx) =>
      tx.salesFollowUp.create({
        data: {
          opportunityId: other.id,
          kind: 'CALL',
          title: 'Call back',
          dueAt: new Date(Date.now() + 86_400_000),
        },
      }),
    );
    const call = await asAdmin(ids.rep, (tx) =>
      tx.salesActivity.create({
        data: {
          opportunityId: deal.id,
          kind: 'CALL',
          direction: 'OUTBOUND',
          outcome: 'NO_ANSWER',
          occurredAt: new Date(),
        },
      }),
    );
    expect(call.actorUserId).toBe(ids.rep);
    for (const data of [
      { occurredAt: new Date(Date.now() + 3_600_000) },
      { followUpId: followUp.id },
    ]) {
      expect(
        await outcome(
          asAdmin(ids.rep, (tx) =>
            tx.salesActivity.create({
              data: {
                opportunityId: deal.id,
                kind: 'EMAIL',
                direction: 'OUTBOUND',
                occurredAt: new Date(),
                ...data,
              },
            }),
          ),
        ),
      ).toMatch(/sales activities:/);
    }
    expect(
      await outcome(
        asAdmin(ids.rep, (tx) =>
          tx.salesActivity.update({ where: { id: call.id }, data: { summary: 'Edited' } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });

  it('follow-ups move once to completed or cancelled, stamped by the database', async () => {
    const deal = await newDeal();
    const f = await asAdmin(ids.rep, (tx) =>
      tx.salesFollowUp.create({
        data: {
          opportunityId: deal.id,
          kind: 'DEMO',
          title: 'Product demo',
          dueAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000 + 1_800_000),
        },
      }),
    );
    expect(f.createdByUserId).toBe(ids.rep);
    const moved = await asAdmin(ids.rep, (tx) =>
      tx.salesFollowUp.update({
        where: { id: f.id },
        data: {
          dueAt: new Date(Date.now() + 2 * 86_400_000),
          endsAt: new Date(Date.now() + 2 * 86_400_000 + 1_800_000),
        },
      }),
    );
    expect(moved.status).toBe('SCHEDULED');
    const done = await asAdmin(ids.rep, (tx) =>
      tx.salesFollowUp.update({ where: { id: f.id }, data: { status: 'COMPLETED' } }),
    );
    expect(done.completedAt).not.toBeNull();
    expect(
      await outcome(
        asAdmin(ids.rep, (tx) =>
          tx.salesFollowUp.update({ where: { id: f.id }, data: { status: 'CANCELLED' } }),
        ),
      ),
    ).toMatch(/a COMPLETED follow-up never changes/);
  });

  it('notes: only the author edits or deletes one', async () => {
    const deal = await newDeal();
    const note = await asAdmin(ids.rep, (tx) =>
      tx.salesNote.create({
        data: { opportunityId: deal.id, authorUserId: ids.rep, body: 'Prefers email.' },
      }),
    );
    expect(
      await outcome(
        asAdmin(ids.rep, (tx) =>
          tx.salesNote.create({
            data: { opportunityId: deal.id, authorUserId: ids.ceo, body: 'As the CEO' },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await asAdmin(ids.ceo, (tx) =>
        tx.salesNote.updateMany({ where: { id: note.id }, data: { body: 'Edited by the CEO' } }),
      ),
    ).toEqual({ count: 0 });
    expect(
      await asAdmin(ids.ceo, (tx) => tx.salesNote.deleteMany({ where: { id: note.id } })),
    ).toEqual({ count: 0 });
    await expect(
      asAdmin(ids.rep, (tx) =>
        tx.salesNote.update({
          where: { id: note.id },
          data: { body: 'Prefers email, not calls.' },
        }),
      ),
    ).resolves.toMatchObject({ body: 'Prefers email, not calls.' });
    expect(
      await asAdmin(ids.rep, (tx) => tx.salesNote.deleteMany({ where: { id: note.id } })),
    ).toEqual({ count: 1 });
  });
});
