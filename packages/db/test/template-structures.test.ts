// Structured templates (R1, Oct 29; migration r1_template_structures, Octavia's TP-F08): a Task,
// Document Request or Intake and Organizer library row links its module's own template, at most
// one row each; Tax Workflow and Bookkeeping keep a JSON object structure, and a version keeps
// the structure it saved. Each only on its own kind, and a firm never links another firm's
// template or sees another firm's structure. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const ids = { task: '', request: '', intake: '', taskB: '' };

/** A library row of firm A (or B) of this kind, with these columns. */
const template = (kind: string, data: Record<string, unknown> = {}, firm: 'A' | 'B' = 'A') =>
  (firm === 'A' ? A() : B()).messageTemplate.create({
    data: {
      businessId: firm === 'A' ? f.firmA : f.firmB,
      kind: kind as 'TASK',
      name: `Template ${randomUUID()}`,
      body: 'Intro text (fake)',
      ownerUserId: firm === 'A' ? f.memberA : f.memberB,
      ...data,
    },
  });
const taxWorkflow = {
  sections: [{ section: 'PREPARATION', items: [{ label: 'Gather prior-year return (fake)' }] }],
};
const bookkeeping = {
  documentRequests: [{ label: 'Bank statements (fake)', cadence: 'MONTHLY' }],
  closeChecklist: [{ key: 'reconcile', label: 'Reconcile accounts', required: true }],
  clientUpdates: [],
};

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1tps');
  ids.task = (
    await A().taskTemplate.create({ data: { businessId: f.firmA, name: 'Follow-up' } })
  ).id;
  ids.taskB = (
    await B().taskTemplate.create({ data: { businessId: f.firmB, name: 'Follow-up' } })
  ).id;
  ids.request = (
    await A().documentRequestTemplate.create({ data: { businessId: f.firmA, name: 'Tax docs' } })
  ).id;
  const service = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.service.create({
      data: { businessId: f.firmA, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
    }),
  );
  ids.intake = (
    await A().intakeTemplate.create({ data: { businessId: f.firmA, serviceId: service.id } })
  ).id;
});

describe('links to the module templates', () => {
  it('links each structured kind to its own module template', async () => {
    await expect(template('TASK', { taskTemplateId: ids.task })).resolves.toMatchObject({
      taskTemplateId: ids.task,
    });
    await expect(
      template('DOCUMENT_REQUEST', { documentRequestTemplateId: ids.request }),
    ).resolves.toMatchObject({ documentRequestTemplateId: ids.request });
    await expect(
      template('INTAKE_ORGANIZER', { intakeTemplateId: ids.intake }),
    ).resolves.toMatchObject({ intakeTemplateId: ids.intake });
  });

  it('gives each module template at most one library row (23505)', async () => {
    for (const [kind, data] of [
      ['TASK', { taskTemplateId: ids.task }],
      ['DOCUMENT_REQUEST', { documentRequestTemplateId: ids.request }],
      ['INTAKE_ORGANIZER', { intakeTemplateId: ids.intake }],
    ] as const) {
      expect(await failure(template(kind, data)), kind).toMatch(/unique/i);
    }
  });

  it('puts a link only on its own kind (23514)', async () => {
    for (const [kind, data] of [
      ['EMAIL', { taskTemplateId: ids.task }],
      ['TASK', { documentRequestTemplateId: ids.request }],
      ['TAX_WORKFLOW', { intakeTemplateId: ids.intake }],
    ] as const) {
      expect(await failure(template(kind, data)), kind).toMatch(
        /message_templates_structure_by_kind/,
      );
    }
  });

  it('keeps a linked module template from being deleted', async () => {
    // The app role never deletes task templates (they are archived); the owner cannot either.
    expect(
      await failure(
        runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
          tx.taskTemplate.delete({ where: { id: ids.task } }),
        ),
      ),
    ).toMatch(/foreign key/i);
  });

  it('still takes a structured kind without a link (rows before the migration)', async () => {
    await expect(template('TASK')).resolves.toMatchObject({
      taskTemplateId: null,
      structure: null,
    });
  });
});

describe('a structure', () => {
  it('is a JSON object on Tax Workflow and Bookkeeping only (23514)', async () => {
    await expect(template('TAX_WORKFLOW', { structure: taxWorkflow })).resolves.toMatchObject({
      structure: taxWorkflow,
    });
    await expect(template('BOOKKEEPING', { structure: bookkeeping })).resolves.toMatchObject({
      structure: bookkeeping,
    });
    for (const [kind, structure] of [
      ['EMAIL', taxWorkflow],
      ['TASK', bookkeeping],
      ['TAX_WORKFLOW', [taxWorkflow]],
      ['BOOKKEEPING', 'close checklist'],
    ] as const) {
      expect(await failure(template(kind, { structure })), kind).toMatch(
        /message_templates_structure_by_kind/,
      );
    }
  });

  it('is kept as saved on the version, as an object', async () => {
    const t = await template('TAX_WORKFLOW', { structure: taxWorkflow });
    const version = (n: number, structure: object) =>
      A().messageTemplateVersion.create({
        data: {
          businessId: f.firmA,
          templateId: t.id,
          version: n,
          name: t.name,
          body: t.body,
          structure,
          savedByUserId: f.memberA,
        },
      });
    await expect(version(1, taxWorkflow)).resolves.toMatchObject({ structure: taxWorkflow });
    expect(await failure(version(2, ['not', 'an', 'object']))).toMatch(
      /message_template_versions_structure/,
    );
  });
});

describe('isolation', () => {
  it("firm B never links firm A's module templates", async () => {
    for (const [kind, data] of [
      ['TASK', { taskTemplateId: ids.task }],
      ['DOCUMENT_REQUEST', { documentRequestTemplateId: ids.request }],
      ['INTAKE_ORGANIZER', { intakeTemplateId: ids.intake }],
    ] as const) {
      expect(await failure(template(kind, data, 'B')), kind).toMatch(/foreign key/i);
    }
    // Firm B links its own, with the same name as firm A's.
    await expect(template('TASK', { taskTemplateId: ids.taskB }, 'B')).resolves.toMatchObject({
      taskTemplateId: ids.taskB,
    });
  });

  it("firm B never sees or changes firm A's structure", async () => {
    const t = await template('BOOKKEEPING', { structure: bookkeeping });
    expect(await B().messageTemplate.findMany({ where: { id: t.id } })).toEqual([]);
    const { count } = await B().messageTemplate.updateMany({
      where: { id: t.id },
      data: { structure: taxWorkflow },
    });
    expect(count).toBe(0);
    await expect(
      A().messageTemplate.findUniqueOrThrow({ where: { id: t.id } }),
    ).resolves.toMatchObject({ structure: bookkeeping });
  });
});
