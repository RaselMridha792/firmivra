import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddLeadNoteRequest,
  CompleteFollowUpRequest,
  ConvertLeadToClientRequest,
  ConvertLeadToClientResult,
  CreateLeadRequest,
  LeadActivity,
  LeadActivityPage,
  LeadActivityQuery,
  LeadAppointment,
  LeadBulkRequest,
  LeadBulkResult,
  LeadDocumentsAndForms,
  LeadMessageRequest,
  LeadNote,
  LeadNoteList,
  LeadOptions,
  LeadPipelinePage,
  LeadPipelineQuery,
  LeadPipelineSummary,
  LeadProfile,
  LeadRecordId,
  LeadTask,
  LogLeadActivityRequest,
  SetFollowUpRequest,
  UpdateLeadRequest,
} from './pipeline.js';

const LEADS = '/business/leads';
const one = (id: string) => `${LEADS}/${parseInput(LeadRecordId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

const LeadTaskList = z.object({ items: z.array(LeadTask) });
const LeadAppointmentList = z.object({ items: z.array(LeadAppointment) });

/**
 * `api.leadPipeline` (apps/web/src/lib/api.ts): the Leads page and Lead Profile. Same leads as
 * `api.leads` (R11's Begin Online inbox). Every member with the grid's LEADS view; changes need
 * the matching capability (403 FORBIDDEN). Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. No business id is ever sent: the API takes it
 * from the signed-in firm.
 */
export function createLeadPipelineClient(request: ApiRequest) {
  return {
    list: async (query: LeadPipelineQuery = {}): Promise<LeadPipelinePage> =>
      request(
        LeadPipelinePage,
        `${LEADS}/pipeline${toQuery(parseInput(LeadPipelineQuery, query))}`,
      ),
    summary: async (): Promise<LeadPipelineSummary> =>
      request(LeadPipelineSummary, `${LEADS}/pipeline/summary`),
    options: async (): Promise<LeadOptions> => request(LeadOptions, `${LEADS}/options`),

    /** Add New Lead. 409 POSSIBLE_DUPLICATE: ask, then resend with allowDuplicate. */
    create: async (body: CreateLeadRequest): Promise<LeadProfile> =>
      request(LeadProfile, LEADS, post(parseInput(CreateLeadRequest, body))),
    profile: async (id: string): Promise<LeadProfile> => request(LeadProfile, `${one(id)}/profile`),
    update: async (id: string, body: UpdateLeadRequest): Promise<LeadProfile> =>
      request(LeadProfile, one(id), { method: 'PATCH', body: parseInput(UpdateLeadRequest, body) }),
    bulk: async (body: LeadBulkRequest): Promise<LeadBulkResult> =>
      request(LeadBulkResult, `${LEADS}/bulk`, post(parseInput(LeadBulkRequest, body))),
    /** Send Email / Send SMS to one or more leads (logged on each). */
    message: async (body: LeadMessageRequest): Promise<LeadBulkResult> =>
      request(LeadBulkResult, `${LEADS}/messages`, post(parseInput(LeadMessageRequest, body))),

    setFollowUp: async (id: string, body: SetFollowUpRequest): Promise<LeadProfile> =>
      request(LeadProfile, `${one(id)}/follow-up`, {
        method: 'PUT',
        body: parseInput(SetFollowUpRequest, body),
      }),
    completeFollowUp: async (
      id: string,
      body: CompleteFollowUpRequest = {},
    ): Promise<LeadProfile> =>
      request(
        LeadProfile,
        `${one(id)}/follow-up/complete`,
        post(parseInput(CompleteFollowUpRequest, body)),
      ),

    activity: async (id: string, query: LeadActivityQuery = {}): Promise<LeadActivityPage> =>
      request(
        LeadActivityPage,
        `${one(id)}/activity${toQuery(parseInput(LeadActivityQuery, query))}`,
      ),
    /** Call (when no calling integration: log it), Log Activity. */
    logActivity: async (id: string, body: LogLeadActivityRequest): Promise<LeadActivity> =>
      request(LeadActivity, `${one(id)}/activity`, post(parseInput(LogLeadActivityRequest, body))),
    notes: async (id: string): Promise<LeadNote[]> =>
      (await request(LeadNoteList, `${one(id)}/notes`)).items,
    addNote: async (id: string, body: AddLeadNoteRequest): Promise<LeadNote> =>
      request(LeadNote, `${one(id)}/notes`, post(parseInput(AddLeadNoteRequest, body))),
    tasks: async (id: string): Promise<LeadTask[]> =>
      (await request(LeadTaskList, `${one(id)}/tasks`)).items,
    appointments: async (id: string): Promise<LeadAppointment[]> =>
      (await request(LeadAppointmentList, `${one(id)}/appointments`)).items,
    documentsAndForms: async (id: string): Promise<LeadDocumentsAndForms> =>
      request(LeadDocumentsAndForms, `${one(id)}/documents-and-forms`),

    /** Convert Lead to Client (Review & Confirm). 409 DUPLICATE_EMAIL, ALREADY_CONVERTED. */
    convertToClient: async (
      id: string,
      body: ConvertLeadToClientRequest,
    ): Promise<ConvertLeadToClientResult> =>
      request(
        ConvertLeadToClientResult,
        `${one(id)}/convert-to-client`,
        post(parseInput(ConvertLeadToClientRequest, body)),
      ),
  };
}
export type LeadPipelineClient = ReturnType<typeof createLeadPipelineClient>;
