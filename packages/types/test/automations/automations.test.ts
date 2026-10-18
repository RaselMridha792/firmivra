import { describe, expect, it } from 'vitest';
import {
  AutomationDefinition,
  AutomationRulesQuery,
  AutomationRunsQuery,
  AutomationTrigger,
  CreateAutomationRuleRequest,
  ExportAutomationLogsRequest,
  ImportAutomationTemplateRequest,
  PauseAutomationRuleRequest,
  RerunAutomationRequest,
  SaveAutomationDefinitionRequest,
  SaveAutomationSettingsRequest,
  UpdateAutomationRuleRequest,
  createAutomationsClient,
  createRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const definition = {
  trigger: {
    module: 'COMPLIANCE_DEADLINES',
    event: 'deadline.approaching',
    timing: 'BEFORE',
    offsetValue: 7,
    offsetUnit: 'DAY',
  },
  conditions: [{ field: 'client.entityType', operator: 'IS', value: 'INDIVIDUAL' }],
  actions: [
    { id: 'task', type: 'CREATE_TASK', config: { assignee: 'client.advisor', priority: 'HIGH' } },
    {
      id: 'email',
      type: 'SEND_EMAIL',
      config: { templateId: id },
      delayMinutes: 60,
      dependsOn: 'task',
    },
  ],
};

describe('triggers', () => {
  it('before and after need an offset; immediate and scheduled have none', () => {
    const base = { module: 'INVOICES_PAYMENTS', event: 'invoice.overdue' };
    expect(AutomationTrigger.parse(base)).toMatchObject({ timing: 'IMMEDIATE' });
    expect(
      AutomationTrigger.safeParse({ ...base, timing: 'AFTER', offsetValue: 3, offsetUnit: 'DAY' })
        .success,
    ).toBe(true);
    expect(AutomationTrigger.safeParse({ ...base, timing: 'AFTER' }).success).toBe(false);
    expect(
      AutomationTrigger.safeParse({
        ...base,
        timing: 'IMMEDIATE',
        offsetValue: 3,
        offsetUnit: 'DAY',
      }).success,
    ).toBe(false);
    expect(
      AutomationTrigger.safeParse({ ...base, timing: 'BEFORE', offsetValue: -1, offsetUnit: 'DAY' })
        .success,
    ).toBe(false);
    expect(
      AutomationTrigger.safeParse({ module: 'INVOICES_PAYMENTS', event: 'Overdue' }).success,
    ).toBe(false);
    expect(AutomationTrigger.safeParse({ ...base, module: 'WEATHER' }).success).toBe(false);
  });
});

describe('definitions', () => {
  it('hold a trigger, conditions, ordered actions and settings with defaults', () => {
    const parsed = AutomationDefinition.parse(definition);
    expect(parsed).toMatchObject({
      matchMode: 'ALL',
      settings: { logAll: true, addToCalendar: false },
    });
    expect(parsed.actions[1]).toMatchObject({ delayMinutes: 60, dependsOn: 'task' });
    expect(parsed.actions[0]).toMatchObject({ delayMinutes: 0 });
  });

  it('needs an action, each with its own id, and depends only on an earlier one', () => {
    expect(AutomationDefinition.safeParse({ ...definition, actions: [] }).success).toBe(false);
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        actions: [
          { id: 'a', type: 'CREATE_TASK' },
          { id: 'a', type: 'SEND_EMAIL' },
        ],
      }).success,
    ).toBe(false);
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        actions: [
          { id: 'a', type: 'CREATE_TASK', dependsOn: 'b' },
          { id: 'b', type: 'SEND_EMAIL' },
        ],
      }).success,
    ).toBe(false);
    expect(
      AutomationDefinition.safeParse({ ...definition, actions: [{ id: 'a', type: 'create task' }] })
        .success,
    ).toBe(false);
  });

  it('conditions have a field and an operator; settings are bounded', () => {
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        matchMode: 'ANY',
        conditions: [
          { field: 'invoice.balance', operator: 'GREATER_THAN', value: 500 },
          { field: 'client.tags', operator: 'EXISTS' },
        ],
      }).success,
    ).toBe(true);
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        conditions: [{ field: 'x', operator: 'LIKE' }],
      }).success,
    ).toBe(false);
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        settings: {
          quietHours: { start: '21:00', end: '08:00' },
          safetyThreshold: 200,
          preventDuplicatesDays: 7,
        },
      }).success,
    ).toBe(true);
    expect(
      AutomationDefinition.safeParse({
        ...definition,
        settings: { quietHours: { start: '25:00', end: '08:00' } },
      }).success,
    ).toBe(false);
    expect(AutomationDefinition.safeParse({ ...definition, businessId: id }).success).toBe(false);
  });
});

