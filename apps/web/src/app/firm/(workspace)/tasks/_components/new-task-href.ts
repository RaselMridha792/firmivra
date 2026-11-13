/** Create Task for a client, its service and period (SH4): `/tasks/new` fills these in. */
export function newTaskHref(context: {
  clientId: string;
  engagementId?: string;
  period?: string;
}): string {
  const params = new URLSearchParams({ clientId: context.clientId });
  if (context.engagementId) params.set('engagementId', context.engagementId);
  if (context.period) params.set('period', context.period);
  return `/tasks/new?${params.toString()}`;
}

/** Set up a recurring task on the same client and engagement (Review 2, Bookkeeping N05). */
export function recurringHref(clientId: string, engagementId: string): string {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (engagementId) params.set('engagementId', engagementId);
  const q = params.toString();
  return `/tasks/recurring/new${q ? `?${q}` : ''}`;
}

/** Where Related To opens: the engagement's own workspace (Review 2, Bookkeeping N05). */
export function workspacePath(
  workspace: { kind: 'BOOKKEEPING' | 'PAYROLL' | 'ADVISORY'; id: string } | null | undefined,
): string | null {
  if (!workspace) return null;
  if (workspace.kind === 'BOOKKEEPING') return `/bookkeeping/clients/${workspace.id}`;
  if (workspace.kind === 'PAYROLL') return `/payroll/clients/${workspace.id}`;
  return `/business-advisory/clients/${workspace.id}`;
}
