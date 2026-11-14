import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { MemberRef } from '../clients/schemas.js';
import { text } from '../clients/text.js';
import { LeadPriority, LeadSource } from '../db-enums.js';

// Leads R2 17 (Octavia, Nov 8): ownership and routing rules, Settings > Lead assignment (Owner and
// Admin). Rules are tried in order on a new lead that has no owner (Add New Lead without one,
// Begin Online); the first that matches gives the owner, else the fallback. Rules never touch an
// existing lead, and editing them changes no lead. A manual assignment always wins and clears the
// rule. The lead shows the rule that assigned it.

const DateTime = z.iso.datetime({ offset: true });

/** One rule, as Settings shows it. An empty list matches any value. */
export const LeadRoutingRule = z.object({
  id: z.uuid(),
  name: z.string(),
  enabled: z.boolean(),
  sources: z.array(LeadSource),
  serviceIds: z.array(z.uuid()),
  priorities: z.array(LeadPriority),
  assignee: MemberRef,
  updatedAt: DateTime,
});
export type LeadRoutingRule = z.infer<typeof LeadRoutingRule>;

/** GET /business/lead-routing: whether rules run, the fallback and the rules in order. */
export const LeadRouting = z.object({
  enabled: z.boolean(),
  fallback: MemberRef.nullable(),
  rules: z.array(LeadRoutingRule).max(50),
});
export type LeadRouting = z.infer<typeof LeadRouting>;

const RuleInput = z.strictObject({
  /** An existing rule's id; none for a new one. */
  id: z.uuid().optional(),
  name: text(80, 'one', 'Name the rule'),
  enabled: z.boolean().default(true),
  sources: z.array(LeadSource).max(20).default([]),
  serviceIds: z.array(z.uuid()).max(50).default([]),
  priorities: z.array(LeadPriority).max(10).default([]),
  assigneeUserId: z.uuid({ message: 'Choose who gets the lead' }),
});

/**
 * PUT /business/lead-routing (Owner, Admin): the whole setup, rules in their new order. A rule
 * left out is archived (never deleted: a lead names it). 404 for a member or service not the
 * firm's; 409 NOT_A_MEMBER for an assignee or fallback who is not an active member.
 */
export const SaveLeadRoutingRequest = z.strictObject({
  enabled: z.boolean(),
  fallbackUserId: z.uuid().nullable(),
  rules: z.array(RuleInput).max(50),
});
export type SaveLeadRoutingRequest = z.input<typeof SaveLeadRoutingRequest>;

/** What a new lead is routed on. */
export interface RoutableLead {
  source: LeadSource;
  serviceIds: readonly string[];
  priority: LeadPriority | null;
}

/** Whether `rule` matches `lead` (an empty list matches any value). */
export function ruleMatches(
  rule: Pick<LeadRoutingRule, 'enabled' | 'sources' | 'serviceIds' | 'priorities'>,
  lead: RoutableLead,
): boolean {
  if (!rule.enabled) return false;
  if (rule.sources.length && !rule.sources.includes(lead.source)) return false;
  if (rule.serviceIds.length && !lead.serviceIds.some((s) => rule.serviceIds.includes(s))) {
    return false;
  }
  if (rule.priorities.length && (!lead.priority || !rule.priorities.includes(lead.priority))) {
    return false;
  }
  return true;
}

/**
 * Where a new lead goes: the first enabled rule that matches, else the fallback, else nobody;
 * nothing while routing is off. The API and the Settings preview both use it.
 */
export function matchLeadRoute<
  R extends Pick<LeadRoutingRule, 'enabled' | 'sources' | 'serviceIds' | 'priorities'>,
>(
  routing: { enabled: boolean; rules: readonly R[] },
  lead: RoutableLead,
): { rule: R } | { fallback: true } | null {
  if (!routing.enabled) return null;
  const rule = routing.rules.find((r) => ruleMatches(r, lead));
  return rule ? { rule } : { fallback: true };
}

/** `api.leadRouting`: Settings > Lead assignment. */
export function createLeadRoutingClient(request: ApiRequest) {
  const base = '/business/lead-routing';
  return {
    get: async (): Promise<LeadRouting> => request(LeadRouting, base),
    save: async (body: SaveLeadRoutingRequest): Promise<LeadRouting> =>
      request(LeadRouting, base, { method: 'PUT', body: parseInput(SaveLeadRoutingRequest, body) }),
  };
}
export type LeadRoutingClient = ReturnType<typeof createLeadRoutingClient>;
