// Business Advisory (R55): advisory clients and their services, business plans and versions,
// financial snapshots, goals and milestones, recommendations, action items, resources and
// settings. A write case runs in a fresh world, so one record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/advisory';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a change can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();
const PLACEHOLDER = randomUUID();

const PLAN_PROFILE = { businessName: 'Fake Business' };
const PLAN_STRATEGY = { summary: 'Fake summary' };

export const records: CaseModule['records'] = {
  /** An advisory service of the firm's catalog (Business Development), on the advisory client. */
  advisoryService: {
    async create({ tx, businessId }) {
      const row = await tx.service.create({
        data: { businessId, kind: 'BUSINESS_DEVELOPMENT', name: `Fake advisory ${tag()}` },
      });
      return row.id;
    },
  },
  /** Another one, on no client yet. */
  advisoryServiceExtra: {
    async create({ tx, businessId }) {
      const row = await tx.service.create({
        data: { businessId, kind: 'BUSINESS_DEVELOPMENT', name: `Fake extra advisory ${tag()}` },
      });
      return row.id;
    },
  },
  advisoryClient: {
    async create({ tx, businessId, get }) {
      const row = await tx.advisoryClient.create({
        data: { businessId, clientId: await get('client'), updatedAt: STAMP },
      });
      await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: row.id,
          serviceId: await get('advisoryService'),
          role: 'PRIMARY',
          status: 'ACCEPTED',
        },
      });
      return row.id;
    },
  },
  /** An additional service on the advisory client. */
  advisoryWorkstream: {
    async create({ tx, businessId, get }) {
      const service = await tx.service.create({
        data: { businessId, kind: 'BUSINESS_DEVELOPMENT', name: `Fake workstream ${tag()}` },
      });
      const row = await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: await get('advisoryClient'),
          serviceId: service.id,
          role: 'ADDITIONAL',
        },
      });
      return row.id;
    },
  },
  /** A finalized plan with its version 1, unchanged since. */
  advisoryPlan: {
    async create({ tx, businessId, owner, get }) {
      const name = `Fake plan ${tag()}`;
      const row = await tx.advisoryPlan.create({
        data: {
          businessId,
          advisoryClientId: await get('advisoryClient'),
          name,
          targetYear: 2026,
          status: 'FINALIZED',
          step: 5,
          currentVersion: 1,
          profile: PLAN_PROFILE,
          strategy: PLAN_STRATEGY,
          finalizedAt: STAMP,
          createdByUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      await tx.advisoryPlanVersion.create({
        data: {
          businessId,
          planId: row.id,
          versionNo: 1,
          createdByUserId: owner.id,
          content: {
            planName: name,
            targetYear: 2026,
            profile: PLAN_PROFILE,
            assessment: {},
            strategy: PLAN_STRATEGY,
            goals: [],
            recommendations: [],
            workstreams: [],
            financials: [],
            disclaimer: 'Fake',
          },
        },
      });
      return row.id;
    },
  },
  advisoryGoal: {
    async create({ tx, businessId, get }) {
      const row = await tx.advisoryGoal.create({
        data: {
          businessId,
          advisoryClientId: await get('advisoryClient'),
          title: `Fake goal ${tag()}`,
          status: 'IN_PROGRESS',
          progressPercent: 40,
          updatedAt: STAMP,
        },
      });
      return row.id;
    },
  },
  advisoryMilestone: {
    async create({ tx, businessId, get }) {
      const row = await tx.advisoryMilestone.create({
        data: { businessId, goalId: await get('advisoryGoal'), title: `Fake milestone ${tag()}` },
      });
      return row.id;
    },
  },
  advisoryRecommendation: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.advisoryRecommendation.create({
        data: {
          businessId,
          advisoryClientId: await get('advisoryClient'),
          title: `Fake recommendation ${tag()}`,
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
  advisoryActionItem: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.advisoryActionItem.create({
        data: {
          businessId,
          advisoryClientId: await get('advisoryClient'),
          title: `Fake action ${tag()}`,
          assigneeKind: 'CLIENT',
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/clients`]: {
    params: {},
    bodyIds: {
      clientId: 'client',
      primaryServiceId: 'advisoryService',
      additionalServiceIds: 'advisoryServiceExtra',
      advisorUserId: 'adminUser',
    },
    body: {
      clientId: PLACEHOLDER,
      primaryServiceId: PLACEHOLDER,
      additionalServiceIds: [PLACEHOLDER],
      advisorUserId: PLACEHOLDER,
    },
  },
  [`GET ${BASE}/clients/:id`]: { params: { id: 'advisoryClient' } },
  [`PATCH ${BASE}/clients/:id`]: {
    params: { id: 'advisoryClient' },
    bodyIds: { advisorUserId: 'adminUser' },
    body: { etag: ETAG, advisorUserId: PLACEHOLDER, industry: 'Fake industry' },
  },
  [`POST ${BASE}/clients/:id/archive`]: { params: { id: 'advisoryClient' } },
  [`POST ${BASE}/clients/:id/restore`]: { params: { id: 'advisoryClient' } },
  [`POST ${BASE}/clients/:id/workstreams`]: {
    params: { id: 'advisoryClient' },
    bodyIds: { serviceId: 'advisoryServiceExtra' },
    body: { serviceId: PLACEHOLDER },
  },
  [`PATCH ${BASE}/clients/:id/workstreams/:workstreamId`]: {
    params: { id: 'advisoryClient', workstreamId: 'advisoryWorkstream' },
    body: { status: 'IN_PROGRESS' },
  },
  [`GET ${BASE}/clients/:id/activity`]: { params: { id: 'advisoryClient' } },
  [`POST ${BASE}/clients/:id/financials`]: {
    params: { id: 'advisoryClient' },
    bodyIds: { planId: 'advisoryPlan' },
    body: {
      planId: PLACEHOLDER,
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      revenueCents: 1_000_000,
      asOf: '2026-01-01',
    },
  },

  [`POST ${BASE}/plans`]: {
    params: {},
    bodyIds: { advisoryClientId: 'advisoryClient' },
    body: () => ({
      advisoryClientId: PLACEHOLDER,
      name: `Fake new plan ${tag()}`,
      targetYear: 2026,
    }),
  },
  [`GET ${BASE}/plans/:id`]: { params: { id: 'advisoryPlan' } },
  [`PATCH ${BASE}/plans/:id`]: {
    params: { id: 'advisoryPlan' },
    body: { etag: ETAG, name: 'Fake renamed plan' },
  },
  [`POST ${BASE}/plans/:id/status`]: {
    params: { id: 'advisoryPlan' },
    body: { etag: ETAG, status: 'IN_PROGRESS' },
  },
  // Found, but the plan has no goal and no figures yet (409).
  [`POST ${BASE}/plans/:id/finalize`]: {
    params: { id: 'advisoryPlan' },
    body: { etag: ETAG },
    expect: 409,
  },
  [`POST ${BASE}/plans/:id/send`]: {
    params: { id: 'advisoryPlan' },
    body: { channel: 'DOWNLOAD' },
  },
  [`POST ${BASE}/plans/:id/archive`]: { params: { id: 'advisoryPlan' } },
  [`POST ${BASE}/plans/:id/restore`]: { params: { id: 'advisoryPlan' } },
  [`GET ${BASE}/plans/:id/versions`]: { params: { id: 'advisoryPlan' } },
  [`GET ${BASE}/plans/:id/versions/:version`]: { params: { id: 'advisoryPlan' } },

  [`POST ${BASE}/goals`]: {
    params: {},
    bodyIds: {
      advisoryClientId: 'advisoryClient',
      planId: 'advisoryPlan',
      workstreamId: 'advisoryWorkstream',
      ownerUserId: 'adminUser',
      'milestones.ownerUserId': 'adminUser',
    },
    body: () => ({
      advisoryClientId: PLACEHOLDER,
      planId: PLACEHOLDER,
      workstreamId: PLACEHOLDER,
      ownerUserId: PLACEHOLDER,
      title: `Fake new goal ${tag()}`,
      milestones: [{ title: 'Fake step', ownerUserId: PLACEHOLDER }],
    }),
  },
  [`GET ${BASE}/goals/:id`]: { params: { id: 'advisoryGoal' } },
  [`PATCH ${BASE}/goals/:id`]: {
    params: { id: 'advisoryGoal' },
    bodyIds: {
      planId: 'advisoryPlan',
      workstreamId: 'advisoryWorkstream',
      ownerUserId: 'adminUser',
    },
    body: {
      etag: ETAG,
      planId: PLACEHOLDER,
      workstreamId: PLACEHOLDER,
      ownerUserId: PLACEHOLDER,
      title: 'Fake renamed goal',
    },
  },
  [`POST ${BASE}/goals/:id/archive`]: { params: { id: 'advisoryGoal' } },
  [`POST ${BASE}/goals/:id/restore`]: { params: { id: 'advisoryGoal' } },
  [`POST ${BASE}/goals/:id/milestones`]: {
    params: { id: 'advisoryGoal' },
    bodyIds: { ownerUserId: 'adminUser' },
    body: { title: 'Fake new step', ownerUserId: PLACEHOLDER },
  },
  [`PUT ${BASE}/goals/:id/milestones/order`]: {
    params: { id: 'advisoryGoal' },
    bodyIds: { ids: 'advisoryMilestone' },
    body: { ids: [PLACEHOLDER] },
  },
  [`PATCH ${BASE}/milestones/:id`]: {
    params: { id: 'advisoryMilestone' },
    bodyIds: { ownerUserId: 'adminUser' },
    body: { title: 'Fake renamed step', ownerUserId: PLACEHOLDER },
  },

  [`POST ${BASE}/recommendations`]: {
    params: {},
    bodyIds: { advisoryClientId: 'advisoryClient', planId: 'advisoryPlan', goalId: 'advisoryGoal' },
    body: () => ({
      advisoryClientId: PLACEHOLDER,
      planId: PLACEHOLDER,
      goalId: PLACEHOLDER,
      title: `Fake new recommendation ${tag()}`,
    }),
  },
  [`PATCH ${BASE}/recommendations/:id`]: {
    params: { id: 'advisoryRecommendation' },
    bodyIds: { planId: 'advisoryPlan', goalId: 'advisoryGoal' },
    body: { planId: PLACEHOLDER, goalId: PLACEHOLDER, title: 'Fake renamed recommendation' },
  },
  [`POST ${BASE}/action-items`]: {
    params: {},
    bodyIds: {
      advisoryClientId: 'advisoryClient',
      planId: 'advisoryPlan',
      goalId: 'advisoryGoal',
      milestoneId: 'advisoryMilestone',
      assigneeUserId: 'adminUser',
    },
    body: () => ({
      advisoryClientId: PLACEHOLDER,
      planId: PLACEHOLDER,
      goalId: PLACEHOLDER,
      milestoneId: PLACEHOLDER,
      assigneeUserId: PLACEHOLDER,
      title: `Fake new action ${tag()}`,
    }),
  },
  [`PATCH ${BASE}/action-items/:id`]: {
    params: { id: 'advisoryActionItem' },
    bodyIds: {
      planId: 'advisoryPlan',
      goalId: 'advisoryGoal',
      milestoneId: 'advisoryMilestone',
      assigneeUserId: 'adminUser',
    },
    body: {
      planId: PLACEHOLDER,
      goalId: PLACEHOLDER,
      milestoneId: PLACEHOLDER,
      assigneeKind: 'STAFF',
      assigneeUserId: PLACEHOLDER,
      title: 'Fake renamed action',
    },
  },

  [`POST ${BASE}/resources/:key/send`]: {
    params: {},
    bodyIds: { advisoryClientId: 'advisoryClient' },
    body: { advisoryClientId: PLACEHOLDER, channel: 'EMAIL' },
  },
  [`PUT ${BASE}/settings`]: {
    params: {},
    bodyIds: { defaultAdvisorUserId: 'adminUser' },
    body: { defaultAdvisorUserId: PLACEHOLDER },
  },
};
