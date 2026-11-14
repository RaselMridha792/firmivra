import { z } from 'zod';
import { IntakeAgreementBlock } from '../agreements/schemas.js';
import { ResumeToken } from '../begin-online/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';
import { IntakeStatus } from '../db-enums.js';
import { FirmSlug } from '../schemas.js';
import { IntakeAnswers } from './answers.js';
import { IntakeFormDefinition, IntakeFormKey, IntakeKey } from './definition.js';
import {
  IntakeFileSizeMb,
  IntakeUpload,
  refuseFullNumbers,
  SavedIntakeStep,
  SaveIntakeStepRequest,
  SubmitIntakeRequest,
} from './schemas.js';

// A lead's secure intake link (Intake Forms Review Two, INTAKE-ACCESS-01; Leads R2 3). The firm
// emails the lead a link with a random token in its fragment (only its SHA-256 is kept). The page
// trades the token for an HttpOnly cookie on this firm's link routes, then fills, saves and
// submits the one form the link was sent for. No portal sign-in. The link opens again until the
// form expires; a resend or a reminder sends a new link, which replaces it.

/** The link page's path on the portal: `/{firmSlug}/form#token=...`. */
export const INTAKE_LINK_PATH = 'form';

const DateTime = z.iso.datetime({ offset: true });

/**
 * POST /portal/{firmSlug}/intake-link/open: the token from the link's fragment (the resume link's
 * format: `resumeTokenFromHash` reads it).
 */
export const OpenIntakeLinkRequest = z.strictObject({ token: ResumeToken });
export type OpenIntakeLinkRequest = z.input<typeof OpenIntakeLinkRequest>;

/** The form the link opens, as the lead sees it (numbers as `{ last4 }`, never full). */
export const LinkIntake = z
  .object({
    id: z.uuid(),
    form: IntakeFormKey,
    title: z.string(),
    /** "Hi Pat": the lead's first name only. */
    firstName: z.string(),
    status: IntakeStatus,
    /** The answers' version (a correction starts the next one). */
    version: z.number().int().positive(),
    /** The firm's note when it asked for changes (NEEDS_CORRECTION). */
    correction: z.object({ note: z.string(), requestedAt: DateTime }).nullable(),
    dueOn: z.iso.date().nullable(),
    /** When the link stops working. */
    expiresAt: DateTime,
    definition: IntakeFormDefinition,
    taxYear: z.number().int(),
    answers: IntakeAnswers,
    uploads: z.array(IntakeUpload),
    maxFileSizeMb: IntakeFileSizeMb,
    savedSteps: z.array(z.string()).max(10),
    signature: z.object({ printedName: z.string(), signedAt: DateTime }).nullable(),
    /** True while the form is open (SENT, IN_PROGRESS, NEEDS_CORRECTION). */
    canEdit: z.boolean(),
  })
  .superRefine(refuseFullNumbers);
export type LinkIntake = z.infer<typeof LinkIntake>;

/** What a link's errors say (the codes its routes answer). */
export const INTAKE_LINK_ERRORS = {
  LINK_INVALID: 'This link is not valid or has expired. Ask your firm to send a new one.',
  INTAKE_LOCKED: 'This form was already sent, so it can no longer be changed.',
} as const;

/**
 * `api.intakeLink(firmSlug)`: the secure link's form for a lead (no sign-in). `open(token)` with
 * the link's #token; the rest use the cookie it sets. A link that is unknown, replaced or expired
 * (or a cookie from one) answers 410 LINK_INVALID; a sent form 409 INTAKE_LOCKED for changes.
 */
export function createIntakeLinkClient(request: ApiRequest, firmSlug: string) {
  const base = `/portal/${parseInput(FirmSlug, firmSlug)}/intake-link`;
  return {
    open: async (token: string): Promise<LinkIntake> =>
      request(LinkIntake, `${base}/open`, {
        method: 'POST',
        body: parseInput(OpenIntakeLinkRequest, { token }),
      }),
    get: async (): Promise<LinkIntake> => request(LinkIntake, base),
    saveStep: async (step: string, body: SaveIntakeStepRequest): Promise<SavedIntakeStep> =>
      request(SavedIntakeStep, `${base}/steps/${parseInput(IntakeKey, step)}`, {
        method: 'PUT',
        body: parseInput(SaveIntakeStepRequest, body),
      }),
    submit: async (body: SubmitIntakeRequest): Promise<LinkIntake> =>
      request(LinkIntake, `${base}/submit`, {
        method: 'POST',
        body: parseInput(SubmitIntakeRequest, body),
      }),
    /** The firm's agreements for this form's service, with its Terms and Privacy to accept. */
    agreements: async (): Promise<IntakeAgreementBlock> =>
      request(IntakeAgreementBlock, `${base}/agreements`),
  };
}
export type IntakeLinkClient = ReturnType<typeof createIntakeLinkClient>;
