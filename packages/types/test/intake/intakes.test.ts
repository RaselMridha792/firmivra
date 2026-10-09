import { describe, expect, it } from 'vitest';
import {
  createIntakesClient,
  createMyIntakesClient,
  RequestIntakeCorrectionRequest,
  SaveIntakeStepRequest,
  StartIntakeRequest,
} from '../../src/index.js';
import type { ApiRequest } from '../../src/client.js';

const ID = '0199b6a6-0000-7000-8000-000000000001';

/** A request stand-in that records the path and method and returns nothing useful. */
function recorder() {
  const calls: string[] = [];
  const request = (async (_schema: unknown, path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    return { items: [] };
  }) as unknown as ApiRequest;
  return { calls, request };
}

describe('intakes contract', () => {
  it('takes the client from the session: no client or firm id in a portal request', () => {
    expect(StartIntakeRequest.safeParse({ engagementId: ID, clientId: ID }).success).toBe(false);
    expect(SaveIntakeStepRequest.safeParse({ answers: {}, businessId: ID }).success).toBe(false);
  });

  it('needs a real correction note', () => {
    expect(RequestIntakeCorrectionRequest.safeParse({ note: '  ' }).success).toBe(false);
    expect(RequestIntakeCorrectionRequest.safeParse({ note: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(RequestIntakeCorrectionRequest.parse({ note: ' Fix the address.\nThanks ' }).note).toBe(
      'Fix the address.\nThanks',
    );
  });

  it('builds the portal and firm paths, refusing ids and step keys that are not one', async () => {
    const { calls, request } = recorder();
    const mine = createMyIntakesClient(request, 'lvp');
    await mine.choices();
    await mine.saveStep(ID, 'personal', { answers: {} });
    const firm = createIntakesClient(request);
    await firm.unlock(ID);
    expect(calls).toEqual([
      'GET /portal/lvp/me/intakes/choices',
      `PUT /portal/lvp/me/intakes/${ID}/steps/personal`,
      `POST /business/intakes/${ID}/unlock`,
    ]);
    await expect(mine.get('../x')).rejects.toThrow();
    await expect(mine.saveStep(ID, '../x', { answers: {} })).rejects.toThrow();
  });
});
