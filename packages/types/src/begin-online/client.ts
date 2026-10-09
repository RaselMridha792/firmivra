import { type ApiRequest, parseInput } from '../client.js';
import { ConfirmUploadRequest, UploadTicket } from '../documents/schemas.js';
import { IntakeFormKey, IntakeKey } from '../intake/definition.js';
import {
  CreateIntakeUploadRequest,
  IntakeUpload,
  IntakeUploadId,
  IntakeUploadList,
  SavedIntakeStep,
  SaveIntakeStepRequest,
  SubmitIntakeRequest,
} from '../intake/schemas.js';
import { FirmSlug, OkResponse } from '../schemas.js';
import {
  BEGIN_ONLINE_SERVICES,
  BeginDraft,
  BeginOnlineForm,
  type BeginOnlineFormItem,
  BeginOnlineFormList,
  BeginReceived,
  BeginSubmitted,
  EmailResumeLinkRequest,
  ResumeBeginDraftRequest,
  StartBeginDraftRequest,
} from './schemas.js';

/**
 * `api.beginOnline(firmSlug)` (apps/web/src/lib/api.ts): Begin Online on the firm's portal site,
 * without an account. Functions take the service's form key (ANNUAL_TAX...). The draft is this
 * browser's (an HttpOnly cookie the API sets on `start` and `resume`). Upload a slot's file with
 * `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.beginOnline(slug).createUpload('ANNUAL_TAX', { slot, ...facts }),
 *     finish: (uploadToken) => api.beginOnline(slug).confirmUpload('ANNUAL_TAX', { uploadToken }),
 *   })
 * Every call can answer 429 RATE_LIMITED; a draft's calls 410 DRAFT_EXPIRED or 409
 * DRAFT_SUBMITTED. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent.
 */
export function createBeginOnlineClient(request: ApiRequest, firmSlug: string) {
  const base = () => `/portal/${parseInput(FirmSlug, firmSlug)}/begin`;
  const path = (form: string) => BEGIN_ONLINE_SERVICES[parseInput(IntakeFormKey, form)].path;
  const draft = (form: string) => `${base()}/${path(form)}/draft`;
  return {
    /** The services the firm offers online, in the page's order. */
    forms: async (): Promise<BeginOnlineFormItem[]> =>
      (await request(BeginOnlineFormList, `${base()}/forms`)).items,
    /** A service's form before a draft exists. 404 when the firm doesn't offer it online. */
    form: async (form: IntakeFormKey): Promise<BeginOnlineForm> =>
      request(BeginOnlineForm, `${base()}/forms/${path(form)}`),
    /** Starts this browser's draft for the service (replacing an earlier one here). */
    start: async (form: IntakeFormKey, body: StartBeginDraftRequest): Promise<BeginDraft> =>
      request(BeginDraft, draft(form), {
        method: 'POST',
        body: parseInput(StartBeginDraftRequest, body),
      }),
    /** This browser's draft for the service: 404 NOT_FOUND when there is none (show the form). */
    get: async (form: IntakeFormKey): Promise<BeginDraft> => request(BeginDraft, draft(form)),
    /** Autosave: replaces one step's answers (nothing is required until submit). */
    saveStep: async (
      form: IntakeFormKey,
      step: string,
      body: SaveIntakeStepRequest,
    ): Promise<SavedIntakeStep> =>
      request(SavedIntakeStep, `${draft(form)}/steps/${parseInput(IntakeKey, step)}`, {
        method: 'PUT',
        body: parseInput(SaveIntakeStepRequest, body),
      }),
    /** "Save and Continue Later": always `{ received: true }`. */
    emailResumeLink: async (body: EmailResumeLinkRequest): Promise<BeginReceived> =>
      request(BeginReceived, `${base()}/resume-link`, {
        method: 'POST',
        body: parseInput(EmailResumeLinkRequest, body),
      }),
    /** Opens a draft from its link's token (`resumeTokenFromHash`); its `form` names the page. */
    resume: async (body: ResumeBeginDraftRequest): Promise<BeginDraft> =>
      request(BeginDraft, `${base()}/resume`, {
        method: 'POST',
        body: parseInput(ResumeBeginDraftRequest, body),
      }),
    /** The draft's files, with their scan status. */
    uploads: async (form: IntakeFormKey): Promise<IntakeUpload[]> =>
      (await request(IntakeUploadList, `${draft(form)}/uploads`)).items,
    /** Step 1 of a slot's upload. 409 TOO_MANY_FILES. */
    createUpload: async (
      form: IntakeFormKey,
      body: CreateIntakeUploadRequest,
    ): Promise<UploadTicket> =>
      request(UploadTicket, `${draft(form)}/uploads`, {
        method: 'POST',
        body: parseInput(CreateIntakeUploadRequest, body),
      }),
    /** Step 3. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS. */
    confirmUpload: async (form: IntakeFormKey, body: ConfirmUploadRequest): Promise<IntakeUpload> =>
      request(IntakeUpload, `${draft(form)}/uploads/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /** Deletes a file of the draft ("Replace" is remove, then upload). */
    removeUpload: async (form: IntakeFormKey, uploadId: string): Promise<OkResponse> =>
      request(OkResponse, `${draft(form)}/uploads/${parseInput(IntakeUploadId, uploadId)}`, {
        method: 'DELETE',
      }),
    /**
     * Signs and submits; the firm gets the lead. 400 VALIDATION_FAILED when the form is not
     * complete (`checkIntakeAnswers` in submit mode shows where); then 409 TERMS_OUTDATED and the
     * agreement codes (IntakeAgreementErrorCode).
     */
    submit: async (form: IntakeFormKey, body: SubmitIntakeRequest): Promise<BeginSubmitted> =>
      request(BeginSubmitted, `${draft(form)}/submit`, {
        method: 'POST',
        body: parseInput(SubmitIntakeRequest, body),
      }),
  };
}

export type BeginOnlineClient = ReturnType<typeof createBeginOnlineClient>;
