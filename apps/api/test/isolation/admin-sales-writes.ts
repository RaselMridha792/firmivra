// R60: the Super Admin Sales writes for admin-scope.test.ts, each against a record of its own
// (records on the shipped pipeline, notes of the fixture Super Admin, follow-ups, a pipeline, tags
// and targets), made in the Super Admin's admin scope (B5's notes are written only by their
// author) so every write meets something it can change.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { uuidv7 } from '../../src/clients/client-ids.js';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

const refs = {
  contacted: '',
  pipelineUpdatedAt: '',
  stages: [] as { id: string; name: string; type: string; active: boolean }[],
};
const tag = () => randomUUID().slice(0, 8);
const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
/** A day far ahead, different on each run: a target's period is unique per subject and metric. */
const farDay = () =>
  new Date(Date.UTC(2060, 0, 1) + Math.floor(Math.random() * 20_000) * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The records the Sales writes act on. */
export async function prepareSales(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
      const shipped = await tx.salesPipeline.findFirstOrThrow({
        where: { systemKey: 'firmivra_default' },
        include: { stages: true },
      });
      const stage = (key: string) => shipped.stages.find((s) => s.systemKey === key)!.id;
      refs.contacted = stage('contacted');
      const sale = async (key: string) => {
        const contact = await tx.salesContact.create({
          data: { name: 'Fake Scope Contact', email: `scope-${tag()}@example.test` },
        });
        const row = await tx.salesOpportunity.create({
          data: {
            pipelineId: shipped.id,
            stageId: stage('new_lead'),
            contactId: contact.id,
            title: `Fake scope sale ${key}`,
          },
        });
        records[key] = row.id;
        return row.id;
      };
      for (const key of [
        'salesPatch',
        'salesStage',
        'salesAssign',
        'salesTransaction',
        'salesActivity',
        'salesNote',
        'salesFollowUp',
        'salesBulk',
      ])
        await sale(key);
      const host = await sale('salesHost');
      for (const key of ['salesNotePatch', 'salesNoteDelete'])
        records[key] = (
          await tx.salesNote.create({
            data: { opportunityId: host, authorUserId: fx.users.admin.id, body: 'Fake scope note' },
          })
        ).id;
      for (const key of ['salesFollowUpPatch', 'salesFollowUpComplete', 'salesFollowUpCancel'])
        records[key] = (
          await tx.salesFollowUp.create({
            data: {
              opportunityId: host,
              kind: 'FOLLOW_UP',
              title: 'Fake scope follow-up',
              dueAt: new Date(later()),
            },
          })
        ).id;
      const pipeline = await tx.salesPipeline.create({
        data: { id: uuidv7(), name: `Fake scope pipeline ${tag()}` },
      });
      const stages = [];
      for (const [position, [name, type]] of [
        ['New', 'ACTIVE'],
        ['Lost', 'LOST'],
      ].entries())
        stages.push(
          await tx.salesPipelineStage.create({
            data: {
              pipelineId: pipeline.id,
              name: name!,
              stageType: type as 'ACTIVE' | 'LOST',
              position,
            },
          }),
        );
      records.salesPipeline = pipeline.id;
      refs.stages = stages.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.stageType,
        active: true,
      }));
      const stored = await tx.salesPipeline.findUniqueOrThrow({
        where: { id: pipeline.id },
        include: { stages: true },
      });
      refs.pipelineUpdatedAt = new Date(
        Math.max(stored.updatedAt.getTime(), ...stored.stages.map((s) => s.updatedAt.getTime())),
      ).toISOString();
      for (const key of ['salesTagPatch', 'salesTagDelete'])
        records[key] = (await tx.salesTag.create({ data: { name: `Fake scope tag ${tag()}` } })).id;
      for (const key of ['salesTargetPatch', 'salesTargetArchive']) {
        const day = new Date(`${farDay()}T00:00:00.000Z`);
        records[key] = (
          await tx.salesTarget.create({
            data: {
              name: 'Fake scope target',
              scope: 'COMPANY',
              metric: 'NEW_LEADS',
              targetValue: 5,
              periodType: 'CUSTOM',
              periodStart: day,
              periodEnd: day,
            },
          })
        ).id;
      }
    });
  } finally {
    await owner.$disconnect();
  }
}

const S = '/api/v1/admin/sales';

