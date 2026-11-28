import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import { CalendarDate } from '../clients/schemas.js';
import { DownloadLink } from '../documents/schemas.js';
import {
  AdvisoryActionStatus,
  AdvisoryGoalStatus,
  AdvisoryRecommendationStatus,
  AdvisoryServiceStatus,
} from '../db-enums.js';
import {
  AdvisoryArea,
  AdvisoryPlanId,
  AdvisoryResource,
  AdvisoryResourceFormat,
  AdvisoryResourceKey,
} from './schemas.js';

/**
 * Client Portal Review One BA-CP (the lead's decision 4, option A): the signed-in client's
 * Business Advisory view, under My Services. Only what the firm marked for the client: the plans
 * it delivered (read-only, at the version delivered), the recommendations shown to the client,
 * the advisory tasks it did not hide, the resources it sent and the advisory files it shared.
 * Never the firm's figures, health score, notes, assessment or hidden items. The client comes
 * from the session, never the URL; another client's or another firm's plan is 404. A household
 * login (PRIMARY or SPOUSE) sees it; an AUTHORIZED login sees nothing (`enrolled: false`). Views
 * are audited. B10: the client approves, in this view, the business plan the firm sent for their
 * approval, before it is finalized.
 */

const DateTime = z.iso.datetime({ offset: true });

/** Where a delivered plan stands, as the client sees it. */
export const MyAdvisoryPlanState = z.enum([
  /** B10: the firm sent it for the client's approval: Approve (it is then finalized). */
  'AWAITING_APPROVAL',
  /** B10: the client approved this plan (`approval` says which version and when). */
  'APPROVED',
  /** Delivered: the firm is carrying it out, or it is done. */
  'DELIVERED',
  /** The firm is preparing a new revision; the version delivered stays readable. */
  'IN_PREPARATION',
]);
export type MyAdvisoryPlanState = z.infer<typeof MyAdvisoryPlanState>;

export const MY_ADVISORY_PLAN_STATE_LABELS: Record<MyAdvisoryPlanState, string> = {
  AWAITING_APPROVAL: 'Awaiting your approval',
  APPROVED: 'Approved',
  DELIVERED: 'Delivered',
  IN_PREPARATION: 'The firm is preparing a new version',
};

export const MyAdvisoryPlanRow = z.object({
  id: AdvisoryPlanId,
  /** As the version delivered names it. */
  name: z.string(),
  targetYear: z.number().int(),
  /** The newest version the firm delivered to the client. */
  version: z.number().int().min(1),
  deliveredAt: DateTime,
  state: MyAdvisoryPlanState,
  /** B10: the client's approval of this plan, of exactly one version; null until approved. */
  approval: z.object({ version: z.number().int().min(1), approvedAt: DateTime }).nullable(),
});
export type MyAdvisoryPlanRow = z.infer<typeof MyAdvisoryPlanRow>;

/** A recommendation the firm shows to the client (its "Show on Client Portal" switch). */
export const MyAdvisoryRecommendation = z.object({
  id: z.uuid(),
  title: z.string(),
  category: z.string().nullable(),
  rationale: z.string().nullable(),
  impactLabel: z.string().nullable(),
  /** The estimated financial benefit, when the firm gave one: an estimate, not a guarantee. */
  impactCents: z.number().int().nullable(),
  status: AdvisoryRecommendationStatus,
});
export type MyAdvisoryRecommendation = z.infer<typeof MyAdvisoryRecommendation>;

/** An advisory task the firm did not hide from the client (cancelled ones never show). */
export const MyAdvisoryTask = z.object({
  id: z.uuid(),
  title: z.string(),
  details: z.string().nullable(),
  dueOn: CalendarDate.nullable(),
  status: AdvisoryActionStatus,
  /** A past due date on an open task. */
  overdue: z.boolean(),
  /** The client's own to do (assigned to the client); otherwise the firm's. */
  forYou: z.boolean(),
});
export type MyAdvisoryTask = z.infer<typeof MyAdvisoryTask>;

/** A resource the firm sent the client, newest first, once per resource. */
export const MyAdvisoryResource = z.object({
  key: AdvisoryResource.shape.key,
  title: z.string(),
  category: z.string(),
  kind: AdvisoryResource.shape.kind,
  /** What the resource says (the library's own words). */
  summary: z.string(),
  /** B28: how the firm sent it; a PDF one downloads (`resourcePdf`). */
  format: AdvisoryResourceFormat,
  sentAt: DateTime,
  /** A-X10: the resource's https link (a link or a video), opened in a new tab. */
  url: z.string().nullable().default(null),
  /**
   * A-X10: the file the firm uploaded for it, only once its virus scan is clean; it downloads
   * behind a 5-minute link (`resourceFile`).
   */
  file: z
    .object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().int() })
    .nullable()
    .default(null),
});
export type MyAdvisoryResource = z.infer<typeof MyAdvisoryResource>;

