// Automations (R55): rules and their versions, templates, runs, the log export and the settings.
// A write case runs in a fresh world, so one record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/automations';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a change can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();
const PLACEHOLDER = randomUUID();

const settings = (notify: string[]) => ({
  logAll: true,
  notifyOnFailureUserIds: notify,
  addToCalendar: false,
});
/** A definition that is valid for the catalog; its failure-alert people are firm members. */
const definition = (notify: string[] = []) => ({
  trigger: { module: 'CLIENTS', event: 'client.created' },
  actions: [{ id: 'note', type: 'ADD_CLIENT_NOTE', config: { body: 'Fake note' } }],
  settings: settings(notify),
});
const stored = {
  trigger: {
    module: 'CLIENTS',
    event: 'client.created',
    timing: 'IMMEDIATE',
    offsetValue: null,
    offsetUnit: null,
  },
  matchMode: 'ALL',
  conditions: [],
  actions: [
    {
      id: 'note',
      type: 'ADD_CLIENT_NOTE',
      config: { body: 'Fake note' },
      delayMinutes: 0,
      dependsOn: null,
    },
  ],
  settings: {
    preventDuplicatesDays: 7,
    logAll: true,
    notifyOnFailureUserIds: [],
    addToCalendar: false,
    quietHours: null,
    safetyThreshold: null,
  },
};
const NOTIFY = 'definition.settings.notifyOnFailureUserIds';

