import { type ApiRequest, parseInput } from '../client.js';
import { IntakeKey } from '../intake/definition.js';
import {
  BeginDraft,
  BeginOnlineForm,
  BeginOnlineServiceList,
  BeginOnlineSlug,
  CreateDraftUploadRequest,
  DraftSubmitted,
  DraftUpload,
  ResumeDraftRequest,
  ResumeLinkSent,
  SaveDraftStepRequest,
  StartDraftRequest,
  SubmitDraftRequest,
} from './schemas.js';
import { z } from 'zod';
import { OkResponse } from '../schemas.js';
import { ConfirmUploadRequest, UploadTicket } from '../documents/schemas.js';

/**
 * `api.beginOnline(firmSlug)`: Begin Online on a firm's portal site, signed out. Every call
 * answers 404 NOT_FOUND for a firm that is not ACTIVE (or no such slug). The draft calls use the
 * draft's HttpOnly cookie, which the browser sends by itself.
 */
export function createBeginOnlineClient(request: ApiRequest, firmSlug: string) {
  const base = () => `/portal/${parseInput(BeginOnlineSlug, firmSlug)}/begin-online`;
  const drafts = () => `${base()}/drafts`;
  return {
    /** The firm's Begin Online services, in the firm's order. 404 NOT_FOUND. */
    services: async () => (await request(BeginOnlineServiceList, `${base()}/services`)).items,
    /**
     * The definition a new draft of this service starts on (the newest published version).
     * 404 NOT_FOUND (no such Begin Online service at this firm).
     */
    form: async (serviceId: string) =>
      request(BeginOnlineForm, `${base()}/services/${parseInput(z.uuid(), serviceId)}/form`),
    /**
     * Starts a draft with the first step's answers (the contact included) and sets the draft
     * cookie. No account is created. 400 VALIDATION_FAILED (`details.issues`: not the first
     * step, a missing contact, a bad answer); 404 NOT_FOUND; 409 FORM_CHANGED; 429 RATE_LIMITED;
     * 503 ENCRYPTION_UNAVAILABLE.
     */
    startDraft: async (body: StartDraftRequest) =>
      request(BeginDraft, drafts(), {
        method: 'POST',
        body: parseInput(StartDraftRequest, body),
      }),
    /**
     * This browser's draft (from its cookie). 404 NOT_FOUND or DRAFT_NOT_FOUND; 410
     * DRAFT_EXPIRED.
     */
    current: async () => request(BeginDraft, `${drafts()}/current`),
    /**
     * Autosaves one step: its answers replace that step's (types and limits only, nothing
     * required). Renews the draft's 30 days. 400 VALIDATION_FAILED (`details.issues`: no such
     * step, a bad answer, a `{ last4 }` that does not match, on the first step a missing
     * contact); 404 NOT_FOUND or DRAFT_NOT_FOUND; 410 DRAFT_EXPIRED; 429 RATE_LIMITED; 503
     * ENCRYPTION_UNAVAILABLE.
     */
    saveStep: async (stepKey: string, body: SaveDraftStepRequest) =>
      request(BeginDraft, `${drafts()}/current/steps/${parseInput(IntakeKey, stepKey)}`, {
        method: 'PUT',
        body: parseInput(SaveDraftStepRequest, body),
      }),
    /**
     * Emails the draft's contact a link to continue on another device (the firm's branding, the
     * link only). The new link replaces the old one and this browser's cookie; the draft gets
     * its 30 days again. 404 NOT_FOUND or DRAFT_NOT_FOUND; 410 DRAFT_EXPIRED; 429 RATE_LIMITED
     * (5 a day per draft, and per IP); 503 SERVICE_UNAVAILABLE (the email did not go out: the
     * draft stays open in this browser, try again).
     */
    sendResumeLink: async () =>
      request(ResumeLinkSent, `${drafts()}/current/resume-link`, { method: 'POST', body: {} }),
    /**
     * The resume page: trades the link's token (`resumeTokenFromHash(location.hash)`) for this
     * browser's cookie and answers the draft. 410 RESUME_LINK_EXPIRED for any token that does
     * not open a live draft; 404 NOT_FOUND; 429 RATE_LIMITED.
     */
    resume: async (body: ResumeDraftRequest) =>
      request(BeginDraft, `${drafts()}/resume`, {
        method: 'POST',
        body: parseInput(ResumeDraftRequest, body),
      }),
    /**
     * Step 1 of an upload for a slot of the draft's form (then PUT, then `confirmUpload`; use
     * `uploadFile()`). 400 VALIDATION_FAILED (not an upload slot of the form, type, size); 404
     * NOT_FOUND or DRAFT_NOT_FOUND; 409 TOO_MANY_FILES; 410 DRAFT_EXPIRED; 429 RATE_LIMITED;
     * 503 SERVICE_UNAVAILABLE.
     */
    createUpload: async (body: CreateDraftUploadRequest) =>
      request(UploadTicket, `${drafts()}/current/uploads`, {
        method: 'POST',
        body: parseInput(CreateDraftUploadRequest, body),
      }),
    /**
     * Step 3: saves the file once the stored bytes are the described file. 404 DRAFT_NOT_FOUND;
     * 409 TOO_MANY_FILES, UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS; 410
     * UPLOAD_EXPIRED or DRAFT_EXPIRED; 503 SERVICE_UNAVAILABLE.
     */
    confirmUpload: async (body: ConfirmUploadRequest) =>
      request(DraftUpload, `${drafts()}/current/uploads/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /**
     * Sends the draft: the whole form is checked (every shown required answer and upload), files
     * in slots the answers hide are removed, the agreements are signed and the version is locked.
     * The firm gets a pending lead; the visitor a confirmation email. The cookie is cleared. 400
     * VALIDATION_FAILED (`details.issues`, or names that differ); 404 NOT_FOUND or
     * DRAFT_NOT_FOUND (also once sent); 409 INTAKE_CHANGED; 410 DRAFT_EXPIRED; 429 RATE_LIMITED;
     * 503 SIGNING_UNAVAILABLE or ENCRYPTION_UNAVAILABLE.
     */
    submit: async (body: SubmitDraftRequest) =>
      request(DraftSubmitted, `${drafts()}/current/submit`, {
        method: 'POST',
        body: parseInput(SubmitDraftRequest, body),
      }),
    /** Removes a file of the draft. 404 NOT_FOUND or DRAFT_NOT_FOUND; 410 DRAFT_EXPIRED. */
    deleteUpload: async (id: string) =>
      request(OkResponse, `${drafts()}/current/uploads/${parseInput(z.uuid(), id)}`, {
        method: 'DELETE',
      }),
  };
}

export type BeginOnlineClient = ReturnType<typeof createBeginOnlineClient>;
