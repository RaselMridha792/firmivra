import { z } from 'zod';
import { IntakeStatus, ScanStatus } from '../db-enums.js';
import { type ApiRequest, parseInput } from '../client.js';
import { CalendarDate } from '../clients/schemas.js';
import {
  ConfirmUploadRequest,
  CreateMyUploadRequest,
  fileNameFitsType,
  UPLOAD_LIMITS,
  UploadTicket,
} from '../documents/index.js';
import { text } from '../clients/text.js';
import { ServiceRef } from '../engagements/schemas.js';
import { IntakeAnswers, IntakeAnswersInput } from './answers.js';
import { IntakeFormDefinition, IntakeKey } from './definition.js';

// Portal intake forms (R11 step 5) and the firm's side of them. An intake is one form, for one of
// the client's engagements; its answers are versioned. The client fills the current version
// (autosave per step) and submits it with the firm's agreements signed; a submitted version is
// locked. The firm can ask for changes (Needs Correction, with a note) or unlock it (Owner and
// Admin): both start the next version from the last answers, to be signed again.
// Portal routes: /api/v1/portal/{firmSlug}/me/intakes (the client from the session, never the
// URL). Firm routes: /api/v1/business/... (Staff: their own clients only; others are 404).
// SSN and EIN answers always come back as `{ last4 }`.

const DateTime = z.iso.datetime({ offset: true });

export const IntakeId = z.uuid();

/** A file the client uploaded into one of the form's upload slots. */
export const IntakeUpload = z.object({
  documentId: z.uuid(),
  slot: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  scanStatus: ScanStatus,
  createdAt: DateTime,
});
export type IntakeUpload = z.infer<typeof IntakeUpload>;

