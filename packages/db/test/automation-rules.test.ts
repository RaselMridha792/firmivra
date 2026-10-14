// Automations, part 1 (R38): rules, their immutable versions and templates. Isolation between
// firms and the rules of migration r38_automation_rules. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const rule = (data: Record<string, unknown> = {}) =>
  A().automationRule.create({
    data: {
      businessId: f.firmA,
      name: `Rule ${randomUUID()}`,
      category: 'COMPLIANCE_DEADLINES',
      ...data,
    },
  });
const actions = [{ id: 'a1', type: 'create_task', config: {} }];
const version = (ruleId: string, data: Record<string, unknown> = {}) =>
  A().automationRuleVersion.create({
    data: {
      businessId: f.firmA,
      ruleId,
      version: 1,
      triggerModule: 'COMPLIANCE_DEADLINES',
      triggerEvent: 'deadline.approaching',
      timing: 'BEFORE',
      offsetValue: 14,
      offsetUnit: 'DAY',
      actions,
      ...data,
    },
  });
const template = (data: Record<string, unknown> = {}) =>
  A().automationTemplate.create({
    data: {
      businessId: f.firmA,
      name: `Template ${randomUUID()}`,
      category: 'TASKS',
      definition: { actions },
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38ar');
});

describe('isolation', () => {
  it('another firm sees no rule, version or template', async () => {
    const r = await rule();
    await version(r.id);
    await template();
    const B = db.forBusiness(f.firmB);
    expect(await B.automationRule.findMany()).toEqual([]);
    expect(await B.automationRuleVersion.findMany()).toEqual([]);
    expect(await B.automationTemplate.findMany()).toEqual([]);
    expect(
      await failure(
        B.automationRule.create({ data: { businessId: f.firmA, name: 'x', category: 'TASKS' } }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("a rule cannot use another firm's owner or version", async () => {
    expect(await failure(rule({ ownerUserId: f.memberB }))).toMatch(/foreign key/i);
    const rB = await db.forBusiness(f.firmB).automationRule.create({
      data: { businessId: f.firmB, name: 'B rule', category: 'TASKS' },
    });
    const vB = await db.forBusiness(f.firmB).automationRuleVersion.create({
      data: {
        businessId: f.firmB,
        ruleId: rB.id,
        version: 1,
        triggerModule: 'TASKS',
        triggerEvent: 'task.created',
        actions,
      },
    });
    const r = await rule();
    expect(
      await failure(
        A().automationRule.update({ where: { id: r.id }, data: { currentVersionId: vB.id } }),
      ),
    ).toMatch(/foreign key|own versions/i);
  });
});

describe('rules', () => {
  it('have a live name that is unique per firm, and an archived one frees it', async () => {
    const r = await rule({ name: 'Reminder' });
    expect(await failure(rule({ name: 'REMINDER' }))).toMatch(/unique/i);
    await A().automationRule.update({
      where: { id: r.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(rule({ name: 'Reminder' })).resolves.toBeTruthy();
    for (const data of [
      { name: ' ' },
      { name: 'x'.repeat(121) },
      { status: 'ARCHIVED' },
      { archivedAt: new Date() },
    ]) {
      expect(await failure(rule(data))).toMatch(/check constraint/i);
    }
  });

  it('is ACTIVE only with a current version of its own', async () => {
    const r = await rule();
    const other = await rule();
    expect(
      await failure(A().automationRule.update({ where: { id: r.id }, data: { status: 'ACTIVE' } })),
    ).toMatch(/check constraint/i);
    const v = await version(r.id);
    const vOther = await version(other.id);
    expect(
      await failure(
        A().automationRule.update({ where: { id: r.id }, data: { currentVersionId: vOther.id } }),
      ),
    ).toMatch(/own versions/);
    await expect(
      A().automationRule.update({
        where: { id: r.id },
        data: { currentVersionId: v.id, status: 'ACTIVE' },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(await failure(rule({ status: 'ACTIVE' }))).toMatch(/check constraint/i);
  });
});

describe('versions', () => {
  it('are insert-only and one number per rule', async () => {
    const r = await rule();
    const v = await version(r.id);
    expect(await failure(version(r.id))).toMatch(/unique/i);
    await expect(version(r.id, { version: 2 })).resolves.toBeTruthy();
    expect(
      await failure(
        A().automationRuleVersion.update({ where: { id: v.id }, data: { settings: {} } }),
      ),
    ).toMatch(/permission denied/i);
    expect(await failure(A().automationRuleVersion.delete({ where: { id: v.id } }))).toMatch(
      /permission denied/i,
    );
  });

  it('checks the trigger event and its timing', async () => {
    const r = await rule();
    let n = 1;
    const make = (data: Record<string, unknown>) => version(r.id, { version: ++n, ...data });
    for (const data of [
      { triggerEvent: 'Deadline Approaching' },
      { triggerEvent: 'deadline' },
      { timing: 'IMMEDIATE' }, // an offset on an immediate rule
      { offsetValue: null, offsetUnit: null }, // before and after need one
      { offsetUnit: null },
      { offsetValue: -1 },
    ]) {
      expect(await failure(make(data))).toMatch(/check constraint/i);
    }
    await expect(
      make({ timing: 'IMMEDIATE', offsetValue: null, offsetUnit: null }),
    ).resolves.toBeTruthy();
    await expect(
      make({ timing: 'AFTER', offsetValue: 2, offsetUnit: 'HOUR' }),
    ).resolves.toBeTruthy();
  });

  it('checks conditions and ordered actions', async () => {
    const r = await rule();
    let n = 1;
    const make = (data: Record<string, unknown>) => version(r.id, { version: ++n, ...data });
    const ok = { field: 'client.type', operator: 'is', value: 'BUSINESS' };
    await expect(make({ conditions: [ok, ok], matchMode: 'ANY' })).resolves.toBeTruthy();
    for (const data of [
      { conditions: {} },
      { conditions: [{ field: 'client.type' }] },
      { conditions: new Array(21).fill(ok) },
      { actions: [] },
      { actions: {} },
      { actions: [{ type: 'create_task' }] },
      { actions: [{ id: 1, type: 'create_task' }] },
      { actions: new Array(21).fill(actions[0]) },
      { settings: [] },
    ]) {
      expect(await failure(make(data))).toMatch(/check constraint/i);
    }
  });
});

describe('templates', () => {
  it('have a unique name per firm and a definition object', async () => {
    await template({ name: 'Onboarding' });
    expect(await failure(template({ name: 'Onboarding' }))).toMatch(/unique/i);
    for (const data of [
      { name: ' ' },
      { definition: [] },
      { requiredIntegrations: new Array(21).fill('quickbooks') },
    ]) {
      expect(await failure(template(data))).toMatch(/check constraint/i);
    }
    await expect(template({ requiredIntegrations: ['quickbooks', 'xero'] })).resolves.toBeTruthy();
  });
});
