import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddLeadNoteRequest,
  CompleteFollowUpRequest,
  BulkConvertLeadsRequest,
  BulkConvertLeadsResult,
  ConvertLeadToClientRequest,
  ConvertLeadToClientResult,
  CreateLeadRequest,
  CreateLeadFileRequest,
  CreateLeadTaskRequest,
  DismissLeadDuplicateRequest,
  LeadActivity,
  LeadActivityPage,
  LeadActivityQuery,
  LeadAppointment,
  LeadBulkRequest,
  LeadBulkResult,
  LeadDocument,
  LeadDocumentsAndForms,
  LeadDuplicateList,
  LeadMessageRequest,
  MergeLeadsRequest,
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
  AddLeadFollowUpRequest,
  UpdateLeadFollowUpRequest,
  CompleteLeadFollowUpRequest,
  UpdateLeadRequest,
  UpdateLeadTaskRequest,
} from './pipeline.js';
import {
  ConfirmEmailImageUploadRequest,
  CreateEmailImageUploadRequest,
  EmailImage,
  MessageSignature,
  SaveMessageSignatureRequest,
} from './email.js';
import { ConfirmUploadRequest, UploadPutTicket, UploadTicket } from '../documents/schemas.js';
import { OkResponse } from '../schemas.js';

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
    /** The signed-in member's saved email signature (leads/email.ts), and the firm's logo address. */
    signature: async (): Promise<MessageSignature> =>
      request(MessageSignature, '/business/me/message-signature'),
    /** Save (or replace) the member's signature. 400 SIGNATURE_TOO_LONG, SIGNATURE_EMPTY. */
    saveSignature: async (body: SaveMessageSignatureRequest): Promise<MessageSignature> =>
      request(MessageSignature, '/business/me/message-signature', {
        method: 'PUT',
        body: parseInput(SaveMessageSignatureRequest, body),
      }),
    /** Step 1 of an inline image: where to PUT it (apps/web/src/lib/upload.ts does the rest). */
    createEmailImageUpload: async (body: CreateEmailImageUploadRequest): Promise<UploadPutTicket> =>
      request(
        UploadPutTicket,
        `${LEADS}/messages/images`,
        post(parseInput(CreateEmailImageUploadRequest, body)),
      ),
    /** Step 3: the image is checked, then served at its public `url`. */
    confirmEmailImageUpload: async (body: ConfirmEmailImageUploadRequest): Promise<EmailImage> =>
      request(
        EmailImage,
        `${LEADS}/messages/images/confirm`,
        post(parseInput(ConfirmEmailImageUploadRequest, body)),
      ),

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

    /** L8: a lead's follow-up steps. Each answers the lead's profile, its Next Action updated. */
    addFollowUp: async (id: string, body: AddLeadFollowUpRequest): Promise<LeadProfile> =>
      request(LeadProfile, `${one(id)}/follow-ups`, post(parseInput(AddLeadFollowUpRequest, body))),
    updateFollowUp: async (
      id: string,
      followUpId: string,
      body: UpdateLeadFollowUpRequest,
    ): Promise<LeadProfile> =>
      request(LeadProfile, `${one(id)}/follow-ups/${parseInput(z.uuid(), followUpId)}`, {
        method: 'PATCH',
        body: parseInput(UpdateLeadFollowUpRequest, body),
      }),
    removeFollowUp: async (id: string, followUpId: string): Promise<LeadProfile> =>
      request(LeadProfile, `${one(id)}/follow-ups/${parseInput(z.uuid(), followUpId)}`, {
        method: 'DELETE',
      }),
    completeFollowUpStep: async (
      id: string,
      followUpId: string,
      body: CompleteLeadFollowUpRequest = {},
    ): Promise<LeadProfile> =>
      request(
        LeadProfile,
        `${one(id)}/follow-ups/${parseInput(z.uuid(), followUpId)}/complete`,
        post(parseInput(CompleteLeadFollowUpRequest, body)),
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
    /** R2 15: the possible duplicates the member reaches, with why. */
    duplicates: async (): Promise<LeadDuplicateList> =>
      request(LeadDuplicateList, `${LEADS}/duplicates`),
    /** R2 15: "Not a duplicate" (Owner, Admin). */
    dismissDuplicate: async (body: DismissLeadDuplicateRequest): Promise<OkResponse> =>
      request(
        OkResponse,
        `${LEADS}/duplicates/dismiss`,
        post(parseInput(DismissLeadDuplicateRequest, body)),
      ),
    /** R2 15: merge `mergeLeadId` into lead `id`, keeping the chosen values (Owner, Admin). */
    merge: async (id: string, body: MergeLeadsRequest): Promise<LeadProfile> =>
      request(LeadProfile, `${one(id)}/merge`, post(parseInput(MergeLeadsRequest, body))),
    /** R2 2: Create Task opened from the lead. */
    createTask: async (id: string, body: CreateLeadTaskRequest): Promise<LeadTask> =>
      request(LeadTask, `${one(id)}/tasks`, post(parseInput(CreateLeadTaskRequest, body))),
    /** R2 2: the lead's task done, or open again. */
    updateTask: async (
      id: string,
      taskId: string,
      body: UpdateLeadTaskRequest,
    ): Promise<LeadTask> =>
      request(LeadTask, `${one(id)}/tasks/${parseInput(z.uuid(), taskId)}`, {
        method: 'PATCH',
        body: parseInput(UpdateLeadTaskRequest, body),
      }),
    appointments: async (id: string): Promise<LeadAppointment[]> =>
      (await request(LeadAppointmentList, `${one(id)}/appointments`)).items,
    documentsAndForms: async (id: string): Promise<LeadDocumentsAndForms> =>
      request(LeadDocumentsAndForms, `${one(id)}/documents-and-forms`),
    /** R2 4: step 1 of adding a file to the lead (then the browser's PUT, then `confirmFile`). */
    createFile: async (id: string, body: CreateLeadFileRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${one(id)}/files`, post(parseInput(CreateLeadFileRequest, body))),
    confirmFile: async (id: string, body: ConfirmUploadRequest): Promise<LeadDocument> =>
      request(
        LeadDocument,
        `${one(id)}/files/confirm`,
        post(parseInput(ConfirmUploadRequest, body)),
      ),
    /** A file staff added, until the lead is converted. */
    removeFile: async (id: string, fileId: string): Promise<OkResponse> =>
      request(OkResponse, `${one(id)}/files/${parseInput(z.uuid(), fileId)}`, { method: 'DELETE' }),

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
    /** Convert to Client from the bulk bar: each lead converted or skipped with the reason. */
    bulkConvert: async (body: BulkConvertLeadsRequest): Promise<BulkConvertLeadsResult> =>
      request(
        BulkConvertLeadsResult,
        '/business/leads/bulk-convert',
        post(parseInput(BulkConvertLeadsRequest, body)),
      ),
  };
}
export type LeadPipelineClient = ReturnType<typeof createLeadPipelineClient>;
