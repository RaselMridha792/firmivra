// R55's Leads Review Two additions (migration r55_leads_additions, approved by the lead under
// Rasel's delegation, Nov 14): R2 15 a final merge into an open lead and "not a duplicate" pairs;
// R2 17 assignment rules, routing settings and the rule a lead was assigned by; R2 19 follow-up
// sequence templates, their steps, runs on a lead and the follow-ups a run made. Each new table
// refuses another firm. Runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const services = { a: '', b: '' };

/** A new open lead of the firm (CONTACTED), made with the owner role. */
async function newLead(businessId: string, extra: object = {}): Promise<string> {
  const serviceId = businessId === f.firmA ? services.a : services.b;
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const lead = await tx.lead.create({
      data: {
        businessId,
        serviceId,
        firstName: 'Fake',
        lastName: 'Lead',
        email: `l-${randomUUID()}@r55la.test`,
        status: 'CONTACTED',
        submittedAt: new Date(),
        ...extra,
      },
    });
    return lead.id;
  });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r55la');
  for (const [key, businessId] of [
    ['a', f.firmA],
    ['b', f.firmB],
  ] as const) {
    services[key] = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      const s = await tx.service.create({
        data: { businessId, kind: 'BOOKKEEPING', name: `Books ${randomUUID().slice(0, 6)}` },
      });
      return s.id;
    });
  }
});

