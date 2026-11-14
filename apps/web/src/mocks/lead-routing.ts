import {
  type LeadRouting,
  type LeadRoutingClient,
  parseInput,
  SaveLeadRoutingRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { team } from './leads-pipeline';

let mock: LeadRoutingClient | undefined;

/** `api.leadRouting` on mock data (Leads R2 17): one setup for the page's lifetime. */
export function leadRoutingMock(): LeadRoutingClient {
  mock ??= createLeadRoutingMock();
  return mock;
}

/** An in-memory Settings > Lead assignment: routing off, no rules, as a new firm starts. */
export function createLeadRoutingMock(): LeadRoutingClient {
  let state: LeadRouting = { enabled: false, fallback: null, rules: [] };
  let next = 1;
  const member = (userId: string) =>
    team().find((m) => m.userId === userId) ?? { userId, name: 'Member' };
  return {
    get: async () => {
      await mockDelay();
      return structuredClone(state);
    },
    save: async (body) => {
      await mockDelay();
      const input = parseInput(SaveLeadRoutingRequest, body);
      const at = new Date().toISOString();
      state = {
        enabled: input.enabled,
        fallback: input.fallbackUserId ? member(input.fallbackUserId) : null,
        rules: input.rules.map((r) => ({
          id: r.id ?? `0199c0e0-0c00-7000-8000-${String(next++).padStart(12, '0')}`,
          name: r.name,
          enabled: r.enabled,
          sources: r.sources,
          serviceIds: r.serviceIds,
          priorities: r.priorities,
          assignee: member(r.assigneeUserId),
          updatedAt: at,
        })),
      };
      return structuredClone(state);
    },
  };
}
