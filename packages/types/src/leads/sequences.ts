import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { clearable, text } from '../clients/text.js';
import { LeadActionType, LeadStepMode, LeadStepOwner } from '../db-enums.js';
import { LeadProfile, LeadRecordId } from './pipeline.js';

// Leads R2 19 (Octavia, Nov 8): reusable follow-up sequences. A template (Templates > Lead
// follow-up sequences; Owner and Admin) holds ordered steps, each so many days after the sequence
// is applied, at a time or not, with an action, an owner and whether it is an internal REMINDER or
// OUTREACH the owner sends. Applying one to a lead (anyone who reaches the lead) shows the steps
// with their dates to edit first, then makes them the lead's follow-up steps; nothing is ever sent
// automatically. Converting the lead, Not Qualified or Lost stops the run; its unfinished steps
// stay on the lead.

const DateTime = z.iso.datetime({ offset: true });
/** "09:30": a step's time of day, or none (a day only). */
export const StepTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30');

export const LEAD_STEP_MODE_LABELS: Record<LeadStepMode, string> = {
  REMINDER: 'Internal reminder',
  OUTREACH: 'Outreach (you send it)',
};
export const LEAD_STEP_OWNER_LABELS: Record<LeadStepOwner, string> = {
  LEAD_OWNER: "The lead's owner",
  APPLIER: 'Whoever applies it',
};

/** One step of a template. */
export const LeadSequenceStep = z.object({
  offsetDays: z.number().int(),
  atTime: StepTime.nullable(),
  actionType: LeadActionType,
  mode: LeadStepMode,
  owner: LeadStepOwner,
  note: z.string().nullable(),
});
export type LeadSequenceStep = z.infer<typeof LeadSequenceStep>;

export const LeadSequenceTemplate = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  steps: z.array(LeadSequenceStep).max(20),
  updatedAt: DateTime,
});
export type LeadSequenceTemplate = z.infer<typeof LeadSequenceTemplate>;
export const LeadSequenceTemplateList = z.object({ items: z.array(LeadSequenceTemplate) });
export type LeadSequenceTemplateList = z.infer<typeof LeadSequenceTemplateList>;

const StepInput = z.strictObject({
  offsetDays: z.number().int().min(0, 'Use 0 to 365 days').max(365, 'Use 0 to 365 days'),
  atTime: StepTime.nullable().default(null),
  actionType: LeadActionType,
  mode: LeadStepMode.default('REMINDER'),
  owner: LeadStepOwner.default('LEAD_OWNER'),
  note: clearable(text(500, 'many')),
});

/**
 * POST /business/lead-sequences and PUT .../{id} (Owner, Admin): a template and its steps, in
 * order (1 to 20). 409 NAME_TAKEN when another live template has the name.
 */
export const SaveLeadSequenceRequest = z.strictObject({
  name: text(80, 'one', 'Name the sequence'),
  description: clearable(text(500, 'many')),
  steps: z.array(StepInput).min(1, 'Add at least one step').max(20, 'Use at most 20 steps'),
});
export type SaveLeadSequenceRequest = z.input<typeof SaveLeadSequenceRequest>;

/**
 * POST /business/leads/{id}/sequences: the template's steps as the member previewed and edited
 * them. 409 SEQUENCE_ALREADY_APPLIED while the lead has an open run of it, LEAD_CLOSED for a closed
 * lead; 404 for a template or member not the firm's.
 */
export const ApplyLeadSequenceRequest = z.strictObject({
  templateId: z.uuid(),
  steps: z
    .array(
      z.strictObject({
        actionType: LeadActionType,
        dueAt: DateTime,
        mode: LeadStepMode,
        assignedUserId: z.uuid().nullable(),
        note: clearable(text(500, 'many')),
      }),
    )
    .min(1, 'Keep at least one step')
    .max(20),
});
export type ApplyLeadSequenceRequest = z.input<typeof ApplyLeadSequenceRequest>;

/**
 * A template's steps as they would be applied from `startOn` (YYYY-MM-DD, the member's own day):
 * each step's day, at its time (9:00 when it has none) in the member's time zone, and its owner.
 */
export function previewSequence(
  template: Pick<LeadSequenceTemplate, 'steps'>,
  options: { startOn: string; leadOwnerId: string | null; applierId: string },
): z.input<typeof ApplyLeadSequenceRequest>['steps'] {
  const [y, m, d] = options.startOn.split('-').map(Number) as [number, number, number];
  return template.steps.map((step) => {
    const [hh, mm] = (step.atTime ?? '09:00').split(':').map(Number) as [number, number];
    const due = new Date(y, m - 1, d + step.offsetDays, hh, mm, 0, 0);
    return {
      actionType: step.actionType,
      dueAt: due.toISOString(),
      mode: step.mode,
      assignedUserId: step.owner === 'APPLIER' ? options.applierId : options.leadOwnerId,
      note: step.note,
    };
  });
}

/** `api.leadSequences`: the templates, and applying or stopping one on a lead. */
export function createLeadSequencesClient(request: ApiRequest) {
  const base = '/business/lead-sequences';
  const lead = (id: string) => `/business/leads/${parseInput(LeadRecordId, id)}/sequences`;
  return {
    list: async (): Promise<LeadSequenceTemplate[]> =>
      (await request(LeadSequenceTemplateList, base)).items,
    create: async (body: SaveLeadSequenceRequest): Promise<LeadSequenceTemplate> =>
      request(LeadSequenceTemplate, base, {
        method: 'POST',
        body: parseInput(SaveLeadSequenceRequest, body),
      }),
    update: async (id: string, body: SaveLeadSequenceRequest): Promise<LeadSequenceTemplate> =>
      request(LeadSequenceTemplate, `${base}/${parseInput(z.uuid(), id)}`, {
        method: 'PUT',
        body: parseInput(SaveLeadSequenceRequest, body),
      }),
    archive: async (id: string): Promise<LeadSequenceTemplate> =>
      request(LeadSequenceTemplate, `${base}/${parseInput(z.uuid(), id)}/archive`, {
        method: 'POST',
      }),
    apply: async (leadId: string, body: ApplyLeadSequenceRequest): Promise<LeadProfile> =>
      request(LeadProfile, lead(leadId), {
        method: 'POST',
        body: parseInput(ApplyLeadSequenceRequest, body),
      }),
    stop: async (leadId: string, runId: string): Promise<LeadProfile> =>
      request(LeadProfile, `${lead(leadId)}/${parseInput(z.uuid(), runId)}/stop`, {
        method: 'POST',
      }),
  };
}
export type LeadSequencesClient = ReturnType<typeof createLeadSequencesClient>;
