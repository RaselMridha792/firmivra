import { z } from 'zod';
import { ONE_LINE } from '../clients/text.js';
import {
  DashboardCardMetric,
  EngagementStatus,
  ServiceKind,
  TaxReturnWorkflowStatus,
} from '../db-enums.js';

// D4 and D5 (Octavia's Oct 25 dashboard review): the firm's own service cards. Total Clients, New
// Leads, Outstanding Invoices and Appointments Today stay fixed and are never configured. Up to six
// service cards follow them, each one row of R1's dashboard_card_templates: a service (or every
// tax return), a metric, a status and a label chosen together, so the label, the count and the
// list the card opens always agree. Owner and Admin set them in Settings > Dashboard Cards.

/** The most service cards a firm shows (R1's slots 1 to 6). */
export const DASHBOARD_CARD_SLOTS = 6;

/** Kinds whose engagements are tax returns: the only services a `tax:` card may name. */
export const TAX_SERVICE_KINDS = [
  'ANNUAL_TAX',
  'QUARTERLY_TAX',
] as const satisfies readonly z.infer<typeof ServiceKind>[];

/**
 * What a card counts, as `status_key` holds it:
 * - `engagement:<status>`: clients with an engagement of the card's service in that status;
 * - `tax:<workflow status>`: tax returns in that status (`tax:IN_PROGRESS`: the in-progress group,
 *   as Tax Returns' Status In Progress), of the card's tax service or of every tax return.
 */
export const DASHBOARD_CARD_STATUS_KEYS = [
  ...EngagementStatus.options.map((s) => `engagement:${s}` as const),
  'tax:IN_PROGRESS',
  ...TaxReturnWorkflowStatus.options.map((s) => `tax:${s}` as const),
] as const;
export const DashboardCardStatusKey = z.enum(
  DASHBOARD_CARD_STATUS_KEYS as unknown as [
    (typeof DASHBOARD_CARD_STATUS_KEYS)[number],
    ...(typeof DASHBOARD_CARD_STATUS_KEYS)[number][],
  ],
  'Choose a status',
);
export type DashboardCardStatusKey = z.infer<typeof DashboardCardStatusKey>;

/** The statuses in words, for the Settings screen and the cards' tooltips. */
export const DASHBOARD_CARD_STATUS_LABELS: Record<DashboardCardStatusKey, string> = {
  'engagement:PENDING': 'Pending',
  'engagement:ACTIVE': 'Active',
  'engagement:COMPLETED': 'Completed',
  'engagement:CANCELLED': 'Cancelled',
  'tax:IN_PROGRESS': 'In Progress (any step before filing)',
  'tax:IN_PREPARATION': 'In Preparation',
  'tax:WAITING_ON_CLIENT': 'Waiting on Client',
  'tax:READY_FOR_REVIEW': 'Ready for Review',
  'tax:READY_FOR_SIGNATURE': 'Ready for Signature',
  'tax:READY_TO_FILE': 'Ready to File',
  'tax:TRANSMITTED': 'Transmitted',
  'tax:ACCEPTED': 'Accepted',
  'tax:REJECTED': 'Rejected',
  'tax:CLOSED': 'Closed',
};

export const DASHBOARD_CARD_METRIC_LABELS: Record<z.infer<typeof DashboardCardMetric>, string> = {
  ACTIVE_ENGAGEMENTS: 'Active now',
  ENGAGEMENTS_IN_STATUS: 'In a status now',
  COMPLETED_IN_PERIOD: 'Reached in the period',
};

/**
 * Words that name tax returns. A tax card's label must use one and any other card's label must not
 * (Octavia's D4 and D5: a label never disguises an unrelated metric).
 */
const TAX_WORDS = /\b(returns?|tax(es)?|filed|filing|accepted|e-?files?|e-?filed)\b/i;

/** Why a card's choices do not fit together (400 with this code), or null when they do. */
export type DashboardCardProblem =
  | 'SERVICE_REQUIRED'
  | 'STATUS_REQUIRED'
  | 'STATUS_NOT_ALLOWED'
  | 'STATUS_NOT_FOR_SERVICE'
  | 'LABEL_MISMATCH';

