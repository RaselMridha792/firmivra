import { describe, expect, it } from 'vitest';
import { AutomationDefinition } from '@firmivra/types';
import {
  ACTIONS,
  EVENTS,
  OPERATORS,
  VARIABLE_KEYS,
  eventOf,
} from '../../src/automations/catalog.js';
import { mayAct, permsOf } from '../../src/automations/automations.common.js';
import { quietUntil } from '../../src/automations/engine.service.js';
import {
  appliesTo,
  conditionHolds,
  fill,
  forTemplate,
  loopProblems,
  matches,
  missingSettings,
  produces,
  stored,
  structureProblems,
  triggerSummary,
  viewOf,
} from '../../src/automations/logic.js';
import { timingHolds } from '../../src/automations/matching.js';
import { STARTERS } from '../../src/automations/starters.js';

const def = (over: object = {}) =>
  AutomationDefinition.parse({
    trigger: { module: 'CLIENTS', event: 'client.created' },
    actions: [{ id: 'note', type: 'ADD_CLIENT_NOTE', config: { body: 'Hello {{client.name}}' } }],
    ...over,
  });
const staff = (role: string) =>
  ({ kind: 'staff', businessId: 'b', role }) as unknown as Parameters<typeof permsOf>[0];

describe('the catalog', () => {
  it('offers valid events and actions, and operators by field type', () => {
    expect(new Set(EVENTS.map((e) => e.code)).size).toBe(EVENTS.length);
    for (const e of EVENTS) {
      expect(e.timings.length).toBeGreaterThan(0);
      for (const f of e.conditionFields) expect(f.operators).toEqual(OPERATORS[f.type]);
    }
    expect(new Set(ACTIONS.map((a) => a.type)).size).toBe(ACTIONS.length);
    expect(eventOf('nope')).toBeUndefined();
    expect(VARIABLE_KEYS.has('client.name')).toBe(true);
  });

  it('has starters that are valid for the catalog', () => {
    for (const s of STARTERS) {
      expect(structureProblems(s.definition)).toEqual([]);
      expect(missingSettings(s.definition)).toEqual([]);
    }
  });
});

describe('checking a definition', () => {
  it('accepts a good one and names every problem with its path', () => {
    expect(structureProblems(def())).toEqual([]);
    const paths = (d: object) => structureProblems(def(d)).map((p) => p.path);
    expect(paths({ trigger: { module: 'CLIENTS', event: 'nope.event' } })).toEqual([
      'trigger.event',
    ]);
    expect(paths({ trigger: { module: 'TASKS', event: 'client.created' } })).toEqual([
      'trigger.module',
    ]);
    expect(
      paths({
        trigger: {
          module: 'CLIENTS',
          event: 'client.created',
          timing: 'BEFORE',
          offsetValue: 1,
          offsetUnit: 'DAY',
        },
      }),
    ).toEqual(['trigger.timing']);
    expect(paths({ conditions: [{ field: 'zip', operator: 'IS', value: 'x' }] })).toEqual([
      'conditions.0.field',
    ]);
    expect(
      paths({ conditions: [{ field: 'source', operator: 'GREATER_THAN', value: 1 }] }),
    ).toEqual(['conditions.0.operator']);
    expect(
      paths({ conditions: [{ field: 'clientType', operator: 'INCLUDES', value: 'BUSINESS' }] }),
    ).toEqual(['conditions.0.value']);
    expect(
      paths({
        conditions: [{ field: 'clientType', operator: 'INCLUDES', value: ['BUSINESS', 'X'] }],
      }),
    ).toEqual(['conditions.0.value']);
    expect(
      paths({ conditions: [{ field: 'source', operator: 'NOT_EXISTS', value: 'x' }] }),
    ).toEqual(['conditions.0.value']);
    expect(paths({ actions: [{ id: 'a', type: 'NOPE' }] })).toEqual(['actions.0.type']);
    expect(
      paths({ actions: [{ id: 'a', type: 'ADD_CLIENT_NOTE', config: { body: 'x', extra: 1 } }] }),
    ).toEqual(['actions.0.config.extra']);
    expect(
      paths({
        actions: [{ id: 'a', type: 'ADD_CLIENT_NOTE', config: { body: '{{client.ssn}}' } }],
      }),
    ).toEqual(['actions.0.config.body']);
    expect(
      paths({
        actions: [
          { id: 'a', type: 'ADD_CLIENT_NOTE', config: { body: 'x' } },
          { id: 'b', type: 'ADD_CLIENT_NOTE', config: { body: 'y' }, dependsOn: 'zzz' },
        ],
      }),
    ).toEqual(['actions.1.dependsOn']);
    expect(paths({ settings: { quietHours: { start: '08:00', end: '08:00' } } })).toEqual([
      'settings.quietHours',
    ]);
  });

  it('lists what a draft still lacks', () => {
    expect(
      missingSettings(def({ actions: [{ id: 't', type: 'CREATE_TASK', config: {} }] })).map(
        (m) => m.path,
      ),
    ).toEqual(['actions.0.config.title']);
    expect(
      missingSettings(def({ actions: [{ id: 'm', type: 'SEND_CLIENT_MESSAGE', config: {} }] })).map(
        (m) => m.path,
      ),
    ).toEqual(['actions.0.config.body']);
    expect(
      missingSettings(
        def({ actions: [{ id: 'm', type: 'SEND_CLIENT_MESSAGE', config: { templateId: 'x' } }] }),
      ),
    ).toEqual([]);
  });
});

