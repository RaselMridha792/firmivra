import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { clearable, text } from '../clients/text.js';
import { portalMe } from '../clients/client.js';
import {
  BookkeepingBillingFrequency,
  BookkeepingBillingTiming,
  BookkeepingPaymentTerms,
  BookkeepingRenewalType,
} from '../db-enums.js';
import { OkResponse } from '../schemas.js';
import {
  BookkeepingTermsId,
  TermsAddOn,
  TermsAdditionalBilling,
  TermsDeliverable,
  TermsLateFeeRule,
} from './terms.js';

// Client Portal BK-CP3 (R55): the bookkeeping terms the firm sent, in the client's portal, under
// My Services. Routes /api/v1/portal/{firmSlug}/me/bookkeeping-terms; the client comes from the
// session, never the URL. The client sees every version that left the firm's drafts (sent, in
// force, replaced or ended), never a draft (404), and only the portal version: no internal
// notes, no discount reasons, no termination reason, no History, no names of staff. A household
// login (Primary or Spouse) reads; an Authorized login sees nothing (404). The Primary login
// answers a version waiting for them: Accept puts it in force (the one before is replaced, as the
// firm's Activate does), Decline sends it back to the firm as a draft. Every read and answer is
// audited; each answer tells the firm (a bell item that opens the client's Terms page).

const CalendarDate = z.iso.date();
const DateTime = z.iso.datetime({ offset: true });

/** Where a version stands, in the client's words. */
export const MyBookkeepingTermsState = z.enum([
  /** Sent to the client: Accept or Decline. */
  'AWAITING_ANSWER',
  /** The terms in force. */
  'IN_FORCE',
  /** Replaced by a newer version. */
  'REPLACED',
  /** Terminated or not renewed. */
  'ENDED',
]);
export type MyBookkeepingTermsState = z.infer<typeof MyBookkeepingTermsState>;

export const MY_BOOKKEEPING_TERMS_STATE_LABELS: Record<MyBookkeepingTermsState, string> = {
  AWAITING_ANSWER: 'Waiting for your answer',
  IN_FORCE: 'In force',
  REPLACED: 'Replaced by a newer version',
  ENDED: 'Ended',
};

/**
 * The e-signature the firm linked to these terms (Firm Sign), once it left the firm: WAITING
 * while it waits for signatures (sign it under Signatures; Accept waits for it), SIGNED once
 * complete, CLOSED when declined, expired or voided.
 */
export const MyBookkeepingTermsSignature = z.enum(['WAITING', 'SIGNED', 'CLOSED']);
export type MyBookkeepingTermsSignature = z.infer<typeof MyBookkeepingTermsSignature>;

/** One version in the list. */
export const MyBookkeepingTermsRow = z.object({
  id: BookkeepingTermsId,
  /** The bookkeeping service (My Services' id) these terms are for. */
  serviceId: z.uuid(),
  serviceTitle: z.string(),
  version: z.number().int().min(1),
  state: MyBookkeepingTermsState,
  packageName: z.string().nullable(),
  monthlyFeeCents: z.number().int(),
  effectiveFrom: CalendarDate,
  /** When the firm sent this version (null: put in force without sending). */
  sentAt: DateTime.nullable(),
  activatedAt: DateTime.nullable(),
});
export type MyBookkeepingTermsRow = z.infer<typeof MyBookkeepingTermsRow>;

/** GET .../bookkeeping-terms: every version the client may see, newest first per service. */
export const MyBookkeepingTermsList = z.object({ items: z.array(MyBookkeepingTermsRow) });
export type MyBookkeepingTermsList = z.infer<typeof MyBookkeepingTermsList>;

/** A discount or credit as the client reads it: never the firm's reason for it. */
export const MyTermsDiscount = z.object({
  label: z.string(),
  kind: z.enum(['AMOUNT', 'PERCENT']),
  value: z.number().int(),
  startsOn: CalendarDate.nullable(),
  endsOn: CalendarDate.nullable(),
});
export type MyTermsDiscount = z.infer<typeof MyTermsDiscount>;

