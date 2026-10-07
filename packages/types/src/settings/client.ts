import { type ApiRequest, parseInput } from '../client.js';
import { LegalDocument, LegalKind } from '../client-auth/schemas.js';
import {
  FirmLegalOverview,
  FirmSettings,
  FirmSetup,
  LegalVersionNumber,
  PublishLegalDocumentRequest,
  SetupStep,
  UpdateFirmSettingsRequest,
} from './schemas.js';

const SETTINGS = '/business/settings';
const SETUP = '/business/setup';
const legal = (kind: LegalKind) => `/business/legal/${parseInput(LegalKind, kind)}`;

/**
 * `api.settings` (apps/web/src/lib/api.ts): the firm's settings, the setup wizard and its own
 * Terms and Privacy. Owner and Admin only (403 for staff); works while the firm is Pending
 * Setup. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createSettingsClient(request: ApiRequest) {
  return {
    get: async (): Promise<FirmSettings> => request(FirmSettings, SETTINGS),
    /** Changes only the fields sent; an empty text field clears that setting. */
    update: async (body: UpdateFirmSettingsRequest): Promise<FirmSettings> =>
      request(FirmSettings, SETTINGS, {
        method: 'PATCH',
        body: parseInput(UpdateFirmSettingsRequest, body),
      }),

    getSetup: async (): Promise<FirmSetup> => request(FirmSetup, SETUP),
    /** Marks a wizard step done (Next). Save Draft only calls `update`. Repeating is harmless. */
    completeStep: async (step: SetupStep): Promise<FirmSetup> =>
      request(FirmSetup, `${SETUP}/steps/${parseInput(SetupStep, step)}`, { method: 'PUT' }),
    /**
     * Finish: the firm becomes Active and its portal opens. 409 SETUP_INCOMPLETE until every
     * step is done. Repeating returns the first finish time.
     */
    finishSetup: async (): Promise<FirmSetup> =>
      request(FirmSetup, `${SETUP}/complete`, { method: 'POST' }),

    getLegal: async (kind: LegalKind): Promise<FirmLegalOverview> =>
      request(FirmLegalOverview, legal(kind)),
    /** An older version's text. 404 for a version that was never published. */
    getLegalVersion: async (kind: LegalKind, version: number): Promise<LegalDocument> =>
      request(LegalDocument, `${legal(kind)}/versions/${parseInput(LegalVersionNumber, version)}`),
    /** Publishes the next version; clients see it at once. Versions are never edited. */
    publishLegal: async (
      kind: LegalKind,
      body: PublishLegalDocumentRequest,
    ): Promise<LegalDocument> =>
      request(LegalDocument, `${legal(kind)}/versions`, {
        method: 'POST',
        body: parseInput(PublishLegalDocumentRequest, body),
      }),
  };
}

export type SettingsClient = ReturnType<typeof createSettingsClient>;
