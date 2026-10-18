// R0 stage D1 (Oct 19): the Sales Center. Targets and goals (company, team or rep; a metric over a
// calendar or custom period; one live per subject, metric and period; archived, never edited into
// another target) and lead import batches (a lifecycle the database keeps, row outcomes that carry
// no row data, counts only the outcomes move). Platform data: no firm scope reaches it.
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
  dept: '',
  oldDept: '',
  pipeline: '',
};
const stages: Record<string, string> = {};
/** A year of its own per test run, so live-target uniqueness never meets another run's rows. */
const year = 2100 + (parseInt(run.slice(0, 4), 16) % 800);
const day = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d));

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
      data: { code: `D1_SALES_${code}`, name: 'Sales' },
    });
    ids.dept = dept.id;
    ids.oldDept = (
      await tx.platformDepartment.create({
        data: { code: `D1_OLD_${code}`, name: 'Old team', isActive: false },
      })
    ).id;
    const role = await tx.platformRoleDefinition.create({
      data: {
        code: `D1_REP_${code}`,
        title: 'Account Executive',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.rep,
        roleDefinitionId: role.id,
        departmentId: dept.id,
        scopeType: 'OWN_RECORDS',
      },
    });
    ids.firm = (await tx.business.create({ data: { slug: `d1-${run}`, name: 'Firm' } })).id;
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

const monthTarget = (extra: Record<string, unknown> = {}) => ({
  name: `New leads ${run}`,
  scope: 'COMPANY' as const,
  metric: 'NEW_LEADS' as const,
  targetValue: 20,
  periodType: 'MONTH' as const,
  periodStart: day(3, 1),
  periodEnd: day(3, 31),
  ...extra,
});
const createTarget = (data: Record<string, unknown>, adminUserId = ids.ceo) =>
  asAdmin(adminUserId, (tx) =>
    tx.salesTarget.create({
      data: data as Parameters<TxClient['salesTarget']['create']>[0]['data'],
    }),
  );