export const records: CaseModule['records'] = {
  automationRule: {
    async create({ tx, businessId, owner }) {
      const rule = await tx.automationRule.create({
        data: {
          businessId,
          name: `Fake rule ${tag()}`,
          category: 'CLIENTS',
          ownerUserId: owner.id,
          createdByUserId: owner.id,
        },
      });
      const v = await tx.automationRuleVersion.create({
        data: {
          businessId,
          ruleId: rule.id,
          version: 1,
          triggerModule: 'CLIENTS',
          triggerEvent: 'client.created',
          conditions: [],
          actions: stored.actions,
          settings: stored.settings,
          createdByUserId: owner.id,
        },
      });
      await tx.automationRule.update({
        where: { id: rule.id },
        data: { currentVersionId: v.id, updatedAt: STAMP },
      });
      return rule.id;
    },
  },
  automationTemplate: {
    async create({ tx, businessId, owner }) {
      const row = await tx.automationTemplate.create({
        data: {
          businessId,
          name: `Fake template ${tag()}`,
          category: 'CLIENTS',
          definition: stored,
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
  /** A finished run: nothing failed, so there is nothing to run again. */
  automationRun: {
    async create({ tx, businessId, get }) {
      const ruleId = await get('automationRule');
      const version = await tx.automationRuleVersion.findFirstOrThrow({ where: { ruleId } });
      const now = new Date();
      const run = await tx.automationRun.create({
        data: {
          businessId,
          ruleId,
          ruleVersionId: version.id,
          status: 'SUCCESS',
          sourceModule: 'CLIENTS',
          sourceEventKey: `client.created:${randomUUID()}:created`,
          correlationId: randomUUID(),
          startedAt: now,
          finishedAt: now,
          durationMs: 5,
        },
      });
      await tx.automationActionExecution.create({
        data: {
          businessId,
          runId: run.id,
          actionKey: 'note',
          position: 0,
          actionType: 'ADD_CLIENT_NOTE',
          status: 'SUCCESS',
          idempotencyKey: randomUUID(),
          finishedAt: now,
        },
      });
      return run.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/rules`]: {
    params: {},
    bodyIds: { ownerUserId: 'adminUser', [NOTIFY]: 'adminUser' },
    body: () => ({
      name: `Fake new rule ${tag()}`,
      category: 'CLIENTS',
      ownerUserId: PLACEHOLDER,
      definition: definition([PLACEHOLDER]),
    }),
  },
  [`POST ${BASE}/rules/validate`]: {
    params: {},
    bodyIds: { [NOTIFY]: 'adminUser' },
    body: { definition: definition([PLACEHOLDER]) },
  },
  [`GET ${BASE}/rules/:id`]: { params: { id: 'automationRule' } },
  [`PATCH ${BASE}/rules/:id`]: {
    params: { id: 'automationRule' },
    bodyIds: { ownerUserId: 'adminUser' },
    body: { etag: ETAG, name: 'Fake renamed rule', ownerUserId: PLACEHOLDER },
  },
  [`PUT ${BASE}/rules/:id/definition`]: {
    params: { id: 'automationRule' },
    bodyIds: { [NOTIFY]: 'adminUser' },
    body: { etag: ETAG, definition: definition([PLACEHOLDER]) },
  },
  [`GET ${BASE}/rules/:id/versions/:version`]: { params: { id: 'automationRule' } },
  [`POST ${BASE}/rules/:id/activate`]: { params: { id: 'automationRule' }, body: {} },
  // A draft is not running, so there is nothing to pause (409).
  [`POST ${BASE}/rules/:id/pause`]: { params: { id: 'automationRule' }, body: {}, expect: 409 },
  [`POST ${BASE}/rules/:id/duplicate`]: { params: { id: 'automationRule' } },
  [`POST ${BASE}/rules/:id/archive`]: { params: { id: 'automationRule' } },
  [`POST ${BASE}/rules/:id/restore`]: { params: { id: 'automationRule' } },
  [`POST ${BASE}/rules/:id/test`]: { params: { id: 'automationRule' }, body: {} },
  [`POST ${BASE}/rules/:id/save-as-template`]: {
    params: { id: 'automationRule' },
    body: () => ({ name: `Fake saved template ${tag()}` }),
  },

  [`POST ${BASE}/templates`]: {
    params: {},
    bodyIds: { [NOTIFY]: 'adminUser' },
    body: () => ({
      name: `Fake new template ${tag()}`,
      category: 'CLIENTS',
      definition: definition([PLACEHOLDER]),
    }),
  },
  [`POST ${BASE}/templates/import`]: {
    params: {},
    bodyIds: { 'template.definition.settings.notifyOnFailureUserIds': 'adminUser' },
    body: () => ({
      format: 'firmivra.automation-template',
      schemaVersion: 1,
      template: {
        name: `Fake imported template ${tag()}`,
        category: 'CLIENTS',
        definition: definition([PLACEHOLDER]),
      },
    }),
  },
  [`GET ${BASE}/templates/:id`]: { params: { id: 'automationTemplate' } },
  [`PATCH ${BASE}/templates/:id`]: {
    params: { id: 'automationTemplate' },
    bodyIds: { [NOTIFY]: 'adminUser' },
    body: { name: 'Fake renamed template', definition: definition([PLACEHOLDER]) },
  },
  [`POST ${BASE}/templates/:id/archive`]: { params: { id: 'automationTemplate' } },
  [`POST ${BASE}/templates/:id/restore`]: { params: { id: 'automationTemplate' } },
  [`POST ${BASE}/templates/:id/use`]: { params: { id: 'automationTemplate' }, body: {} },
  [`GET ${BASE}/templates/:id/export`]: { params: { id: 'automationTemplate' } },

  [`GET ${BASE}/runs/:id`]: { params: { id: 'automationRun' } },
  // Found, but nothing in it failed (409).
  [`POST ${BASE}/runs/:id/rerun`]: {
    params: { id: 'automationRun' },
    body: { reason: 'Fake reason' },
    expect: 409,
  },
  // No file store in tests: the file cannot be written, so the export is refused after it is found.
  [`POST ${BASE}/runs/export`]: {
    params: {},
    bodyIds: { 'filter.ruleId': 'automationRule', 'filter.clientId': 'client' },
    body: { filter: { ruleId: PLACEHOLDER, clientId: PLACEHOLDER } },
    expect: 503,
  },

  [`PUT ${BASE}/settings`]: {
    params: {},
    bodyIds: { failureAlertUserIds: 'adminUser' },
    body: { failureAlertUserIds: [PLACEHOLDER], minutesSavedPerAction: 7 },
  },
};