/** An advisory file the firm shared to the client's portal (it opens from My Documents). */
export const MyAdvisoryFile = z.object({
  id: z.uuid(),
  fileName: z.string(),
  sharedAt: DateTime,
});
export type MyAdvisoryFile = z.infer<typeof MyAdvisoryFile>;

/** GET /portal/{firmSlug}/me/advisory. */
export const MyAdvisory = z.object({
  /** In the firm's advisory program; false (not in it, or an AUTHORIZED login): all lists empty. */
  enrolled: z.boolean(),
  businessName: z.string().nullable(),
  /** The advisor's name. */
  advisor: z.string().nullable(),
  /** The advisory services the client takes, from the firm's catalog (declined ones never show). */
  services: z.array(z.object({ name: z.string(), status: AdvisoryServiceStatus })),
  plans: z.array(MyAdvisoryPlanRow),
  recommendations: z.array(MyAdvisoryRecommendation),
  tasks: z.array(MyAdvisoryTask),
  resources: z.array(MyAdvisoryResource),
  files: z.array(MyAdvisoryFile),
  disclaimer: z.string(),
});
export type MyAdvisory = z.infer<typeof MyAdvisory>;

/**
 * GET /portal/{firmSlug}/me/advisory/plans/{id}: the plan at the version delivered, read-only, as
 * the firm sent it: its summary and focus, goals, the recommendations shown to the client and the
 * services. Never figures, the assessment, notes or a hidden recommendation.
 */
export const MyAdvisoryPlan = MyAdvisoryPlanRow.extend({
  businessName: z.string().nullable(),
  summary: z.string().nullable(),
  focusAreas: z.array(z.object({ area: AdvisoryArea, objective: z.string() })),
  goals: z.array(
    z.object({
      title: z.string(),
      area: z.string().nullable(),
      targetDate: CalendarDate.nullable(),
      status: AdvisoryGoalStatus,
    }),
  ),
  recommendations: z.array(
    z.object({
      title: z.string(),
      rationale: z.string().nullable(),
      impactLabel: z.string().nullable(),
      status: AdvisoryRecommendationStatus,
    }),
  ),
  services: z.array(z.object({ name: z.string(), status: AdvisoryServiceStatus })),
  disclaimer: z.string(),
  can: z.object({
    /** B10: this version is the one awaiting the client's approval. */
    approve: z.boolean(),
  }),
});
export type MyAdvisoryPlan = z.infer<typeof MyAdvisoryPlan>;

/**
 * POST /portal/{firmSlug}/me/advisory/plans/{id}/approve (B10): the exact version the client read.
 * Only a plan awaiting their approval (409 INVALID_STATUS otherwise, or for another version); it
 * is then finalized at that version, the firm is told, and the approval is audited.
 */
export const ApproveMyAdvisoryPlanRequest = z.strictObject({ version: z.number().int().min(1) });
export type ApproveMyAdvisoryPlanRequest = z.input<typeof ApproveMyAdvisoryPlanRequest>;

/**
 * GET /portal/{firmSlug}/me/advisory/resources/{key}/pdf (B28): a 5-minute download link to the
 * PDF of a resource the firm sent this client as a PDF; any other resource is 404. Audited.
 */
export const MyAdvisoryResourcePdf = z.object({ url: z.string(), expiresAt: DateTime });
export type MyAdvisoryResourcePdf = z.infer<typeof MyAdvisoryResourcePdf>;

const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.myAdvisory(slug)`: the signed-in client's Business Advisory at this firm (portal). Another
 * client's plan, one never delivered, or one archived is 404. Approving a plan that is not
 * awaiting approval, or another version, is 409 INVALID_STATUS.
 */
export function createMyAdvisoryClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/advisory`;
  const plan = (id: string) => `${base()}/plans/${parseInput(AdvisoryPlanId, id)}`;
  return {
    get: (): Promise<MyAdvisory> => request(MyAdvisory, base()),
    plan: (id: string): Promise<MyAdvisoryPlan> => request(MyAdvisoryPlan, plan(id)),
    approve: (id: string, body: ApproveMyAdvisoryPlanRequest): Promise<MyAdvisoryPlan> =>
      request(
        MyAdvisoryPlan,
        `${plan(id)}/approve`,
        post(parseInput(ApproveMyAdvisoryPlanRequest, body)),
      ),
    resourcePdf: (key: string): Promise<MyAdvisoryResourcePdf> =>
      request(
        MyAdvisoryResourcePdf,
        `${base()}/resources/${parseInput(AdvisoryResourceKey, key)}/pdf`,
      ),
    /** A-X10: a 5-minute link to the file of a resource the firm sent (only once it is clean). */
    resourceFile: (key: string): Promise<DownloadLink> =>
      request(DownloadLink, `${base()}/resources/${parseInput(AdvisoryResourceKey, key)}/file`),
  };
}
export type MyAdvisoryClient = ReturnType<typeof createMyAdvisoryClient>;