/** Each Sales write with a body that passes validation, in the order the sweep runs them. */
export function salesWrites(fx: Fixtures): Record<string, SupportWrite> {
  return {
    [`POST ${S}/opportunities/duplicate-check`]: { body: { email: 'scope@example.test' } },
    [`POST ${S}/opportunities/bulk`]: {
      body: () =>
        Promise.resolve({
          ids: [records.salesBulk],
          confirmedCount: 1,
          action: { type: 'ADD_TAG', tagId: records.salesTagPatch },
        }),
    },
    [`POST ${S}/opportunities`]: {
      body: () => {
        const t = tag();
        return Promise.resolve({
          requestId: randomUUID(),
          firmName: `Fake scope lead ${t}`,
          contactName: 'Fake Scope Contact',
          email: `scope-${t}@example.test`,
          source: 'WEBSITE',
          allowDuplicate: true,
        });
      },
    },
    [`PATCH ${S}/opportunities/:id`]: { record: 'salesPatch', body: { valueCents: 1000 } },
    [`POST ${S}/opportunities/:id/stage`]: {
      record: 'salesStage',
      body: () => Promise.resolve({ stageId: refs.contacted }),
    },
    [`POST ${S}/opportunities/:id/assign`]: {
      record: 'salesAssign',
      body: { ownerId: fx.users.admin.id },
    },
    [`POST ${S}/opportunities/:id/transaction`]: {
      record: 'salesTransaction',
      body: { subscriptionId: null },
    },
    [`POST ${S}/opportunities/:id/activities`]: {
      record: 'salesActivity',
      body: { kind: 'CALL', outcome: 'NO_ANSWER' },
    },
    [`POST ${S}/opportunities/:id/notes`]: {
      record: 'salesNote',
      body: { body: 'Fake scope note' },
    },
    [`POST ${S}/opportunities/:id/follow-ups`]: {
      record: 'salesFollowUp',
      body: () =>
        Promise.resolve({ kind: 'FOLLOW_UP', title: 'Fake scope follow-up', dueAt: later() }),
    },
    [`PATCH ${S}/notes/:id`]: { record: 'salesNotePatch', body: { body: 'Fake scope note 2' } },
    [`DELETE ${S}/notes/:id`]: { record: 'salesNoteDelete', body: {} },
    [`PATCH ${S}/follow-ups/:id`]: {
      record: 'salesFollowUpPatch',
      body: () => Promise.resolve({ dueAt: later() }),
    },
    [`POST ${S}/follow-ups/:id/complete`]: { record: 'salesFollowUpComplete', body: {} },
    [`POST ${S}/follow-ups/:id/cancel`]: { record: 'salesFollowUpCancel', body: {} },
    [`POST ${S}/pipelines`]: {
      body: () => Promise.resolve({ name: `Fake scope pipeline ${tag()}`, template: 'BASIC' }),
    },
    [`PUT ${S}/pipelines/:id`]: {
      record: 'salesPipeline',
      body: () =>
        Promise.resolve({
          expectedUpdatedAt: refs.pipelineUpdatedAt,
          name: `Fake scope pipeline ${tag()}`,
          stages: refs.stages,
        }),
    },
    [`POST ${S}/tags`]: { body: () => Promise.resolve({ name: `Fake scope tag ${tag()}` }) },
    [`PATCH ${S}/tags/:id`]: {
      record: 'salesTagPatch',
      body: () => Promise.resolve({ name: `Fake scope tag ${tag()}` }),
    },
    [`DELETE ${S}/tags/:id`]: { record: 'salesTagDelete', body: {} },
    [`PUT ${S}/attention-settings`]: {
      body: {
        noContactHours: 24,
        followUpDueHours: 24,
        noResponseAttempts: 3,
        noActivityDays: 14,
        ownerRequired: true,
        lostOtherNoteRequired: true,
      },
    },
    [`POST ${S}/targets`]: {
      body: () => {
        const day = farDay();
        return Promise.resolve({
          name: 'Fake scope target',
          scope: 'COMPANY',
          metric: 'WON_DEALS',
          targetValue: 5,
          periodType: 'CUSTOM',
          periodStart: day,
          periodEnd: day,
        });
      },
    },
    [`PATCH ${S}/targets/:id`]: { record: 'salesTargetPatch', body: { targetValue: 6 } },
    [`POST ${S}/targets/:id/archive`]: { record: 'salesTargetArchive', body: {} },
  };
}
