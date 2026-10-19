// Tax Planning (R55): plans with their strategies, documents and versions, the strategy library,
// opportunities, the screening run, the calculator and its scenarios, and the resources. A write
// case runs in a fresh world, so one record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/tax-planning';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a change can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();
const PLACEHOLDER = randomUUID();

const calculation = (clientId: string) => ({
  clientId,
  taxYear: 2026,
  filingStatus: 'SINGLE',
  baseline: { wagesCents: 10_000_000 },
  strategy: { retirementContributionCents: 1_000_000 },
});

export const records: CaseModule['records'] = {
  taxStrategy: {
    async create({ tx, businessId }) {
      const row = await tx.taxPlanningStrategy.create({
        data: { businessId, name: `Fake strategy ${tag()}`, category: 'DEDUCTIONS' },
      });
      return row.id;
    },
  },
  taxPlan: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.taxPlan.create({
        data: {
          businessId,
          clientId: await get('client'),
          name: `Fake plan ${tag()}`,
          planYear: 2026,
          filingStatus: 'SINGLE',
          createdByUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      // Finalized once, so the versions can be read and the plan can be sent.
      await tx.taxPlanVersion.create({
        data: {
          businessId,
          planId: row.id,
          version: 1,
          event: 'FINALIZED',
          taxYear: 2026,
          snapshot: {
            planName: 'Fake plan',
            strategies: [],
            inputs: [],
            projectedSavingsCents: null,
            disclaimer: 'Fake',
          },
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
  planStrategy: {
    async create({ tx, businessId, get }) {
      const row = await tx.taxPlanStrategy.create({
        data: {
          businessId,
          planId: await get('taxPlan'),
          customName: `Fake custom strategy ${tag()}`,
          customCategory: 'BUSINESS',
          displayName: 'Fake custom strategy',
        },
      });
      return row.id;
    },
  },
  /** The id of a document linked to the plan (the path names the document). */
  taxPlanDocument: {
    async create({ tx, businessId, get }) {
      const documentId = await get('document');
      await tx.taxPlanDocument.create({
        data: { businessId, planId: await get('taxPlan'), documentId },
      });
      return documentId;
    },
  },
  taxOpportunity: {
    async create({ tx, businessId, get }) {
      const row = await tx.taxOpportunity.create({
        data: {
          businessId,
          clientId: await get('client'),
          name: `Fake opportunity ${tag()}`,
          category: 'RETIREMENT',
          taxYear: 2026,
          source: 'MANUAL',
          documentsNeeded: [{ label: 'Fake statement', received: false }],
          updatedAt: STAMP,
        },
      });
      return row.id;
    },
  },
  taxScenario: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.taxSavingsScenario.create({
        data: {
          businessId,
          clientId: await get('client'),
          name: `Fake scenario ${tag()}`,
          taxYear: 2026,
          filingStatus: 'SINGLE',
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/plans`]: {
    params: {},
    bodyIds: { clientId: 'client', assignedUserId: 'adminUser' },
    body: () => ({
      clientId: PLACEHOLDER,
      assignedUserId: PLACEHOLDER,
      planYear: 2026,
      name: `Fake new plan ${tag()}`,
    }),
  },
  [`GET ${BASE}/plans/:id`]: { params: { id: 'taxPlan' } },
  [`PATCH ${BASE}/plans/:id`]: {
    params: { id: 'taxPlan' },
    bodyIds: { assignedUserId: 'adminUser' },
    body: { etag: ETAG, name: 'Fake renamed plan', assignedUserId: PLACEHOLDER },
  },
  [`PUT ${BASE}/plans/:id/inputs`]: {
    params: { id: 'taxPlan' },
    body: {
      etag: ETAG,
      inputs: [
        { key: 'agi', kind: 'PROJECTED', taxYear: 2026, amountCents: 1_000, source: 'Fake' },
      ],
    },
  },
  [`POST ${BASE}/plans/:id/strategies`]: {
    params: { id: 'taxPlan' },
    bodyIds: { strategyId: 'taxStrategy' },
    body: { kind: 'LIBRARY', strategyId: PLACEHOLDER },
  },
  [`PUT ${BASE}/plans/:id/strategies/order`]: {
    params: { id: 'taxPlan' },
    bodyIds: { ids: 'planStrategy' },
    body: { etag: ETAG, ids: [PLACEHOLDER] },
  },
  [`PATCH ${BASE}/plans/:id/strategies/:strategyId`]: {
    params: { id: 'taxPlan', strategyId: 'planStrategy' },
    body: { etag: ETAG, selected: false },
  },
  [`POST ${BASE}/plans/:id/recalculate`]: { params: { id: 'taxPlan' } },
  [`POST ${BASE}/plans/:id/documents`]: {
    params: { id: 'taxPlan' },
    bodyIds: { documentId: 'document', planStrategyId: 'planStrategy' },
    body: { documentId: PLACEHOLDER, planStrategyId: PLACEHOLDER },
  },
  [`DELETE ${BASE}/plans/:id/documents/:documentId`]: {
    params: { id: 'taxPlan', documentId: 'taxPlanDocument' },
  },
  [`POST ${BASE}/plans/:id/status`]: {
    params: { id: 'taxPlan' },
    body: { etag: ETAG, status: 'IN_PROGRESS' },
  },
  // Found, but a plan with no strategy selected cannot be finalized (409).
  [`POST ${BASE}/plans/:id/finalize`]: {
    params: { id: 'taxPlan' },
    body: { etag: ETAG },
    expect: 409,
  },
  [`POST ${BASE}/plans/:id/send`]: {
    params: { id: 'taxPlan' },
    body: { channel: 'PORTAL_MESSAGE' },
  },
  [`POST ${BASE}/plans/:id/archive`]: { params: { id: 'taxPlan' } },
  [`POST ${BASE}/plans/:id/restore`]: { params: { id: 'taxPlan' } },
  [`GET ${BASE}/plans/:id/versions`]: { params: { id: 'taxPlan' } },
  [`GET ${BASE}/plans/:id/versions/:version`]: { params: { id: 'taxPlan' } },

  [`GET ${BASE}/strategies/:id`]: { params: { id: 'taxStrategy' } },
  [`PATCH ${BASE}/strategies/:id`]: {
    params: { id: 'taxStrategy' },
    body: { description: 'Fake description' },
  },
  [`POST ${BASE}/strategies/:id/archive`]: { params: { id: 'taxStrategy' } },
  [`POST ${BASE}/strategies/:id/restore`]: { params: { id: 'taxStrategy' } },

  [`POST ${BASE}/opportunities`]: {
    params: {},
    bodyIds: { clientId: 'client', strategyId: 'taxStrategy' },
    body: () => ({
      clientId: PLACEHOLDER,
      strategyId: PLACEHOLDER,
      name: `Fake new opportunity ${tag()}`,
      category: 'DEDUCTIONS',
      taxYear: 2026,
    }),
  },
  [`GET ${BASE}/opportunities/:id`]: { params: { id: 'taxOpportunity' } },
  // The action's own ids (userId, planId, appointmentId) belong to one action each: see
  // NOT_RECORDS in body-ids.ts and the cross-firm checks in tax-planning.e2e.test.ts.
  [`POST ${BASE}/opportunities/:id/actions`]: {
    params: { id: 'taxOpportunity' },
    body: { action: 'ADD_NOTE', note: 'Fake note' },
  },
  [`GET ${BASE}/opportunities/:id/events`]: { params: { id: 'taxOpportunity' } },
  [`POST ${BASE}/screening/run`]: {
    params: {},
    bodyIds: { clientId: 'client' },
    body: { clientId: PLACEHOLDER, taxYear: 2026 },
  },

  [`POST ${BASE}/calculator/calculate`]: {
    params: {},
    bodyIds: { clientId: 'client' },
    body: () => calculation(PLACEHOLDER),
  },
  [`POST ${BASE}/calculator/scenarios`]: {
    params: {},
    bodyIds: { planId: 'taxPlan', 'calculation.clientId': 'client' },
    body: () => ({ planId: PLACEHOLDER, calculation: calculation(PLACEHOLDER) }),
  },
  [`GET ${BASE}/calculator/scenarios/:id`]: { params: { id: 'taxScenario' } },

  [`POST ${BASE}/resources/:key/send`]: {
    params: {},
    bodyIds: { clientId: 'client' },
    body: { clientId: PLACEHOLDER, channel: 'EMAIL' },
  },
};