describe('words, conditions and timing', () => {
  it('puts a rule in words', () => {
    expect(
      triggerSummary({
        event: 'invoice.overdue',
        timing: 'AFTER',
        offsetValue: 1,
        offsetUnit: 'DAY',
      }),
    ).toBe('Invoice overdue: 1 day after');
    expect(
      triggerSummary({
        event: 'client.created',
        timing: 'IMMEDIATE',
        offsetValue: null,
        offsetUnit: null,
      }),
    ).toBe('New client added');
    expect(appliesTo('client.created', [], 'ALL')).toBe('All records');
    expect(
      appliesTo(
        'client.created',
        [
          { field: 'clientType', operator: 'IS', value: 'BUSINESS' },
          { field: 'source', operator: 'EXISTS' },
        ],
        'ANY',
      ),
    ).toBe('Client type is BUSINESS or Source is set');
  });

  it('tests a record against conditions', () => {
    const f = {
      clientType: 'BUSINESS',
      totalCents: 5_000,
      source: 'Referral',
      due: '2026-03-01',
      tags: ['a', 'b'] as string[],
    };
    const c = (operator: never, field: string, value?: unknown) =>
      conditionHolds(f, { field, operator, value });
    expect(c('IS' as never, 'clientType', 'business')).toBe(true);
    expect(c('IS_NOT' as never, 'clientType', 'INDIVIDUAL')).toBe(true);
    expect(c('INCLUDES' as never, 'clientType', ['INDIVIDUAL', 'BUSINESS'])).toBe(true);
    expect(c('EXCLUDES' as never, 'clientType', ['BUSINESS'])).toBe(false);
    expect(c('INCLUDES' as never, 'tags', ['b'])).toBe(true);
    expect(c('GREATER_THAN' as never, 'totalCents', 4_000)).toBe(true);
    expect(c('LESS_THAN' as never, 'totalCents', 4_000)).toBe(false);
    expect(c('GREATER_THAN' as never, 'source', 1)).toBe(false);
    expect(c('BEFORE' as never, 'due', '2026-04-01')).toBe(true);
    expect(c('AFTER' as never, 'due', '2026-04-01')).toBe(false);
    expect(c('CONTAINS' as never, 'source', 'ferr')).toBe(true);
    expect(c('EXISTS' as never, 'missing')).toBe(false);
    expect(c('NOT_EXISTS' as never, 'missing')).toBe(true);
    const list = [
      { field: 'clientType', operator: 'IS' as const, value: 'BUSINESS' },
      { field: 'source', operator: 'IS' as const, value: 'Web' },
    ];
    expect(matches(f, 'ALL', list)).toBe(false);
    expect(matches(f, 'ANY', list)).toBe(true);
    expect(matches(f, 'ALL', [])).toBe(true);
  });

  it('measures timing from the record’s date', () => {
    const at = new Date('2026-06-10T00:00:00Z');
    const before = { timing: 'BEFORE' as const, offsetValue: 7, offsetUnit: 'DAY' as const };
    expect(timingHolds(before, at, new Date('2026-06-02T00:00:00Z'))).toBe(false);
    expect(timingHolds(before, at, new Date('2026-06-03T00:00:00Z'))).toBe(true);
    expect(timingHolds(before, at, new Date('2026-06-10T12:00:00Z'))).toBe(true);
    expect(timingHolds(before, at, new Date('2026-06-12T00:00:00Z'))).toBe(false);
    const after = { timing: 'AFTER' as const, offsetValue: 2, offsetUnit: 'HOUR' as const };
    expect(timingHolds(after, at, new Date('2026-06-10T01:00:00Z'))).toBe(false);
    expect(timingHolds(after, at, new Date('2026-06-10T02:00:00Z'))).toBe(true);
    expect(
      timingHolds({ timing: 'IMMEDIATE', offsetValue: null, offsetUnit: null }, null, at),
    ).toBe(true);
    expect(timingHolds(before, null, at)).toBe(false);
    expect(timingHolds({ timing: 'SCHEDULED', offsetValue: null, offsetUnit: null }, at, at)).toBe(
      false,
    );
  });

  it('keeps quiet hours that wrap midnight, in the firm’s zone', () => {
    const ny = 'America/New_York';
    const night = { start: '21:00', end: '07:00' };
    expect(quietUntil(new Date('2026-07-01T14:00:00Z'), ny, night)).toBeNull();
    expect(quietUntil(new Date('2026-07-01T03:00:00Z'), ny, night)?.toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
    expect(quietUntil(new Date('2026-07-02T02:00:00Z'), ny, night)?.toISOString()).toBe(
      '2026-07-02T11:00:00.000Z',
    );
    expect(
      quietUntil(new Date('2026-07-01T16:00:00Z'), ny, {
        start: '09:00',
        end: '17:00',
      })?.toISOString(),
    ).toBe('2026-07-01T21:00:00.000Z');
    expect(quietUntil(new Date('2026-07-01T16:00:00Z'), ny, null)).toBeNull();
  });

  it('fills approved merge fields and leaves an unknown one empty', () => {
    expect(
      fill('Hi {{client.firstName}} {{ firm.name }} {{x.y}}!', {
        'client.firstName': 'Jamie',
        'firm.name': 'LVP',
      }),
    ).toBe('Hi Jamie LVP !');
  });
});

describe('loops, stored shapes and templates', () => {
  const node = (
    id: string,
    event: string,
    actions: { type: string; config: Record<string, unknown> }[],
  ) => ({
    id,
    name: id,
    event,
    actions,
  });
  const makesTask = (config: Record<string, unknown> = {}) => [{ type: 'CREATE_TASK', config }];

  it('finds a rule that starts itself, a cycle of two, and a chain that is too long', () => {
    expect(produces(makesTask({ dueInDays: 5 }))).toEqual([]);
    expect(produces(makesTask({ dueInDays: 1 }))).toEqual(['task.overdue']);
    expect(produces(makesTask())).toEqual(['task.overdue']);
    expect(produces([{ type: 'ADD_CLIENT_NOTE', config: {} }])).toEqual([]);
    expect(loopProblems(node('a', 'task.overdue', makesTask()), [], 3).map((p) => p.code)).toEqual([
      'LOOP_RISK',
    ]);
    expect(loopProblems(node('a', 'task.overdue', makesTask({ dueInDays: 9 })), [], 3)).toEqual([]);
    // A makes a task that B starts on, and B makes one that A starts on.
    const cycle = loopProblems(
      node('a', 'task.overdue', makesTask({ dueInDays: 0 })),
      [node('b', 'task.overdue', makesTask({ dueInDays: 0 }))],
      3,
    );
    expect(cycle.map((p) => p.code)).toEqual(['LOOP_RISK']);
    // A rule is not in a loop with itself when it is the one being saved again.
    expect(
      loopProblems(
        node('a', 'client.created', makesTask()),
        [node('a', 'task.overdue', makesTask())],
        3,
      ),
    ).toEqual([]);
  });

  it('stores a definition with the firm’s defaults and reads it back the same', () => {
    const s = stored(
      def({ conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }] }),
      { defaultDedupeDays: 9 },
    );
    expect(s.settings).toMatchObject({
      preventDuplicatesDays: 9,
      logAll: true,
      quietHours: null,
      safetyThreshold: null,
    });
    expect(s.actions[0]).toMatchObject({ delayMinutes: 0, dependsOn: null });
    const view = viewOf({
      triggerModule: s.trigger.module,
      triggerEvent: s.trigger.event,
      timing: s.trigger.timing,
      offsetValue: s.trigger.offsetValue,
      offsetUnit: s.trigger.offsetUnit,
      matchMode: s.matchMode,
      conditions: s.conditions,
      actions: s.actions,
      settings: s.settings,
    });
    expect(view.conditions).toEqual([{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }]);
    expect(view.settings.preventDuplicatesDays).toBe(9);
  });

  it('leaves a firm’s own choices, secrets and record ids out of a template', () => {
    const clean = forTemplate(
      def({
        actions: [
          {
            id: 'm',
            type: 'SEND_CLIENT_MESSAGE',
            config: {
              templateId: '01a14c08-b3bc-71b9-8871-3093128ae2be',
              subject: 'Hi',
              body: 'Z'.repeat(48),
            },
          },
          {
            id: 't',
            type: 'CREATE_TASK',
            config: { title: 'x', assigneeUserId: '01a14c08-b3bc-71b9-8871-3093128ae2be' },
          },
        ],
        settings: { notifyOnFailureUserIds: ['01a14c08-b3bc-71b9-8871-3093128ae2be'] },
      }),
    );
    expect(clean.actions[0]?.config).toEqual({ subject: 'Hi' });
    expect(clean.actions[1]?.config).toEqual({ title: 'x' });
    expect(clean.settings.notifyOnFailureUserIds).toEqual([]);
    expect(() =>
      forTemplate(
        def({
          actions: [
            {
              id: 'n',
              type: 'ADD_CLIENT_NOTE',
              config: { body: 'For 01a14c08-b3bc-71b9-8871-3093128ae2be' },
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe('who may do what', () => {
  it('lets Owner and Admin do everything, the grid roles what their row gives, and Staff read', () => {
    for (const role of ['OWNER', 'ADMIN'])
      expect(permsOf(staff(role))).toEqual({
        admin: true,
        write: true,
        activate: true,
        export: true,
        manage: true,
      });
    for (const role of ['STAFF', 'TAX_PREPARER', 'READ_ONLY'])
      expect(permsOf(staff(role))).toEqual({
        admin: false,
        write: false,
        activate: false,
        export: false,
        manage: false,
      });
    expect(permsOf(undefined).write).toBe(false);
    expect(mayAct('OWNER', 'TASKS')).toBe(true);
    expect(mayAct('STAFF', 'TASKS')).toBe(true);
    expect(mayAct('STAFF', 'PAYROLL')).toBe(false);
    expect(mayAct('READ_ONLY', 'TASKS')).toBe(false);
  });
});
