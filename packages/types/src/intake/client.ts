import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import { ConfirmUploadRequest, UploadTicket } from '../documents/schemas.js';
import { OkResponse } from '../schemas.js';
import { IntakeKey } from './definition.js';
import {
  CreateIntakeUploadRequest,
  IntakeId,
  IntakeUpload,
  IntakeUploadId,
  MyIntake,
  type MyIntakeListItem,
  MyIntakeList,
  SavedIntakeStep,
  SaveIntakeStepRequest,
  SubmitIntakeRequest,
} from './schemas.js';

/**
 * `api.myIntakes(firmSlug)` (apps/web/src/lib/api.ts): the signed-in client's Intake Forms tab.
 * Changes are for the primary login (403 FORBIDDEN otherwise) while the intake is SENT,
 * IN_PROGRESS or NEEDS_CORRECTION (409 INTAKE_LOCKED otherwise, 410 INTAKE_EXPIRED). Upload a
 * slot's file with `uploadFile()` (apps/web/src/lib/upload.ts):
 *   uploadFile(file, {
 *     start: (facts) => api.myIntakes(slug).createUpload(id, { slot, ...facts }),
 *     finish: (uploadToken) => api.myIntakes(slug).confirmUpload(id, { uploadToken }),
 *   })
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createMyIntakesClient(request: ApiRequest, firmSlug: string) {
  const one = (id: string) => `${portalMe(firmSlug)}/intakes/${parseInput(IntakeId, id)}`;
  return {
    /** Open ones first (by due date), then the newest. */
    list: async (): Promise<MyIntakeListItem[]> =>
      (await request(MyIntakeList, `${portalMe(firmSlug)}/intakes`)).items,
    /** The form, its answers (SSNs and EINs as `{ last4 }`), its files and what the login may do. */
    get: async (id: string): Promise<MyIntake> => request(MyIntake, one(id)),
    /**
     * Autosave: replaces one step's answers (types and limits checked; nothing required yet). A
     * SENT intake becomes IN_PROGRESS. 400 VALIDATION_FAILED for answers that don't fit the form.
     */
    saveStep: async (
      id: string,
      step: string,
      body: SaveIntakeStepRequest,
    ): Promise<SavedIntakeStep> =>
      request(SavedIntakeStep, `${one(id)}/steps/${parseInput(IntakeKey, step)}`, {
        method: 'PUT',
        body: parseInput(SaveIntakeStepRequest, body),
      }),
    /**
     * Signs and submits: the version is locked and the intake is SUBMITTED (the firm is told).
     * 400 VALIDATION_FAILED when the form is not complete (`checkIntakeAnswers` shows where);
     * then the agreement codes (IntakeAgreementErrorCode: NO_INTAKE_AGREEMENT, AGREEMENT_OUTDATED,
     * ACKNOWLEDGMENT_REQUIRED, SIGNATURE_MISMATCH, PDF_REQUIRED).
     */
    submit: async (id: string, body: SubmitIntakeRequest): Promise<MyIntake> =>
      request(MyIntake, `${one(id)}/submit`, {
        method: 'POST',
        body: parseInput(SubmitIntakeRequest, body),
      }),
    /** Step 1 of a slot's upload. 409 TOO_MANY_FILES or NO_OPEN_SERVICE. */
    createUpload: async (id: string, body: CreateIntakeUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${one(id)}/uploads`, {
        method: 'POST',
        body: parseInput(CreateIntakeUploadRequest, body),
      }),
    /**
     * Step 3: the file is saved to the client's documents for the intake's service and put in
     * its slot. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS;
     * 409 TOO_MANY_FILES when files confirmed since step 1 filled the slot or the form.
     */
    confirmUpload: async (id: string, body: ConfirmUploadRequest): Promise<IntakeUpload> =>
      request(IntakeUpload, `${one(id)}/uploads/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /** Takes a file out of its slot ("Replace"); the document stays in My Documents. */
    removeUpload: async (id: string, uploadId: string): Promise<OkResponse> =>
      request(OkResponse, `${one(id)}/uploads/${parseInput(IntakeUploadId, uploadId)}`, {
        method: 'DELETE',
      }),
  };
}

export type MyIntakesClient = ReturnType<typeof createMyIntakesClient>;
