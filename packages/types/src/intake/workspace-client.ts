import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import { IntakeView, RequestIntakeCorrectionRequest } from './intakes.js';
import { IntakeId } from './schemas.js';
import {
  AddFormNoteRequest,
  AssignedFormPage,
  AssignedFormRecord,
  AssignedFormsQuery,
  FormFileLink,
  FormNote,
  IntakeDashboardSummary,
  IntakeFormDetail,
  IntakeFormId,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeFormsQuery,
  IntakeSettings,
  IntakeSettingsChangeList,
  ResetIntakeSettingsRequest,
  SaveIntakeFormRequest,
  SaveSendDraftRequest,
  SendDraft,
  SendIntakeFormRequest,
  SendIntakeFormResult,
  UpdateAssignedFormRequest,
  UpdateIntakeSettingsRequest,
} from './workspace.js';

const INTAKES = '/business/intakes';
const FORMS = '/business/intake-forms';
const SETTINGS = '/business/intake-settings';
const intake = (id: string) => `${INTAKES}/${parseInput(IntakeId, id)}`;
const form = (id: string) => `${FORMS}/${parseInput(IntakeFormId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

const SendDraftList = z.object({ items: z.array(SendDraft) });

/**
 * `api.intakeForms` (apps/web/src/lib/api.ts): the Intake Forms workspace. Owner, Admin and
 * Staff with the grid's INTAKE_FORMS capabilities (Staff: their own clients and leads); the
 * builder, templates and settings need Manage. Bad input rejects with ApiRequestError(400,
 * 'VALIDATION_FAILED') before anything is sent. No business id is ever sent.
 */
export function createIntakeFormsClient(request: ApiRequest) {
  return {
    // Dashboard
    summary: async (): Promise<IntakeDashboardSummary> =>
      request(IntakeDashboardSummary, `${INTAKES}/summary`),
    list: async (query: AssignedFormsQuery = {}): Promise<AssignedFormPage> =>
      request(AssignedFormPage, `${INTAKES}${toQuery(parseInput(AssignedFormsQuery, query))}`),

    // Send Intake Form
    /** Send Form. 409 FORM_ALREADY_OPEN, PORTAL_UNAVAILABLE; 400 SMS_UNAVAILABLE. Retry-safe. */
    send: async (body: SendIntakeFormRequest): Promise<SendIntakeFormResult> =>
      request(
        SendIntakeFormResult,
        `${INTAKES}/send`,
        post(parseInput(SendIntakeFormRequest, body)),
      ),
    sendDrafts: async (): Promise<SendDraft[]> =>
      (await request(SendDraftList, `${INTAKES}/send-drafts`)).items,
    saveSendDraft: async (body: SaveSendDraftRequest, draftId?: string): Promise<SendDraft> =>
      request(
        SendDraft,
        draftId
          ? `${INTAKES}/send-drafts/${parseInput(z.uuid(), draftId)}`
          : `${INTAKES}/send-drafts`,
        { method: draftId ? 'PUT' : 'POST', body: parseInput(SaveSendDraftRequest, body) },
      ),

    // One assigned form (detail / submission review)
    record: async (id: string): Promise<AssignedFormRecord> =>
      request(AssignedFormRecord, `${intake(id)}/record`),
    /** The answers by the form's sections: R11's GET /business/intakes/{id}. */
    responses: async (id: string): Promise<IntakeView> => request(IntakeView, intake(id)),
    addNote: async (id: string, body: AddFormNoteRequest): Promise<FormNote> =>
      request(FormNote, `${intake(id)}/notes`, post(parseInput(AddFormNoteRequest, body))),
    /** Assign staff, change the due date, extend the expiration (row More menu). */
    update: async (id: string, body: UpdateAssignedFormRequest): Promise<AssignedFormRecord> =>
      request(AssignedFormRecord, intake(id), {
        method: 'PATCH',
        body: parseInput(UpdateAssignedFormRequest, body),
      }),
    /** Resend the same form (never a second record). */
    resend: async (id: string): Promise<AssignedFormRecord> =>
      request(AssignedFormRecord, `${intake(id)}/resend`, post()),
    /** A reminder now; not for a submitted or completed form (409 INVALID_STATUS). */
    remind: async (id: string): Promise<AssignedFormRecord> =>
      request(AssignedFormRecord, `${intake(id)}/remind`, post()),
    /** Mark Reviewed: R11's complete (SUBMITTED or UNDER_REVIEW to COMPLETED). */
    markReviewed: async (id: string): Promise<IntakeView> =>
      request(IntakeView, `${intake(id)}/complete`, post({})),
    /** Request Revision: R11's request-correction (Owner and Admin). */
    requestRevision: async (
      id: string,
      body: RequestIntakeCorrectionRequest,
    ): Promise<IntakeView> =>
      request(
        IntakeView,
        `${intake(id)}/request-correction`,
        post(parseInput(RequestIntakeCorrectionRequest, body)),
      ),
    archive: async (id: string): Promise<AssignedFormRecord> =>
      request(AssignedFormRecord, `${intake(id)}/archive`, post()),
    /** Export PDF: a short-lived link to the submission as a PDF. */
    exportPdf: async (id: string): Promise<FormFileLink> =>
      request(FormFileLink, `${intake(id)}/pdf`),

    // Forms and templates (builder, library)
    forms: async (query: IntakeFormsQuery = {}): Promise<IntakeFormList['items']> =>
      (await request(IntakeFormList, `${FORMS}${toQuery(parseInput(IntakeFormsQuery, query))}`))
        .items,
    librarySummary: async (): Promise<IntakeFormLibrarySummary> =>
      request(IntakeFormLibrarySummary, `${FORMS}/summary`),
    form: async (id: string): Promise<IntakeFormDetail> => request(IntakeFormDetail, form(id)),
    /** Save as Draft for a new form or template. */
    createForm: async (body: SaveIntakeFormRequest): Promise<IntakeFormDetail> =>
      request(IntakeFormDetail, FORMS, post(parseInput(SaveIntakeFormRequest, body))),
    /** Save the draft. 409 FORM_PUBLISHED for a published version. */
    saveForm: async (id: string, body: SaveIntakeFormRequest): Promise<IntakeFormDetail> =>
      request(IntakeFormDetail, form(id), {
        method: 'PUT',
        body: parseInput(SaveIntakeFormRequest, body),
      }),
    /** Publish Form: usable for sending, frozen as a version. 400 FORM_INCOMPLETE. */
    publishForm: async (id: string): Promise<IntakeFormDetail> =>
      request(IntakeFormDetail, `${form(id)}/publish`, post()),
    /** A draft copy with a new id (Duplicate; "Save as Template" with `asTemplate`). */
    duplicateForm: async (id: string, asTemplate = false): Promise<IntakeFormDetail> =>
      request(IntakeFormDetail, `${form(id)}/duplicate`, post({ asTemplate })),
    archiveForm: async (id: string): Promise<IntakeFormDetail> =>
      request(IntakeFormDetail, `${form(id)}/archive`, post()),

    // Settings
    settings: async (): Promise<IntakeSettings> => request(IntakeSettings, SETTINGS),
    updateSettings: async (body: UpdateIntakeSettingsRequest): Promise<IntakeSettings> =>
      request(IntakeSettings, SETTINGS, {
        method: 'PUT',
        body: parseInput(UpdateIntakeSettingsRequest, body),
      }),
    resetSettings: async (body: ResetIntakeSettingsRequest): Promise<IntakeSettings> =>
      request(
        IntakeSettings,
        `${SETTINGS}/reset`,
        post(parseInput(ResetIntakeSettingsRequest, body)),
      ),
    /** Test Reminder Email: to the signed-in member only; no recipient is touched. */
    testReminder: async (): Promise<OkResponse> =>
      request(OkResponse, `${SETTINGS}/test-reminder`, post()),
    settingsChanges: async (): Promise<IntakeSettingsChangeList['items']> =>
      (await request(IntakeSettingsChangeList, `${SETTINGS}/changes`)).items,
  };
}
export type IntakeFormsClient = ReturnType<typeof createIntakeFormsClient>;
