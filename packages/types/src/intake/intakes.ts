import { z } from 'zod';
import { IntakeStatus, ScanStatus } from '../db-enums.js';
import { type ApiRequest, parseInput } from '../client.js';
import { CalendarDate, ClientId } from '../clients/schemas.js';
import { text } from '../clients/text.js';
import { EngagementId, ServiceRef } from '../engagements/schemas.js';
import { IntakeAnswers } from './answers.js';
import { IntakeFormDefinition } from './definition.js';
import { IntakeId, refuseFullNumbers } from './schemas.js';

// The firm's side of portal intake forms (R11 step 5): a client's intakes, sending one, review,
// Needs Correction and unlock. An intake is one form, for one of the client's engagements; its
// answers are versioned. Owner and Admin can ask for changes (Needs Correction, with a note) or
// unlock it: both start the next version from the last answers, to be signed again.
// The client's side is contract B (schemas.ts and client.ts, `api.myIntakes(slug)`).
// Firm routes: /api/v1/business/... (Staff: their own clients only; others are 404).
// SSN and EIN answers always come back as `{ last4 }`.

const DateTime = z.iso.datetime({ offset: true });

/**
 * A file the client uploaded into one of the form's upload slots, as the firm's IntakeView carries
 * it (the portal's shape is contract B's IntakeUpload in schemas.ts).
 */
export const IntakeFile = z.object({
  documentId: z.uuid(),
  slot: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  scanStatus: ScanStatus,
  createdAt: DateTime,
});
export type IntakeFile = z.infer<typeof IntakeFile>;

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

/** One intake with its form and answers, as the firm reviews it (a full SSN or EIN fails to parse). */
export const IntakeView = IntakeSummary.extend({
  definition: IntakeFormDefinition,
  answers: IntakeAnswers,
  /** The steps saved at least once in this version: the stepper's ticks. */
  savedSteps: z.array(z.string()),
  /** False while the client can change the answers (SENT, IN_PROGRESS, NEEDS_CORRECTION). */
  locked: z.boolean(),
  uploads: z.array(IntakeFile),
}).superRefine(refuseFullNumbers);
export type IntakeView = z.infer<typeof IntakeView>;

export const IntakeList = z.object({ items: z.array(IntakeSummary).max(200) });
export type IntakeList = z.infer<typeof IntakeList>;

/** POST /business/engagements/{id}/intakes: send the client the service's intake form. */
export const SendIntakeRequest = z.strictObject({ dueOn: CalendarDate.optional() });
export type SendIntakeRequest = z.input<typeof SendIntakeRequest>;

/** POST /business/intakes/{id}/request-correction (Owner and Admin): what to change. */
export const RequestIntakeCorrectionRequest = z.strictObject({ note: text(2000, 'many') });
export type RequestIntakeCorrectionRequest = z.input<typeof RequestIntakeCorrectionRequest>;

/**
 * `api.intakes` (apps/web/src/lib/api.ts): the firm's side. Owner, Admin and Staff (Staff: their
 * own clients); corrections and unlocking: Owner and Admin (403 FORBIDDEN for Staff).
 */
export function createIntakesClient(request: ApiRequest) {
  const one = (id: string) => `/business/intakes/${parseInput(IntakeId, id)}`;
  return {
    listForClient: async (clientId: string): Promise<IntakeSummary[]> =>
      (await request(IntakeList, `/business/clients/${parseInput(ClientId, clientId)}/intakes`))
        .items,
    /** 409 ENGAGEMENT_NOT_ACTIVE, NO_INTAKE_FORM, INTAKE_OPEN. */
    send: async (engagementId: string, body: SendIntakeRequest = {}): Promise<IntakeView> =>
      request(
        IntakeView,
        `/business/engagements/${parseInput(EngagementId, engagementId)}/intakes`,
        {
          method: 'POST',
          body: parseInput(SendIntakeRequest, body),
        },
      ),
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

export type IntakesClient = ReturnType<typeof createIntakesClient>;
