// Bookkeeping Reconciliation (BK-R01): marking ledger lines cleared, and the path the client calls.
import { describe, expect, it } from 'vitest';
import {
  ClearBookkeepingReconciliationItemsRequest,
  createBookkeepingClient,
  createRequest,
} from '../../src/index.js';

const RECON = '0199b6a0-0000-7000-8000-000000000011';
const LINE = '0199b6a0-0000-7000-8000-000000000012';
const OTHER = '0199b6a0-0000-7000-8000-000000000013';

describe('ClearBookkeepingReconciliationItemsRequest', () => {
  it('takes one or more lines, each once, and whether they are cleared', () => {
    expect(
      ClearBookkeepingReconciliationItemsRequest.parse({
        transactionIds: [LINE, OTHER],
        cleared: true,
      }),
    ).toEqual({ transactionIds: [LINE, OTHER], cleared: true });
    for (const bad of [
      { transactionIds: [], cleared: true },
      { transactionIds: [LINE, LINE], cleared: true },
      { transactionIds: [LINE] },
      { transactionIds: ['line-1'], cleared: false },
      { transactionIds: [LINE], cleared: true, all: true },
    ]) {
      expect(ClearBookkeepingReconciliationItemsRequest.safeParse(bad).success).toBe(false);
    }
  });
});

describe('api.bookkeeping reconciliation lines', () => {
  it('reads and clears at /reconciliations/{id}/items', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const api = createBookkeepingClient(createRequest({ baseUrl: '/api/v1', fetch: fake }));
    await expect(api.reconciliationItems(RECON)).rejects.toThrow();
    await expect(
      api.clearReconciliationItems(RECON, { transactionIds: [LINE], cleared: true }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      { url: `/api/v1/business/bookkeeping/reconciliations/${RECON}/items`, method: 'GET' },
      { url: `/api/v1/business/bookkeeping/reconciliations/${RECON}/items`, method: 'POST' },
    ]);
  });
});
