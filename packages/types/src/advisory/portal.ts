import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import { CalendarDate } from '../clients/schemas.js';
import {
  AdvisoryActionStatus,
  AdvisoryGoalStatus,
  AdvisoryRecommendationStatus,
  AdvisoryServiceStatus,
} from '../db-enums.js';
import { AdvisoryArea, AdvisoryPlanId, AdvisoryResource } from './schemas.js';

/**
 * Client Portal Review One BA-CP (the lead's decision 4, option A): the signed-in client's
 * Business Advisory view, under My Services. Only what the firm marked for the client: the plans
 * it delivered (read-only, at the version delivered), the recommendations shown to the client,
 * the advisory tasks it did not hide, the resources it sent and the advisory files it shared.
 * Never the firm's figures, health score, notes, assessment or hidden items. The client comes
 * from the session, never the URL; another client's or another firm's plan is 404. A household
 * login (PRIMARY or SPOUSE) sees it; an AUTHORIZED login sees nothing (`enrolled: false`). Views
 * are audited.
 */

const DateTime = z.iso.datetime({ offset: true });

/** Where a delivered plan stands, as the client sees it. */
export const MyAdvisoryPlanState = z.enum([
  /** Delivered: the firm is carrying it out, or it is done. */
  'DELIVERED',
  /** The firm is preparing a new revision; the version delivered stays readable. */
  'IN_PREPARATION',
]);
export type MyAdvisoryPlanState = z.infer<typeof MyAdvisoryPlanState>;

export const MY_ADVISORY_PLAN_STATE_LABELS: Record<MyAdvisoryPlanState, string> = {
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
  sentAt: DateTime,
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
});
export type MyAdvisoryPlan = z.infer<typeof MyAdvisoryPlan>;

/**
 * `api.myAdvisory(slug)`: the signed-in client's Business Advisory at this firm (portal). Another
 * client's plan, one never delivered, or one archived is 404.
 */
export function createMyAdvisoryClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/advisory`;
  const plan = (id: string) => `${base()}/plans/${parseInput(AdvisoryPlanId, id)}`;
  return {
    get: (): Promise<MyAdvisory> => request(MyAdvisory, base()),
    plan: (id: string): Promise<MyAdvisoryPlan> => request(MyAdvisoryPlan, plan(id)),
  };
}
export type MyAdvisoryClient = ReturnType<typeof createMyAdvisoryClient>;
