import { type ApiRequest, parseInput } from '../client.js';
import { IntakeKey } from '../intake/definition.js';
import {
  BeginDraft,
  BeginOnlineForm,
  BeginOnlineServiceList,
  BeginOnlineSlug,
  SaveDraftStepRequest,
  StartDraftRequest,
} from './schemas.js';
import { z } from 'zod';

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
  };
}

export type BeginOnlineClient = ReturnType<typeof createBeginOnlineClient>;