export const DASHBOARD_CARD_PROBLEMS: Record<DashboardCardProblem, string> = {
  SERVICE_REQUIRED: 'Choose the service this card counts',
  STATUS_REQUIRED: 'Choose the status this card counts',
  STATUS_NOT_ALLOWED: 'This metric does not take that status',
  STATUS_NOT_FOR_SERVICE: 'Tax return statuses go with a tax service, or with every tax return',
  LABEL_MISMATCH:
    'The label must say what the card counts: a tax return card names returns or tax, and no other card does',
};

/**
 * The rule every card follows (the API refuses the rest; the Settings screen says why first):
 * - ACTIVE_ENGAGEMENTS: a service, no status; clients with an Active engagement of it.
 * - ENGAGEMENTS_IN_STATUS: `engagement:` with a service; `tax:` with a tax service or none (every
 *   tax return).
 * - COMPLETED_IN_PERIOD: `engagement:COMPLETED` with a service (completed in the period), or
 *   `tax:ACCEPTED` with a tax service or none (accepted in the period). Only these two, since the
 *   lists they open can show exactly that.
 * - The label: see TAX_WORDS.
 */
export function dashboardCardProblem(card: {
  serviceKind: z.infer<typeof ServiceKind> | null;
  metric: z.infer<typeof DashboardCardMetric>;
  statusKey: DashboardCardStatusKey | null;
  label: string;
}): DashboardCardProblem | null {
  const { serviceKind, metric, statusKey } = card;
  const tax = statusKey?.startsWith('tax:') ?? false;
  if (metric === 'ACTIVE_ENGAGEMENTS') {
    if (statusKey) return 'STATUS_NOT_ALLOWED';
    if (!serviceKind) return 'SERVICE_REQUIRED';
  } else {
    if (!statusKey) return 'STATUS_REQUIRED';
    if (
      metric === 'COMPLETED_IN_PERIOD' &&
      statusKey !== 'engagement:COMPLETED' &&
      statusKey !== 'tax:ACCEPTED'
    )
      return 'STATUS_NOT_ALLOWED';
    if (tax) {
      if (serviceKind && !(TAX_SERVICE_KINDS as readonly string[]).includes(serviceKind))
        return 'STATUS_NOT_FOR_SERVICE';
    } else if (!serviceKind) return 'SERVICE_REQUIRED';
  }
  if (TAX_WORDS.test(card.label) !== tax) return 'LABEL_MISMATCH';
  return null;
}

/** A service a card may name: the firm's services not archived. */
export const DashboardCardService = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: ServiceKind,
});
export type DashboardCardService = z.infer<typeof DashboardCardService>;

/** One saved card (GET /business/settings/dashboard-cards). */
export const DashboardCardTemplate = z.object({
  id: z.uuid(),
  /** 1 to 6: its place after the fixed cards. */
  slot: z.number().int().min(1).max(DASHBOARD_CARD_SLOTS),
  /** Null: every tax return (a `tax:` card only). */
  service: DashboardCardService.nullable(),
  metric: DashboardCardMetric,
  statusKey: DashboardCardStatusKey.nullable(),
  label: z.string(),
  enabled: z.boolean(),
  /** Sent back with a change or a removal; another change since answers 409 STALE_VERSION. */
  version: z.number().int().min(1),
  updatedAt: z.iso.datetime(),
  updatedBy: z.object({ userId: z.uuid(), name: z.string() }),
});
export type DashboardCardTemplate = z.infer<typeof DashboardCardTemplate>;

/**
 * The cards a firm with none saved shows (D5): Returns In Progress and Accepted Returns, the
 * default tax outcome card. Saving the first card replaces them.
 */
export const DEFAULT_DASHBOARD_CARDS = [
  {
    slot: 1,
    metric: 'ENGAGEMENTS_IN_STATUS',
    statusKey: 'tax:IN_PROGRESS',
    label: 'Returns In Progress',
  },
  { slot: 2, metric: 'COMPLETED_IN_PERIOD', statusKey: 'tax:ACCEPTED', label: 'Accepted Returns' },
] as const satisfies readonly {
  slot: number;
  metric: z.infer<typeof DashboardCardMetric>;
  statusKey: DashboardCardStatusKey;
  label: string;
}[];