describe('rules', () => {
  const base = { name: 'Deadline reminder', category: 'COMPLIANCE_DEADLINES', definition };

  it('create a draft by default, or activate; a rule never takes status or ids from the body', () => {
    expect(CreateAutomationRuleRequest.parse(base)).toMatchObject({
      activate: false,
      priority: 'MEDIUM',
    });
    expect(
      CreateAutomationRuleRequest.safeParse({
        ...base,
        activate: true,
        ownerUserId: other,
        expiresOn: '2027-01-01',
      }).success,
    ).toBe(true);
    expect(CreateAutomationRuleRequest.safeParse({ ...base, status: 'ACTIVE' }).success).toBe(
      false,
    );
    expect(CreateAutomationRuleRequest.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(CreateAutomationRuleRequest.safeParse({ name: 'x', category: 'CLIENTS' }).success).toBe(
      false,
    );
  });

  it('a change of meta or definition names its etag; a definition is its own route and version', () => {
    expect(UpdateAutomationRuleRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(UpdateAutomationRuleRequest.safeParse({ etag: 'v1', priority: 'HIGH' }).success).toBe(
      true,
    );
    expect(UpdateAutomationRuleRequest.safeParse({ etag: 'v1', definition }).success).toBe(false);
    expect(SaveAutomationDefinitionRequest.safeParse({ etag: 'v1', definition }).success).toBe(
      true,
    );
    expect(SaveAutomationDefinitionRequest.safeParse({ definition }).success).toBe(false);
  });

  it('pausing says what happens to waiting actions', () => {
    expect(PauseAutomationRuleRequest.parse({})).toMatchObject({ scheduledActions: 'FINISH' });
    expect(PauseAutomationRuleRequest.safeParse({ scheduledActions: 'CANCEL' }).success).toBe(true);
    expect(PauseAutomationRuleRequest.safeParse({ scheduledActions: 'DELETE' }).success).toBe(
      false,
    );
  });

  it('the rules list filters and sorts', () => {
    expect(AutomationRulesQuery.parse({})).toMatchObject({ sort: 'updated', direction: 'desc' });
    expect(
      AutomationRulesQuery.safeParse({
        status: 'ACTIVE',
        category: 'LEADS',
        needsAttention: 'true',
      }).success,
    ).toBe(true);
    expect(AutomationRulesQuery.safeParse({ status: 'RUNNING' }).success).toBe(false);
  });
});

describe('templates, logs and re-runs', () => {
  it('an imported template names its format and schema version', () => {
    const template = { name: 'Welcome new clients', category: 'CLIENTS', definition };
    expect(
      ImportAutomationTemplateRequest.safeParse({
        format: 'firmivra.automation-template',
        schemaVersion: 1,
        template,
      }).success,
    ).toBe(true);
    expect(
      ImportAutomationTemplateRequest.safeParse({ format: 'other', schemaVersion: 1, template })
        .success,
    ).toBe(false);
    expect(
      ImportAutomationTemplateRequest.safeParse({
        format: 'firmivra.automation-template',
        schemaVersion: 2,
        template,
      }).success,
    ).toBe(false);
  });

  it('the logs have tabs, a range and filters; an export has no page', () => {
    expect(AutomationRunsQuery.parse({})).toMatchObject({ tab: 'all', page: 1, pageSize: 25 });
    expect(
      AutomationRunsQuery.safeParse({
        tab: 'failed',
        from: '2026-10-01',
        to: '2026-10-18',
        ruleId: id,
        module: 'TASKS',
        dryRun: 'false',
      }).success,
    ).toBe(true);
    expect(AutomationRunsQuery.safeParse({ tab: 'broken' }).success).toBe(false);
    expect(ExportAutomationLogsRequest.safeParse({ filter: { tab: 'failed' } }).success).toBe(true);
    expect(ExportAutomationLogsRequest.safeParse({ filter: { page: 2 } }).success).toBe(false);
    expect(ExportAutomationLogsRequest.safeParse({ filter: {}, format: 'XLSX' }).success).toBe(
      false,
    );
  });

  it('a re-run needs a reason and may name the actions to retry', () => {
    expect(RerunAutomationRequest.safeParse({}).success).toBe(false);
    expect(RerunAutomationRequest.parse({ reason: 'Provider is back' })).toMatchObject({
      confirmRuleChanged: false,
      force: false,
    });
    expect(RerunAutomationRequest.safeParse({ reason: 'x', actionKeys: ['email'] }).success).toBe(
      true,
    );
    expect(RerunAutomationRequest.safeParse({ reason: 'x', actionKeys: [] }).success).toBe(false);
  });

  it('settings change at least one field within limits', () => {
    expect(SaveAutomationSettingsRequest.safeParse({}).success).toBe(false);
    expect(
      SaveAutomationSettingsRequest.safeParse({
        maxDepth: 3,
        quietHours: { start: '20:00', end: '07:30' },
      }).success,
    ).toBe(true);
    expect(SaveAutomationSettingsRequest.safeParse({ maxDepth: 0 }).success).toBe(false);
    expect(SaveAutomationSettingsRequest.safeParse({ logRetentionDays: 7 }).success).toBe(false);
  });
});

describe('createAutomationsClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [], total: 0, page: 1, pageSize: 25 });
    const client = createAutomationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.runs({ tab: 'failed', module: 'TASKS' });
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/automations/runs?')).toBe(true);
    for (const part of ['tab=failed', 'module=TASKS']) expect(url).toContain(part);
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createAutomationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.rule('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.version(id, 0)).rejects.toMatchObject({ status: 400 });
    await expect(client.rerun(id, {} as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.createRule({ name: 'x' } as never)).rejects.toMatchObject({ status: 400 });
    await expect(client.runDetail('nope')).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
});