describe('sales center: who reaches it', () => {
  it('the team and the platform job read targets and imports; no firm and no outsider does', async () => {
    const target = await createTarget(
      monthTarget({ periodStart: day(1, 1), periodEnd: day(1, 31) }),
    );
    expect(target.createdByUserId).toBe(ids.ceo);
    const where = { where: { id: target.id } };
    expect(await asPlatform((tx) => tx.salesTarget.count(where))).toBe(1);
    expect(await asAdmin(ids.rep, (tx) => tx.salesTarget.count(where))).toBe(1);
    expect(await asAdmin(ids.outsider, (tx) => tx.salesTarget.count(where))).toBe(0);
    expect(await asFirm((tx) => tx.salesTarget.count(where))).toBe(0);
    expect(await asFirm((tx) => tx.salesLeadImport.count())).toBe(0);
    expect(await asFirm((tx) => tx.salesLeadImportRow.count())).toBe(0);
    expect(
      await outcome(
        asFirm((tx) =>
          tx.salesTarget.create({
            data: monthTarget({
              periodStart: day(2, 1),
              periodEnd: day(2, 28 + (year % 4 === 0 ? 1 : 0)),
            }),
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('targets are archived, never deleted; row outcomes are insert-only', async () => {
    const target = await createTarget(
      monthTarget({ periodStart: day(4, 1), periodEnd: day(4, 30) }),
    );
    expect(
      await outcome(asAdmin(ids.ceo, (tx) => tx.salesTarget.delete({ where: { id: target.id } }))),
    ).toMatch(/permission denied/);
    const batch = await finishedBatch();
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) => tx.salesLeadImport.delete({ where: { id: batch.id } })),
      ),
    ).toMatch(/permission denied/);
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.salesLeadImportRow.updateMany({
            where: { importId: batch.id },
            data: { rowNumber: 9 },
          }),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('sales center: targets', () => {
  it('belong to exactly one subject: the company, an active team or a rep', async () => {
    const team = await createTarget(
      monthTarget({
        scope: 'TEAM',
        departmentId: ids.dept,
        periodStart: day(5, 1),
        periodEnd: day(5, 31),
      }),
    );
    expect(team.departmentId).toBe(ids.dept);
    const rep = await createTarget(
      monthTarget({ scope: 'REP', userId: ids.rep, periodStart: day(5, 1), periodEnd: day(5, 31) }),
    );
    expect(rep.userId).toBe(ids.rep);
    for (const bad of [
      monthTarget({ departmentId: ids.dept }),
      monthTarget({ scope: 'TEAM' }),
      monthTarget({ scope: 'REP', userId: ids.rep, departmentId: ids.dept }),
      monthTarget({ scope: 'REP' }),
    ]) {
      expect(await outcome(createTarget(bad))).toMatch(/sales_targets_values/);
    }
    expect(
      await outcome(createTarget(monthTarget({ scope: 'TEAM', departmentId: ids.oldDept }))),
    ).toMatch(/active department/);
  });

  it('cover a whole calendar month, quarter or year, or a custom range of up to 366 days', async () => {
    await createTarget(
      monthTarget({
        metric: 'WON_DEALS',
        periodType: 'QUARTER',
        periodStart: day(4, 1),
        periodEnd: day(6, 30),
      }),
    );
    await createTarget(
      monthTarget({
        metric: 'WON_DEALS',
        periodType: 'YEAR',
        periodStart: day(1, 1),
        periodEnd: day(12, 31),
      }),
    );
    await createTarget(
      monthTarget({
        metric: 'WON_DEALS',
        periodType: 'CUSTOM',
        periodStart: day(3, 10),
        periodEnd: day(3, 24),
      }),
    );
    for (const bad of [
      monthTarget({ periodStart: day(3, 2), periodEnd: day(3, 31) }),
      monthTarget({ periodStart: day(3, 1), periodEnd: day(3, 30) }),
      monthTarget({ periodType: 'QUARTER', periodStart: day(2, 1), periodEnd: day(4, 30) }),
      monthTarget({ periodType: 'YEAR', periodStart: day(1, 1), periodEnd: day(6, 30) }),
      monthTarget({ periodType: 'CUSTOM', periodStart: day(3, 24), periodEnd: day(3, 10) }),
      monthTarget({
        periodType: 'CUSTOM',
        periodStart: day(1, 1),
        periodEnd: new Date(Date.UTC(year + 1, 0, 2)),
      }),
    ]) {
      expect(await outcome(createTarget(bad))).toMatch(/sales_targets_values/);
    }
  });

  it('aim above zero; a conversion rate is at most 10,000 basis points', async () => {
    const p = { periodStart: day(6, 1), periodEnd: day(6, 30) };
    expect(await outcome(createTarget(monthTarget({ ...p, targetValue: 0 })))).toMatch(
      /sales_targets_values/,
    );
    await createTarget(monthTarget({ ...p, metric: 'CONVERSION_RATE', targetValue: 2500 }));
    expect(
      await outcome(
        createTarget(monthTarget({ ...p, metric: 'REVENUE_WON', targetValue: 10_001 })),
      ),
    ).toBe('ok');
    expect(
      await outcome(
        createTarget(
          monthTarget({
            ...p,
            scope: 'REP',
            userId: ids.rep,
            metric: 'CONVERSION_RATE',
            targetValue: 10_001,
          }),
        ),
      ),
    ).toMatch(/sales_targets_values/);
  });

  it('one live target per subject, metric and period; archiving frees the slot and is final', async () => {
    const p = { periodStart: day(7, 1), periodEnd: day(7, 31) };
    const first = await createTarget(monthTarget(p));
    expect(await outcome(createTarget(monthTarget(p)))).toMatch(
      /Unique constraint|sales_targets_one_live/,
    );
    // The same period for a rep, or another metric, is another target.
    await createTarget(monthTarget({ ...p, scope: 'REP', userId: ids.rep }));
    await createTarget(monthTarget({ ...p, metric: 'DEMOS_SCHEDULED' }));

    const archived = await asAdmin(ids.rep, (tx) =>
      tx.salesTarget.update({ where: { id: first.id }, data: { archivedAt: new Date(0) } }),
    );
    expect(archived.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(archived.updatedByUserId).toBe(ids.rep);
    expect(archived.createdByUserId).toBe(ids.ceo);
    await createTarget(monthTarget(p));
    expect(
      await outcome(
        asAdmin(ids.ceo, (tx) =>
          tx.salesTarget.update({ where: { id: first.id }, data: { targetValue: 30 } }),
        ),
      ),
    ).toMatch(/archived target never changes/);
  });

  it('change their name, goal and note, never their subject, metric or period', async () => {
    const t = await createTarget(monthTarget({ periodStart: day(8, 1), periodEnd: day(8, 31) }));
    const edit = (data: Record<string, unknown>) =>
      outcome(asAdmin(ids.ceo, (tx) => tx.salesTarget.update({ where: { id: t.id }, data })));
    expect(
      await edit({ name: 'August new leads', targetValue: 25, note: 'Raised after the webinar.' }),
    ).toBe('ok');
    for (const data of [
      { metric: 'WON_DEALS' },
      { scope: 'REP', userId: ids.rep },
      { periodStart: day(9, 1), periodEnd: day(9, 30) },
      { createdByUserId: ids.rep },
    ]) {
      expect(await edit(data)).toMatch(/never change/);
    }
  });

  it('go with their rep when that admin is removed', async () => {
    const gone = randomUUID();
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      await tx.user.create({
        data: {
          id: gone,
          cognitoSub: gone,
          pool: 'ADMIN',
          email: `${gone}@sup.test`,
          name: 'Fake',
        },
      });
      await tx.platformAdmin.create({ data: { userId: gone, role: 'SUPER_ADMIN' } });
    });
    const t = await createTarget(
      monthTarget({ scope: 'REP', userId: gone, periodStart: day(9, 1), periodEnd: day(9, 30) }),
    );
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.delete({ where: { userId: gone } }),
    );
    expect(await asAdmin(ids.ceo, (tx) => tx.salesTarget.count({ where: { id: t.id } }))).toBe(0);
  });
});

// ---------- Imports ----------
const newBatch = (extra: Record<string, unknown> = {}) =>
  asAdmin(ids.ceo, (tx) =>
    tx.salesLeadImport.create({
      data: {
        fileName: `leads-${run}.csv`,
        fileSizeBytes: 4096,
        pipelineId: ids.pipeline,
        ...extra,
      } as Parameters<TxClient['salesLeadImport']['create']>[0]['data'],
    }),
  );
const setBatch = (id: string, data: Record<string, unknown>) =>
  asPlatform((tx) => tx.salesLeadImport.update({ where: { id }, data }));
/** A contact (and with `deal`, an opportunity) as the import job creates them. */
const imported = (deal = true) =>
  asPlatform(async (tx) => {
    const contact = await tx.salesContact.create({
      data: { name: 'Imported Lead', email: `lead-${randomUUID().slice(0, 8)}@import.test` },
    });
    const opportunity = deal
      ? await tx.salesOpportunity.create({
          data: {
            pipelineId: ids.pipeline,
            stageId: stages.new_lead!,
            contactId: contact.id,
            title: 'Imported Lead',
          },
        })
      : null;
    return { contactId: contact.id, opportunityId: opportunity?.id ?? null };
  });
const addRow = (importId: string, data: Record<string, unknown>) =>
  asPlatform((tx) =>
    tx.salesLeadImportRow.create({
      data: { importId, ...data } as Parameters<
        TxClient['salesLeadImportRow']['create']
      >[0]['data'],
    }),
  );
/** A batch run to COMPLETED with one imported and one skipped row. */
const finishedBatch = async () => {
  const batch = await newBatch();
  await setBatch(batch.id, { status: 'PROCESSING', totalRows: 2 });
  await addRow(batch.id, { rowNumber: 1, outcome: 'IMPORTED', ...(await imported()) });
  await addRow(batch.id, { rowNumber: 2, outcome: 'SKIPPED', reasonCode: 'missing_name' });
  return setBatch(batch.id, { status: 'COMPLETED' });
};

describe('sales center: lead imports', () => {
  it('start PENDING and empty, stamped by the database', async () => {
    const batch = await newBatch({
      fileSha256: 'a'.repeat(64),
      s3Key: `platform/sales-imports/${run}.csv`,
    });
    expect(batch).toMatchObject({ status: 'PENDING', importedCount: 0, createdByUserId: ids.ceo });
    expect(batch.startedAt).toBeNull();
    for (const bad of [
      { status: 'PROCESSING' },
      { importedCount: 3 },
      { failureCode: 'bad_file' },
    ]) {
      expect(await outcome(newBatch(bad))).toMatch(/starts PENDING|sales_lead_imports_values/);
    }
    for (const bad of [
      { s3Key: 'tenant/x/leads.csv' },
      { s3Key: 'platform/sales-imports/../secrets' },
      { fileSha256: 'ABC' },
      { fileSizeBytes: 0 },
      { columnMapping: ['email'] },
    ]) {
      expect(await outcome(newBatch(bad))).toMatch(/sales_lead_imports_values/);
    }
  });

  it('send new leads to an active stage of type ACTIVE', async () => {
    expect(await outcome(newBatch({ stageId: stages.contacted }))).toBe('ok');
    expect(await outcome(newBatch({ stageId: stages.active_client }))).toMatch(/active stage/);
  });

  it('move PENDING to PROCESSING or CANCELLED, then to COMPLETED or FAILED; the database stamps the times', async () => {
    const batch = await newBatch();
    expect(await outcome(setBatch(batch.id, { status: 'COMPLETED' }))).toMatch(/cannot become/);
    const started = await setBatch(batch.id, {
      status: 'PROCESSING',
      totalRows: 0,
      startedAt: new Date(0),
    });
    expect(started.startedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await outcome(setBatch(batch.id, { status: 'CANCELLED' }))).toMatch(/cannot become/);
    expect(await outcome(setBatch(batch.id, { status: 'FAILED' }))).toMatch(
      /sales_lead_imports_values/,
    );
    const failed = await setBatch(batch.id, { status: 'FAILED', failureCode: 'unreadable_file' });
    expect(failed.finishedAt).not.toBeNull();

    const cancelled = await setBatch((await newBatch()).id, { status: 'CANCELLED' });
    expect(cancelled.startedAt).toBeNull();
    expect(cancelled.finishedAt).not.toBeNull();
  });

  it('change the file and settings only while PENDING; a finished batch never changes', async () => {
    const batch = await newBatch();
    expect(await outcome(setBatch(batch.id, { duplicateMode: 'ATTACH_TO_EXISTING' }))).toBe('ok');
    await setBatch(batch.id, { status: 'PROCESSING', totalRows: 1 });
    expect(await outcome(setBatch(batch.id, { duplicateMode: 'SKIP' }))).toMatch(
      /only while PENDING/,
    );
    expect(await outcome(setBatch(batch.id, { assignedToUserId: ids.rep }))).toMatch(
      /only while PENDING/,
    );

    const done = await finishedBatch();
    expect(await outcome(setBatch(done.id, { fileName: 'renamed.csv' }))).toMatch(
      /batch never changes/,
    );
  });

  it('count only through row outcomes, which add up to the rows when it completes', async () => {
    const batch = await newBatch();
    await setBatch(batch.id, { status: 'PROCESSING', totalRows: 3 });
    expect(await outcome(setBatch(batch.id, { importedCount: 3 }))).toMatch(
      /come from the row outcomes/,
    );
    await addRow(batch.id, { rowNumber: 1, outcome: 'IMPORTED', ...(await imported()) });
    await addRow(batch.id, { rowNumber: 2, outcome: 'FAILED', reasonCode: 'invalid_email' });
    expect(await outcome(setBatch(batch.id, { status: 'COMPLETED' }))).toMatch(
      /sales_lead_imports_values/,
    );
    await addRow(batch.id, { rowNumber: 3, outcome: 'SKIPPED', reasonCode: 'blank_row' });
    const done = await setBatch(batch.id, { status: 'COMPLETED' });
    expect(done).toMatchObject({
      importedCount: 1,
      failedCount: 1,
      skippedCount: 1,
      duplicateCount: 0,
    });
  });

  it('take row outcomes only while PROCESSING, numbered within the batch, once each', async () => {
    const batch = await newBatch();
    expect(
      await outcome(
        addRow(batch.id, { rowNumber: 1, outcome: 'SKIPPED', reasonCode: 'blank_row' }),
      ),
    ).toMatch(/must be PROCESSING/);
    await setBatch(batch.id, { status: 'PROCESSING', totalRows: 2 });
    expect(
      await outcome(
        addRow(batch.id, { rowNumber: 3, outcome: 'SKIPPED', reasonCode: 'blank_row' }),
      ),
    ).toMatch(/past the batch/);
    await addRow(batch.id, { rowNumber: 1, outcome: 'SKIPPED', reasonCode: 'blank_row' });
    expect(
      await outcome(
        addRow(batch.id, { rowNumber: 1, outcome: 'SKIPPED', reasonCode: 'blank_row' }),
      ),
    ).toMatch(/Unique constraint/);
  });

  it("record what each outcome needs: an imported row's contact and opportunity, a duplicate's match", async () => {
    const skip = await newBatch();
    await setBatch(skip.id, { status: 'PROCESSING', totalRows: 9 });
    const fresh = await imported();
    const existing = await imported(false);
    const other = await imported();
    for (const [n, data, error] of [
      [1, { outcome: 'IMPORTED', contactId: fresh.contactId }, /comes with an imported row/],
      [2, { outcome: 'IMPORTED', opportunityId: fresh.opportunityId }, /names its contact/],
      [3, { outcome: 'DUPLICATE', contactId: existing.contactId }, /sales_lead_import_rows_values/],
      [
        4,
        {
          outcome: 'DUPLICATE',
          contactId: existing.contactId,
          matchedBy: 'EMAIL',
          opportunityId: fresh.opportunityId,
        },
        /comes with an imported row/,
      ],
      [
        5,
        { outcome: 'IMPORTED', contactId: existing.contactId, opportunityId: other.opportunityId },
        /the contact's/,
      ],
      [6, { outcome: 'SKIPPED' }, /sales_lead_import_rows_values/],
      [7, { outcome: 'SKIPPED', reasonCode: 'Missing Name' }, /sales_lead_import_rows_values/],
      [
        8,
        { outcome: 'FAILED', reasonCode: 'bad', contactId: existing.contactId },
        /sales_lead_import_rows_values/,
      ],
    ] as const) {
      expect(await outcome(addRow(skip.id, { rowNumber: n, ...data })), `row ${n}`).toMatch(error);
    }
    expect(
      await outcome(
        addRow(skip.id, {
          rowNumber: 9,
          outcome: 'DUPLICATE',
          contactId: existing.contactId,
          matchedBy: 'EMAIL_AND_PHONE',
        }),
      ),
    ).toBe('ok');

    // Attaching to the existing contact: the duplicate row names the new opportunity on it.
    const attach = await newBatch({ duplicateMode: 'ATTACH_TO_EXISTING' });
    await setBatch(attach.id, { status: 'PROCESSING', totalRows: 2 });
    const added = await asPlatform((tx) =>
      tx.salesOpportunity.create({
        data: {
          pipelineId: ids.pipeline,
          stageId: stages.new_lead!,
          contactId: existing.contactId,
          title: 'Second deal',
        },
      }),
    );
    expect(
      await outcome(
        addRow(attach.id, {
          rowNumber: 1,
          outcome: 'DUPLICATE',
          contactId: existing.contactId,
          matchedBy: 'PHONE',
        }),
      ),
    ).toMatch(/comes with an imported row/);
    expect(
      await outcome(
        addRow(attach.id, {
          rowNumber: 2,
          outcome: 'DUPLICATE',
          contactId: existing.contactId,
          matchedBy: 'PHONE',
          opportunityId: added.id,
        }),
      ),
    ).toBe('ok');
  });

  it("keep a finished batch's history when its owner or a matched contact is removed", async () => {
    const gone = randomUUID();
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      await tx.user.create({
        data: {
          id: gone,
          cognitoSub: gone,
          pool: 'ADMIN',
          email: `${gone}@sup.test`,
          name: 'Fake',
        },
      });
      await tx.platformAdmin.create({ data: { userId: gone, role: 'SUPER_ADMIN' } });
    });
    const batch = await newBatch({ assignedToUserId: gone });
    await setBatch(batch.id, { status: 'PROCESSING', totalRows: 1 });
    const match = await imported(false);
    await addRow(batch.id, {
      rowNumber: 1,
      outcome: 'DUPLICATE',
      contactId: match.contactId,
      matchedBy: 'EMAIL',
    });
    await setBatch(batch.id, { status: 'COMPLETED' });

    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.delete({ where: { userId: gone } }),
    );
    await asAdmin(ids.ceo, (tx) => tx.salesContact.delete({ where: { id: match.contactId } }));
    const after = await asAdmin(ids.ceo, (tx) =>
      tx.salesLeadImport.findUniqueOrThrow({ where: { id: batch.id }, include: { rows: true } }),
    );
    expect(after).toMatchObject({ status: 'COMPLETED', assignedToUserId: null, duplicateCount: 1 });
    expect(after.rows).toMatchObject([
      { outcome: 'DUPLICATE', contactId: null, matchedBy: 'EMAIL' },
    ]);
  });
});