/** GET /business/settings/dashboard-cards: the saved cards and the services to choose from. */
export const DashboardCardSettings = z.object({
  items: z.array(DashboardCardTemplate).max(DASHBOARD_CARD_SLOTS),
  /** True while none is saved: the dashboard shows DEFAULT_DASHBOARD_CARDS. */
  usingDefaults: z.boolean(),
  services: z.array(DashboardCardService),
});
export type DashboardCardSettings = z.infer<typeof DashboardCardSettings>;

const Label = z
  .string()
  .trim()
  .min(1, 'Enter a label')
  .max(40, 'Use at most 40 characters')
  .regex(ONE_LINE, 'Remove the special characters');

const cardFields = {
  /** Null: every tax return (a `tax:` card only). */
  serviceId: z.uuid().nullable(),
  metric: DashboardCardMetric,
  statusKey: DashboardCardStatusKey.nullable(),
  label: Label,
};

/** POST .../dashboard-cards: a new card in the first free slot (409 CARDS_FULL after six). */
export const CreateDashboardCardRequest = z.strictObject({
  ...cardFields,
  enabled: z.boolean().optional().default(true),
});
export type CreateDashboardCardRequest = z.input<typeof CreateDashboardCardRequest>;

/** PATCH .../dashboard-cards/{id}: the card as it should be, with the version it was read at. */
export const UpdateDashboardCardRequest = z.strictObject({
  ...cardFields,
  enabled: z.boolean(),
  version: z.number().int().min(1),
});
export type UpdateDashboardCardRequest = z.input<typeof UpdateDashboardCardRequest>;

/** DELETE .../dashboard-cards/{id}?version=: the slots after it move up. */
export const DeleteDashboardCardQuery = z.strictObject({
  version: z.coerce.number().int().min(1),
});
export type DeleteDashboardCardQuery = z.input<typeof DeleteDashboardCardQuery>;

/** PUT .../dashboard-cards/order: every saved card's id, in the new order (slot 1 first). */
export const OrderDashboardCardsRequest = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(DASHBOARD_CARD_SLOTS),
});
export type OrderDashboardCardsRequest = z.input<typeof OrderDashboardCardsRequest>;

/** POST .../dashboard-cards/preview: what a card would show now for This Month; saves nothing. */
export const PreviewDashboardCardRequest = z.strictObject({
  serviceId: z.uuid().nullable(),
  metric: DashboardCardMetric,
  statusKey: DashboardCardStatusKey.nullable(),
});
export type PreviewDashboardCardRequest = z.input<typeof PreviewDashboardCardRequest>;

export const DashboardCardId = z.uuid();

/**
 * The list a card opens, filtered to exactly what it counts: Tax Returns (`workflowStatus` or
 * `workflowGroup`, `serviceId`, `acceptedFrom`/`acceptedTo`) or Clients (`serviceId`,
 * `engagementStatus`, `completedFrom`/`completedTo`).
 */
export const DashboardCardLink = z.object({
  list: z.enum(['tax-returns', 'clients']),
  query: z.record(z.string(), z.string()),
});
export type DashboardCardLink = z.infer<typeof DashboardCardLink>;

/** A service card on the dashboard (summary.serviceCards), in slot order. */
export const DashboardServiceCard = z.object({
  slot: z.number().int().min(1).max(DASHBOARD_CARD_SLOTS),
  label: z.string(),
  metric: DashboardCardMetric,
  statusKey: DashboardCardStatusKey.nullable(),
  service: DashboardCardService.nullable(),
  /**
   * `ENGAGEMENTS_IN_STATUS` and `ACTIVE_ENGAGEMENTS`: at the end of the global period (now when it
   * ends today); `COMPLETED_IN_PERIOD`: within it. Previous: the same for the period before.
   */
  value: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative().nullable(),
  link: DashboardCardLink,
});
export type DashboardServiceCard = z.infer<typeof DashboardServiceCard>;

/** The preview's answer: the count now and for the month before, as the card would show it. */
export const DashboardCardPreview = z.object({
  value: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative().nullable(),
  link: DashboardCardLink,
});
export type DashboardCardPreview = z.infer<typeof DashboardCardPreview>;