/** One intake in a list. */
export const IntakeSummary = z.object({
  id: z.uuid(),
  status: IntakeStatus,
  service: ServiceRef,
  engagement: z.object({ id: z.uuid(), title: z.string(), taxYear: z.number().int().nullable() }),
  formVersion: z.number().int(),
  /** The answers' current version: 1, then one more for each correction or unlock. */
  version: z.number().int(),
  dueOn: CalendarDate.nullable(),
  /** The firm's note while NEEDS_CORRECTION; null otherwise. */
  correctionNote: z.string().nullable(),
  correctionRequestedAt: DateTime.nullable(),
  /** When the last submitted version was sent, if any. */
  submittedAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type IntakeSummary = z.infer<typeof IntakeSummary>;

/** One intake with its form and answers, to fill (portal) or review (firm). */
export const IntakeView = IntakeSummary.extend({
  definition: IntakeFormDefinition,
  answers: IntakeAnswers,
  /** The steps saved at least once in this version: the stepper's ticks. */
  savedSteps: z.array(z.string()),
  /** False while the client can change the answers (SENT, IN_PROGRESS, NEEDS_CORRECTION). */
  locked: z.boolean(),
  uploads: z.array(IntakeUpload),
});
export type IntakeView = z.infer<typeof IntakeView>;

export const IntakeList = z.object({ items: z.array(IntakeSummary).max(200) });
export type IntakeList = z.infer<typeof IntakeList>;

/** One of the client's ACTIVE engagements whose service has an intake form, and its intake. */
export const IntakeChoice = z.object({
  engagement: z.object({ id: z.uuid(), title: z.string(), taxYear: z.number().int().nullable() }),
  service: ServiceRef,
  /** The newest intake for this engagement, if one was started or sent. */
  intake: IntakeSummary.nullable(),
});
export type IntakeChoice = z.infer<typeof IntakeChoice>;
export const IntakeChoiceList = z.object({ items: z.array(IntakeChoice).max(200) });
export type IntakeChoiceList = z.infer<typeof IntakeChoiceList>;

/** POST /portal/{firmSlug}/me/intakes: start (or open the open) intake of an engagement. */
export const StartIntakeRequest = z.strictObject({ engagementId: z.uuid() });
export type StartIntakeRequest = z.input<typeof StartIntakeRequest>;

/** PUT .../intakes/{id}/steps/{stepKey}: that step's answers (autosave). */
export const SaveIntakeStepRequest = z.strictObject({ answers: IntakeAnswersInput });
export type SaveIntakeStepRequest = z.input<typeof SaveIntakeStepRequest>;

/** POST /business/engagements/{id}/intakes: send the client the service's intake form. */
export const SendIntakeRequest = z.strictObject({ dueOn: CalendarDate.optional() });
export type SendIntakeRequest = z.input<typeof SendIntakeRequest>;

/** POST /business/intakes/{id}/request-correction (Owner and Admin): what to change. */
export const RequestIntakeCorrectionRequest = z.strictObject({ note: text(2000, 'many') });
export type RequestIntakeCorrectionRequest = z.input<typeof RequestIntakeCorrectionRequest>;

const { fileName, contentType, sizeBytes, sha256 } = CreateMyUploadRequest.shape;

/**
 * POST .../intakes/{id}/uploads: a file for one of the form's upload slots, while the intake is
 * open (PDF, JPG, PNG, .xlsx or .docx, at most 10 MB). PUT it to the ticket's URL, then
 * `confirmUpload`. The file becomes one of the client's documents of that service.
 */
export const CreateIntakeUploadRequest = z
  .strictObject({ slot: IntakeKey, fileName, contentType, sizeBytes, sha256 })
  .superRefine((body, ctx) => {
    if (!fileNameFitsType(body.fileName, body.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileName'],
        message: `The file name must end in ${UPLOAD_LIMITS.types[body.contentType].join(' or ')}`,
      });
    }
  });
export type CreateIntakeUploadRequest = z.input<typeof CreateIntakeUploadRequest>;

export const IntakeErrorCode = z.enum([
  'NOT_FOUND',
  'VALIDATION_FAILED',
  /** The intake is not open for changes (submitted, under review, completed). */
  'INTAKE_LOCKED',
  /** The action needs another status (e.g. a correction of an intake that was never submitted). */
  'INVALID_STATUS',
  /** The engagement is not ACTIVE. */
  'ENGAGEMENT_NOT_ACTIVE',
  /** The engagement's service has no intake form (e.g. OTHER). */
  'NO_INTAKE_FORM',
  /** An intake of this engagement is still open: finish or correct that one. */
  'INTAKE_OPEN',
  'ENCRYPTION_UNAVAILABLE',
  /** A save or an upload landed while the form was being sent: review it and send again. */
  'INTAKE_CHANGED',
  /** The slot (or the form) already has its most files: remove one first. */
  'TOO_MANY_FILES',
  /** Upload refusals as for documents: UPLOAD_EXPIRED, UPLOAD_MISMATCH, FILE_* ... */
]);
export type IntakeErrorCode = z.infer<typeof IntakeErrorCode>;

const step = (key: string) => parseInput(IntakeKey, key);

/**
 * `api.myIntakes(slug)` (apps/web/src/lib/api.ts): the signed-in client's intake forms at this
 * firm. Another client's or another firm's intake is 404. A save checks the answers like
 * `checkIntakeAnswers(definition, answers, { mode: 'save', step })` and answers 400
 * VALIDATION_FAILED with `details.issues`.
 */
export function createMyIntakesClient(request: ApiRequest, firmSlug: string) {
  const base = `/portal/${encodeURIComponent(firmSlug)}/me/intakes`;
  const one = (id: string) => `${base}/${parseInput(IntakeId, id)}`;
  return {
    list: async (): Promise<IntakeSummary[]> => (await request(IntakeList, base)).items,
    /** The cards of the intake tab: each ACTIVE engagement with a form, and its intake. */
    choices: async (): Promise<IntakeChoice[]> =>
      (await request(IntakeChoiceList, `${base}/choices`)).items,
    /** 409 ENGAGEMENT_NOT_ACTIVE, NO_INTAKE_FORM; an open intake comes back as it is. */
    start: async (body: StartIntakeRequest): Promise<IntakeView> =>
      request(IntakeView, base, { method: 'POST', body: parseInput(StartIntakeRequest, body) }),
    get: async (id: string): Promise<IntakeView> => request(IntakeView, one(id)),
    /** 409 INTAKE_LOCKED once submitted; 400 for a step key not in the form. */
    saveStep: async (id: string, stepKey: string, body: SaveIntakeStepRequest) =>
      request(IntakeView, `${one(id)}/steps/${step(stepKey)}`, {
        method: 'PUT',
        body: parseInput(SaveIntakeStepRequest, body),
      }),
    /** 409 INTAKE_LOCKED, TOO_MANY_FILES; 400 for a slot that is not an upload field. */
    createUpload: async (id: string, body: CreateIntakeUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${one(id)}/uploads`, {
        method: 'POST',
        body: parseInput(CreateIntakeUploadRequest, body),
      }),
    /** The intake with the new file in its slot. */
    confirmUpload: async (id: string, body: ConfirmUploadRequest): Promise<IntakeView> =>
      request(IntakeView, `${one(id)}/uploads/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /** Takes the file out of its slot (it stays one of the client's documents). */
    removeUpload: async (id: string, documentId: string): Promise<IntakeView> =>
      request(IntakeView, `${one(id)}/uploads/${parseInput(IntakeId, documentId)}`, {
        method: 'DELETE',
      }),
  };
}

/**
 * `api.intakes` (apps/web/src/lib/api.ts): the firm's side. Owner, Admin and Staff (Staff: their
 * own clients); corrections and unlocking: Owner and Admin (403 FORBIDDEN for Staff).
 */
export function createIntakesClient(request: ApiRequest) {
  const one = (id: string) => `/business/intakes/${parseInput(IntakeId, id)}`;
  return {
    listForClient: async (clientId: string): Promise<IntakeSummary[]> =>
      (await request(IntakeList, `/business/clients/${parseInput(IntakeId, clientId)}/intakes`))
        .items,
    /** 409 ENGAGEMENT_NOT_ACTIVE, NO_INTAKE_FORM, INTAKE_OPEN. */
    send: async (engagementId: string, body: SendIntakeRequest = {}): Promise<IntakeView> =>
      request(IntakeView, `/business/engagements/${parseInput(IntakeId, engagementId)}/intakes`, {
        method: 'POST',
        body: parseInput(SendIntakeRequest, body),
      }),
    get: async (id: string): Promise<IntakeView> => request(IntakeView, one(id)),
    /** SUBMITTED to UNDER_REVIEW. 409 INVALID_STATUS. */
    startReview: async (id: string): Promise<IntakeView> =>
      request(IntakeView, `${one(id)}/review`, { method: 'POST', body: {} }),
    /** SUBMITTED or UNDER_REVIEW to COMPLETED. 409 INVALID_STATUS. */
    complete: async (id: string): Promise<IntakeView> =>
      request(IntakeView, `${one(id)}/complete`, { method: 'POST', body: {} }),
    /** Owner and Admin. A submitted intake to NEEDS_CORRECTION, as a new version. */
    requestCorrection: async (id: string, body: RequestIntakeCorrectionRequest) =>
      request(IntakeView, `${one(id)}/request-correction`, {
        method: 'POST',
        body: parseInput(RequestIntakeCorrectionRequest, body),
      }),
    /** Owner and Admin. A submitted (or completed) intake back to IN_PROGRESS, as a new version. */
    unlock: async (id: string): Promise<IntakeView> =>
      request(IntakeView, `${one(id)}/unlock`, { method: 'POST', body: {} }),
  };
}

export type MyIntakesClient = ReturnType<typeof createMyIntakesClient>;
export type IntakesClient = ReturnType<typeof createIntakesClient>;
