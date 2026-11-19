import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import { CalendarDate } from '../clients/schemas.js';
import { TaxPlanId } from './schemas.js';

/**
 * P4-8 (Tax Planning Review 2, approved workflow: information requests and client approval): the
 * signed-in client's tax plans in the portal. A plan is listed once the firm sent it (for review
 * or delivered); it opens read-only at the exact version sent. The client approves that version,
 * or asks a question, requests a revision or requests a meeting: a request moves a plan waiting
 * on the client to Needs Review, and the plan's assigned staff get a bell item. The client never
 * sees the firm's screening, figures' notes or internal notes.
 */

const DateTime = z.iso.datetime({ offset: true });

/** Where the plan stands, as the client sees it. */
export const MyTaxPlanState = z.enum([
  /** Sent for the client's review: Approve, or ask. */
  'AWAITING_REVIEW',
  /** The client asked (a question, a revision or a meeting): the firm answers. */
  'REQUEST_WITH_FIRM',
  /** The client approved the version sent (the firm may now carry it out). */
  'APPROVED',
  /** The firm is preparing a new version. */
  'IN_PREPARATION',
  'CLOSED',
]);
export type MyTaxPlanState = z.infer<typeof MyTaxPlanState>;

export const MY_TAX_PLAN_STATE_LABELS: Record<MyTaxPlanState, string> = {
  AWAITING_REVIEW: 'Awaiting your review',
  REQUEST_WITH_FIRM: 'Your request is with the firm',
  APPROVED: 'Approved',
  IN_PREPARATION: 'The firm is preparing a new version',
  CLOSED: 'Closed',
};

/** What the client may ask from the portal. */
export const MyTaxPlanRequestKind = z.enum(['QUESTION', 'REVISION', 'MEETING']);
export type MyTaxPlanRequestKind = z.infer<typeof MyTaxPlanRequestKind>;

export const MY_TAX_PLAN_REQUEST_LABELS: Record<MyTaxPlanRequestKind, string> = {
  QUESTION: 'Question',
  REVISION: 'Revision request',
  MEETING: 'Meeting request',
};

export const MyTaxPlanRow = z.object({
  id: TaxPlanId,
  name: z.string(),
  planYear: z.number().int(),
  /** The version sent (the newest the client was sent or delivered). */
  version: z.number().int().min(1),
  sentAt: DateTime,
  state: MyTaxPlanState,
});
export type MyTaxPlanRow = z.infer<typeof MyTaxPlanRow>;

export const MyTaxPlanList = z.object({ items: z.array(MyTaxPlanRow) });
export type MyTaxPlanList = z.infer<typeof MyTaxPlanList>;

export const MyTaxPlan = MyTaxPlanRow.extend({
  /** What the plan recommends, as sent: each strategy and its estimated savings. */
  strategies: z.array(
    z.object({
      name: z.string(),
      category: z.string().nullable(),
      /** Null: no estimate could be made. */
      estimatedSavingsCents: z.number().int().nullable(),
    }),
  ),
  projectedSavingsCents: z.number().int().nullable(),
  disclaimer: z.string(),
  /** The client's approval of this plan, of exactly one version. */
  approval: z
    .object({
      version: z.number().int().min(1),
      approvedOn: CalendarDate,
      method: z.enum(['PORTAL', 'MANUAL']),
    })
    .nullable(),
  /** The client's own requests on the plan, newest first (the firm's answer comes by message). */
  requests: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['QUESTION', 'INFORMATION', 'REVISION', 'MEETING']),
      body: z.string(),
      status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']),
      createdAt: DateTime,
    }),
  ),
  can: z.object({
    /** This version was sent for review and is not approved yet. */
    approve: z.boolean(),
    /** The plan is open: the client may ask. */
    request: z.boolean(),
  }),
});
export type MyTaxPlan = z.infer<typeof MyTaxPlan>;

/** POST .../tax-plans/:id/requests: the client's question, revision request or meeting request. */
export const CreateMyTaxPlanRequest = z.strictObject({
  kind: MyTaxPlanRequestKind,
  body: z.string().trim().min(1, 'Write your request').max(4000, 'Keep it under 4,000 characters'),
});
export type CreateMyTaxPlanRequest = z.input<typeof CreateMyTaxPlanRequest>;

/** POST .../tax-plans/:id/approve: the exact version the client read. */
export const ApproveMyTaxPlanRequest = z.strictObject({ version: z.number().int().min(1) });
export type ApproveMyTaxPlanRequest = z.input<typeof ApproveMyTaxPlanRequest>;

const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.myTaxPlans(slug)`: the signed-in client's tax plans at this firm (portal). Another client's
 * plan, or one never sent, is 404. Approving a version that is not the one awaiting review, or
 * one already approved, is 409 INVALID_STATUS; a closed plan takes no request (409).
 */
export function createMyTaxPlansClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/tax-plans`;
  const one = (id: string) => `${base()}/${parseInput(TaxPlanId, id)}`;
  return {
    list: async (): Promise<MyTaxPlanRow[]> => (await request(MyTaxPlanList, base())).items,
    get: (id: string): Promise<MyTaxPlan> => request(MyTaxPlan, one(id)),
    ask: (id: string, body: CreateMyTaxPlanRequest): Promise<MyTaxPlan> =>
      request(MyTaxPlan, `${one(id)}/requests`, post(parseInput(CreateMyTaxPlanRequest, body))),
    approve: (id: string, body: ApproveMyTaxPlanRequest): Promise<MyTaxPlan> =>
      request(MyTaxPlan, `${one(id)}/approve`, post(parseInput(ApproveMyTaxPlanRequest, body))),
  };
}
export type MyTaxPlansClient = ReturnType<typeof createMyTaxPlansClient>;