describe('R2 15: merge and dismissals', () => {
  it('a merge is all three columns, into another open lead, archived and final', async () => {
    const kept = await newLead(f.firmA);
    const merged = await newLead(f.firmA);
    const at = new Date();
    const merge = { mergedIntoLeadId: kept, mergedAt: at, mergedByUserId: f.memberA };
    // Not archived, or only part of it: refused.
    expect(await failure(A().lead.update({ where: { id: merged }, data: merge }))).toMatch(
      /leads_merge_shape/,
    );
    expect(
      await failure(
        A().lead.update({
          where: { id: merged },
          data: { mergedIntoLeadId: kept, archivedAt: at, archivedByUserId: f.memberA },
        }),
      ),
    ).toMatch(/leads_merge_shape/);
    // Into itself: refused.
    expect(
      await failure(
        A().lead.update({
          where: { id: merged },
          data: { ...merge, mergedIntoLeadId: merged, archivedAt: at, archivedByUserId: f.memberA },
        }),
      ),
    ).toMatch(/leads_merge_shape/);
    await expect(
      A().lead.update({
        where: { id: merged },
        data: { ...merge, archivedAt: at, archivedByUserId: f.memberA },
      }),
    ).resolves.toMatchObject({ mergedIntoLeadId: kept });
    // Final: neither changed, undone nor brought back.
    const other = await newLead(f.firmA);
    expect(
      await failure(A().lead.update({ where: { id: merged }, data: { mergedIntoLeadId: other } })),
    ).toMatch(/a merge is final/);
    expect(
      await failure(
        A().lead.update({
          where: { id: merged },
          data: { mergedIntoLeadId: null, mergedAt: null, mergedByUserId: null },
        }),
      ),
    ).toMatch(/a merge is final/);
    expect(
      await failure(
        A().lead.update({
          where: { id: merged },
          data: { archivedAt: null, archivedByUserId: null },
        }),
      ),
    ).toMatch(/leads_merge_shape/);
    // Into a merged (archived) lead: refused.
    expect(
      await failure(
        A().lead.update({
          where: { id: other },
          data: {
            mergedIntoLeadId: merged,
            mergedAt: at,
            mergedByUserId: f.memberA,
            archivedAt: at,
            archivedByUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/merged into an open lead/);
  });

  it("never into another firm's lead, and a new lead is not merged", async () => {
    const leadA = await newLead(f.firmA);
    const leadB = await newLead(f.firmB);
    const at = new Date();
    expect(
      await failure(
        B().lead.update({
          where: { id: leadB },
          data: {
            mergedIntoLeadId: leadA,
            mergedAt: at,
            mergedByUserId: f.memberB,
            archivedAt: at,
            archivedByUserId: f.memberB,
          },
        }),
      ),
    ).toMatch(/foreign key|merged into an open lead/i);
    expect(
      await failure(
        A().lead.create({
          data: {
            businessId: f.firmA,
            serviceId: services.a,
            firstName: 'Fake',
            lastName: 'New',
            email: `n-${randomUUID()}@r55la.test`,
            status: 'CONTACTED',
            submittedAt: at,
            mergedIntoLeadId: leadA,
            mergedAt: at,
            mergedByUserId: f.memberA,
            archivedAt: at,
            archivedByUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/a new lead is not merged/);
  });

  it('a pair is dismissed once, in either order; another firm sees and names none', async () => {
    const one = await newLead(f.firmA);
    const two = await newLead(f.firmA);
    const row = await A().leadDuplicateDismissal.create({
      data: { businessId: f.firmA, leadId: one, otherLeadId: two, dismissedByUserId: f.memberA },
    });
    expect(
      await failure(
        A().leadDuplicateDismissal.create({
          data: {
            businessId: f.firmA,
            leadId: two,
            otherLeadId: one,
            dismissedByUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/lead_duplicate_dismissals_pair|unique/i);
    expect(
      await failure(
        A().leadDuplicateDismissal.create({
          data: {
            businessId: f.firmA,
            leadId: one,
            otherLeadId: one,
            dismissedByUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/lead_duplicate_dismissals_two_leads/);
    expect(await B().leadDuplicateDismissal.findMany({ where: { id: row.id } })).toEqual([]);
    const leadB = await newLead(f.firmB);
    expect(
      await failure(
        B().leadDuplicateDismissal.create({
          data: {
            businessId: f.firmB,
            leadId: leadB,
            otherLeadId: one,
            dismissedByUserId: f.memberB,
          },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('R2 17: routing', () => {
  it("rules: a name, lists that are never null, the firm's own assignee; the lead names its rule", async () => {
    const rule = await A().leadAssignmentRule.create({
      data: {
        businessId: f.firmA,
        name: 'Referrals (fake)',
        position: 0,
        sources: ['REFERRAL'],
        priorities: ['HOT'],
        serviceIds: [services.a],
        assigneeUserId: f.memberA,
      },
    });
    expect(
      await failure(
        A().leadAssignmentRule.create({
          data: { businessId: f.firmA, name: '  ', position: 1, assigneeUserId: f.memberA },
        }),
      ),
    ).toMatch(/lead_assignment_rules_shape/);
    expect(
      await failure(
        A().leadAssignmentRule.create({
          data: { businessId: f.firmA, name: 'X', position: 1, assigneeUserId: f.memberB },
        }),
      ),
    ).toMatch(/foreign key/i);
    // A lead names the rule that gave it its owner, only with an owner.
    const lead = await newLead(f.firmA);
    expect(
      await failure(A().lead.update({ where: { id: lead }, data: { assignedByRuleId: rule.id } })),
    ).toMatch(/leads_assigned_by_rule/);
    await expect(
      A().lead.update({
        where: { id: lead },
        data: { assignedUserId: f.memberA, assignedByRuleId: rule.id },
      }),
    ).resolves.toMatchObject({ assignedByRuleId: rule.id });
    // Another firm neither sees the rule nor names it.
    expect(await B().leadAssignmentRule.findMany({ where: { id: rule.id } })).toEqual([]);
    const leadB = await newLead(f.firmB);
    expect(
      await failure(
        B().lead.update({
          where: { id: leadB },
          data: { assignedUserId: f.memberB, assignedByRuleId: rule.id },
        }),
      ),
    ).toMatch(/foreign key/i);
    // Archived, never deleted.
    expect(await failure(A().leadAssignmentRule.delete({ where: { id: rule.id } }))).toMatch(
      /permission denied|denied/i,
    );
  });

  it("settings: one row per firm, the firm's own fallback", async () => {
    await expect(
      A().leadRoutingSettings.create({
        data: { businessId: f.firmA, enabled: true, fallbackUserId: f.member2A },
      }),
    ).resolves.toMatchObject({ enabled: true });
    expect(
      await failure(
        B().leadRoutingSettings.create({
          data: { businessId: f.firmB, fallbackUserId: f.memberA },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(await B().leadRoutingSettings.findMany({ where: { businessId: f.firmA } })).toEqual([]);
  });
});

describe('R2 19: sequences', () => {
  it('templates and steps: a live name once, up to 20 steps within a year', async () => {
    const t = await A().leadSequenceTemplate.create({
      data: { businessId: f.firmA, name: 'Welcome (fake)', createdByUserId: f.memberA },
    });
    expect(
      await failure(
        A().leadSequenceTemplate.create({
          data: { businessId: f.firmA, name: ' welcome (FAKE) ' },
        }),
      ),
    ).toMatch(/lead_sequence_templates_live_name|unique/i);
    await A().leadSequenceStep.create({
      data: {
        businessId: f.firmA,
        templateId: t.id,
        position: 0,
        offsetDays: 0,
        actionType: 'CALL',
      },
    });
    for (const [data, rule] of [
      [{ position: 0, offsetDays: 1 }, /unique/i],
      [{ position: 20, offsetDays: 1 }, /lead_sequence_steps_shape/],
      [{ position: 1, offsetDays: 366 }, /lead_sequence_steps_shape/],
    ] as const) {
      expect(
        await failure(
          A().leadSequenceStep.create({
            data: { businessId: f.firmA, templateId: t.id, actionType: 'EMAIL', ...data },
          }),
        ),
      ).toMatch(rule);
    }
    expect(
      await failure(
        B().leadSequenceStep.create({
          data: {
            businessId: f.firmB,
            templateId: t.id,
            position: 1,
            offsetDays: 1,
            actionType: 'CALL',
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    expect(await B().leadSequenceTemplate.findMany({ where: { id: t.id } })).toEqual([]);
    // Archived, its name is free again.
    await A().leadSequenceTemplate.update({
      where: { id: t.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      A().leadSequenceTemplate.create({ data: { businessId: f.firmA, name: 'Welcome (fake)' } }),
    ).resolves.toMatchObject({ archivedAt: null });
  });

  it('runs: one open per lead and template, a live template, final once stopped', async () => {
    const t = await A().leadSequenceTemplate.create({
      data: { businessId: f.firmA, name: `Nurture ${randomUUID().slice(0, 6)}` },
    });
    const lead = await newLead(f.firmA);
    const run = await A().leadSequenceRun.create({
      data: { businessId: f.firmA, leadId: lead, templateId: t.id, appliedByUserId: f.memberA },
    });
    expect(
      await failure(
        A().leadSequenceRun.create({
          data: { businessId: f.firmA, leadId: lead, templateId: t.id },
        }),
      ),
    ).toMatch(/lead_sequence_runs_open|unique/i);
    expect(
      await failure(
        A().leadSequenceRun.update({ where: { id: run.id }, data: { stopReason: 'Converted' } }),
      ),
    ).toMatch(/lead_sequence_runs_stop/);
    await A().leadSequenceRun.update({
      where: { id: run.id },
      data: { stoppedAt: new Date(), stopReason: 'Converted' },
    });
    expect(
      await failure(
        A().leadSequenceRun.update({ where: { id: run.id }, data: { stoppedAt: null } }),
      ),
    ).toMatch(/a stopped run stays stopped/);
    // Stopped, the template can be applied again; an archived one can't.
    await A().leadSequenceRun.create({
      data: { businessId: f.firmA, leadId: lead, templateId: t.id },
    });
    const archived = await A().leadSequenceTemplate.create({
      data: {
        businessId: f.firmA,
        name: `Old ${randomUUID().slice(0, 6)}`,
        archivedAt: new Date(),
      },
    });
    expect(
      await failure(
        A().leadSequenceRun.create({
          data: { businessId: f.firmA, leadId: lead, templateId: archived.id },
        }),
      ),
    ).toMatch(/an archived template is not applied/);
    // Not on another firm's lead, not seen by it.
    const leadB = await newLead(f.firmB);
    expect(
      await failure(
        B().leadSequenceRun.create({
          data: { businessId: f.firmB, leadId: leadB, templateId: t.id },
        }),
      ),
      // Under firm B's RLS the run's rule can't see firm A's template either: refused first.
    ).toMatch(/foreign key|an archived template is not applied/i);
    expect(await B().leadSequenceRun.findMany({ where: { id: run.id } })).toEqual([]);
  });

  it("a step a run made says its mode and belongs to that run's lead", async () => {
    const t = await A().leadSequenceTemplate.create({
      data: { businessId: f.firmA, name: `Steps ${randomUUID().slice(0, 6)}` },
    });
    const lead = await newLead(f.firmA);
    const otherLead = await newLead(f.firmA);
    const run = await A().leadSequenceRun.create({
      data: { businessId: f.firmA, leadId: lead, templateId: t.id },
    });
    const step = { businessId: f.firmA, actionType: 'CALL' as const, dueAt: new Date() };
    expect(
      await failure(
        A().leadFollowUp.create({ data: { ...step, leadId: lead, sequenceRunId: run.id } }),
      ),
    ).toMatch(/lead_follow_ups_sequence_mode/);
    expect(
      await failure(
        A().leadFollowUp.create({
          data: { ...step, leadId: otherLead, sequenceRunId: run.id, mode: 'REMINDER' },
        }),
      ),
    ).toMatch(/foreign key/i);
    await expect(
      A().leadFollowUp.create({
        data: {
          ...step,
          leadId: lead,
          sequenceRunId: run.id,
          mode: 'OUTREACH',
          assignedUserId: f.memberA,
        },
      }),
    ).resolves.toMatchObject({ mode: 'OUTREACH' });
  });
});