/** GET .../bookkeeping-terms/{termsId}: the portal version of one version of the terms. */
export const MyBookkeepingTerms = MyBookkeepingTermsRow.extend({
  startDate: CalendarDate,
  endDate: CalendarDate.nullable(),
  renewalType: BookkeepingRenewalType,
  renewalDate: CalendarDate.nullable(),
  noticeDays: z.number().int().nullable(),
  billingFrequency: BookkeepingBillingFrequency,
  billingTiming: BookkeepingBillingTiming,
  paymentTerms: BookkeepingPaymentTerms,
  paymentTermsDays: z.number().int().nullable(),
  preferredPaymentMethod: z.string().nullable(),
  autopay: z.boolean(),
  setupFeeCents: z.number().int(),
  additionalBilling: z.array(TermsAdditionalBilling),
  lateFeeRule: TermsLateFeeRule.nullable(),
  discounts: z.array(MyTermsDiscount),
  includedServices: z.array(z.string()),
  excludedServices: z.array(z.string()),
  addOns: z.array(TermsAddOn),
  deliverables: z.array(TermsDeliverable),
  clientResponsibilities: z.array(z.string()),
  firmResponsibilities: z.array(z.string()),
  supersededAt: DateTime.nullable(),
  terminatedAt: DateTime.nullable(),
  /** When the client accepted this version in the portal; null otherwise. */
  acceptedAt: DateTime.nullable(),
  /** The linked e-signature's state, once sent; null when none. */
  signature: MyBookkeepingTermsSignature.nullable(),
  /** What this login may do now: the Primary login, on a version waiting for its answer. */
  can: z.object({ accept: z.boolean(), decline: z.boolean() }),
});
export type MyBookkeepingTerms = z.infer<typeof MyBookkeepingTerms>;

/** Stable `error.code` values of the portal's answers (besides NOT_FOUND and FORBIDDEN). */
export const MyBookkeepingTermsErrorCode = z.enum([
  /** 409: this version is no longer waiting for an answer. */
  'TERMS_STATE',
  /** 409: the firm changed or sent the terms again since the client opened them: reload. */
  'TERMS_CHANGED',
  /** 409: Accept waits for the linked e-signature: sign it under Signatures first. */
  'SIGNATURE_PENDING',
]);
export type MyBookkeepingTermsErrorCode = z.infer<typeof MyBookkeepingTermsErrorCode>;

/**
 * POST .../bookkeeping-terms/{termsId}/accept: `sentAt` is the sending the client read; another
 * one (the firm took the terms back and sent them again) is 409 TERMS_CHANGED.
 */
export const AcceptMyBookkeepingTermsRequest = z.strictObject({ sentAt: DateTime });
export type AcceptMyBookkeepingTermsRequest = z.input<typeof AcceptMyBookkeepingTermsRequest>;

/** POST .../bookkeeping-terms/{termsId}/decline: as Accept, with an optional reason for the firm. */
export const DeclineMyBookkeepingTermsRequest = z.strictObject({
  sentAt: DateTime,
  reason: clearable(text(800, 'many')),
});
export type DeclineMyBookkeepingTermsRequest = z.input<typeof DeclineMyBookkeepingTermsRequest>;

const post = (body: unknown) => ({ method: 'POST', body });

/**
 * `api.myBookkeepingTerms(slug)`: the signed-in client's bookkeeping terms at this firm (portal).
 * Another client's or firm's version, or a draft, is 404; an answer from a Spouse login is 403.
 */
export function createMyBookkeepingTermsClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/bookkeeping-terms`;
  const one = (id: string) => `${base()}/${parseInput(BookkeepingTermsId, id)}`;
  return {
    list: async (): Promise<MyBookkeepingTermsRow[]> =>
      (await request(MyBookkeepingTermsList, base())).items,
    get: (id: string): Promise<MyBookkeepingTerms> => request(MyBookkeepingTerms, one(id)),
    accept: (id: string, body: AcceptMyBookkeepingTermsRequest): Promise<MyBookkeepingTerms> =>
      request(
        MyBookkeepingTerms,
        `${one(id)}/accept`,
        post(parseInput(AcceptMyBookkeepingTermsRequest, body)),
      ),
    decline: (id: string, body: DeclineMyBookkeepingTermsRequest): Promise<OkResponse> =>
      request(
        OkResponse,
        `${one(id)}/decline`,
        post(parseInput(DeclineMyBookkeepingTermsRequest, body)),
      ),
  };
}
export type MyBookkeepingTermsClient = ReturnType<typeof createMyBookkeepingTermsClient>;
