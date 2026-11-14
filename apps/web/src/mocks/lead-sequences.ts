import {
  ApplyLeadSequenceRequest,
  ApiRequestError,
  type LeadPipelineClient,
  type LeadProfile,
  type LeadSequencesClient,
  type LeadSequenceTemplate,
  parseInput,
  SaveLeadSequenceRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockLeadSequenceRuns } from './leads-pipeline';

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/**
 * An in-memory `api.leadSequences` (Leads R2 19): one starter template; applying one adds its
 * steps to the lead through the leads mock (`pipeline`), as the API makes them follow-up steps.
 */
export function createLeadSequencesMock(
  pipeline: LeadPipelineClient,
  role: 'OWNER' | 'ADMIN' | 'STAFF' = 'OWNER',
): LeadSequencesClient {
  let next = 1;
  const id = () => `0199c0f0-0d00-7000-8000-${String(next++).padStart(12, '0')}`;
  let templates: LeadSequenceTemplate[] = [
    {
      id: id(),
      name: 'New lead welcome',
      description: 'Call the same day, then a welcome email two days later.',
      updatedAt: '2026-11-01T12:00:00.000Z',
      steps: [
        {
          offsetDays: 0,
          atTime: '10:00',
          actionType: 'CALL',
          mode: 'REMINDER',
          owner: 'LEAD_OWNER',
          note: null,
        },
        {
          offsetDays: 2,
          atTime: null,
          actionType: 'EMAIL',
          mode: 'OUTREACH',
          owner: 'LEAD_OWNER',
          note: 'Welcome email',
        },
      ],
    },
  ];
  const runs = mockLeadSequenceRuns();
  const managers = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'Only an Owner or Admin can do this');
  };
  const withRuns = (p: LeadProfile): LeadProfile => ({
    ...p,
    sequences: structuredClone(runs.get(p.id) ?? []),
  });
  const save = (body: SaveLeadSequenceRequest, current?: LeadSequenceTemplate) => {
    const input = parseInput(SaveLeadSequenceRequest, body);
    if (
      templates.some(
        (t) => t.id !== current?.id && t.name.toLowerCase() === input.name.toLowerCase(),
      )
    )
      throw fail(409, 'NAME_TAKEN', 'Another sequence has this name');
    const t: LeadSequenceTemplate = {
      id: current?.id ?? id(),
      name: input.name,
      description: input.description ?? null,
      updatedAt: new Date().toISOString(),
      steps: input.steps.map((s) => ({ ...s, note: s.note ?? null })),
    };
    templates = current ? templates.map((x) => (x.id === t.id ? t : x)) : [...templates, t];
    return structuredClone(t);
  };
  return {
    list: async () => {
      await mockDelay();
      return structuredClone(templates);
    },
    create: async (body) => {
      await mockDelay();
      managers();
      return save(body);
    },
    update: async (templateId, body) => {
      await mockDelay();
      managers();
      const current = templates.find((t) => t.id === templateId);
      if (!current) throw fail(404, 'NOT_FOUND', 'Not found');
      return save(body, current);
    },
    archive: async (templateId) => {
      await mockDelay();
      managers();
      const current = templates.find((t) => t.id === templateId);
      if (!current) throw fail(404, 'NOT_FOUND', 'Not found');
      templates = templates.filter((t) => t.id !== templateId);
      return structuredClone(current);
    },
    apply: async (leadId, body) => {
      const input = parseInput(ApplyLeadSequenceRequest, body);
      const template = templates.find((t) => t.id === input.templateId);
      if (!template) throw fail(404, 'NOT_FOUND', 'Not found');
      const list = runs.get(leadId) ?? [];
      if (list.some((r) => r.templateId === template.id && !r.stoppedAt))
        throw fail(409, 'SEQUENCE_ALREADY_APPLIED', 'This sequence is already running on the lead');
      for (const step of input.steps)
        await pipeline.addFollowUp(leadId, {
          type: step.actionType,
          dueAt: step.dueAt,
          notes: step.note ?? null,
        });
      list.unshift({
        id: id(),
        templateId: template.id,
        name: template.name,
        appliedAt: new Date().toISOString(),
        stoppedAt: null,
        stopReason: null,
      });
      runs.set(leadId, list);
      return withRuns(await pipeline.profile(leadId));
    },
    stop: async (leadId, runId) => {
      const run = (runs.get(leadId) ?? []).find((r) => r.id === runId);
      if (!run) throw fail(404, 'NOT_FOUND', 'Not found');
      run.stoppedAt ??= new Date().toISOString();
      run.stopReason ??= 'Stopped';
      return withRuns(await pipeline.profile(leadId));
    },
  };
}
