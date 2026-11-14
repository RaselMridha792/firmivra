import type { TxClient } from '@firmivra/db';

/**
 * Stops a lead's open sequence runs (Leads R2 19), in the caller's transaction: conversion, Not
 * Qualified and Lost. The unfinished steps stay on the lead.
 */
export async function stopSequences(
  tx: TxClient,
  businessId: string,
  leadIds: string[],
  reason: string,
): Promise<void> {
  if (!leadIds.length) return;
  await tx.leadSequenceRun.updateMany({
    where: { businessId, leadId: { in: leadIds }, stoppedAt: null },
    data: { stoppedAt: new Date(), stopReason: reason },
  });
}
