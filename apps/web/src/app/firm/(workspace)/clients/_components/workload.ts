import type { MemberRef, TeamMember } from '@firmivra/types';

/** Someone to assign, with what SM08 warns about (the team list's workload). */
export type Assignee = MemberRef & { workload?: TeamMember['workload'] };

/**
 * SM08 (Staff Management Review 2, decision 5a): a warning, never a block, when `adding` more
 * clients would go to someone who is not taking new clients or would go over their maximum
 * (Staff Management's Maximum Active Clients).
 */
export function workloadWarning(member: Assignee | undefined, adding: number): string | null {
  const w = member?.workload;
  if (!member || !w || adding <= 0) return null;
  if (!w.acceptsNewClients)
    return `${member.name} is not taking new clients. You can still assign them.`;
  const after = w.activeClients + adding;
  if (w.maxActiveClients !== null && after > w.maxActiveClients)
    return `${member.name} would have ${after} active clients, over their maximum of ${w.maxActiveClients}. You can still assign them.`;
  return null;
}
