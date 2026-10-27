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
