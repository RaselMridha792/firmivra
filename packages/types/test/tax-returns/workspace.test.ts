// The Tax Returns workspace contract (R55): schemas and the paths `api.taxReturnWorkspace` calls.
import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  ChangeTaxReturnStatusRequest,
  CreateWorkspaceTaxReturnRequest,
  createRequest,
  createTaxReturnWorkspaceClient,
  SetTaxAuthorizationsRequest,
  SetTaxReturnFilingsRequest,
  TaxReturnsQuery,
  UpdateTaxFilingAttemptRequest,
  UpdateTaxReturnDetailsRequest,
} from '../../src/index.js';

const ID = '0199b6a0-0000-7000-8000-000000000001';
const ID2 = '0199b6a0-0000-7000-8000-000000000002';
const AT = '2026-04-15T14:00:00.000Z';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (fn: typeof fetch) =>
  createTaxReturnWorkspaceClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('tax return workspace schemas', () => {
  it('defaults the overview to every live return, newest change first', () => {
    expect(TaxReturnsQuery.parse({})).toMatchObject({
      tab: 'all',
      archived: false,
      sort: 'updated',
      page: 1,
      pageSize: 10,
    });
    expect(TaxReturnsQuery.parse({ archived: 'true' }).archived).toBe(true);
    expect(TaxReturnsQuery.safeParse({ tab: 'extensions' }).success).toBe(false);
  });

  it('a new return: an amendment needs its original and a reason; filing status is individual', () => {
    const base = { clientId: ID, taxYear: 2025, filingType: 'INDIVIDUAL' };
    expect(CreateWorkspaceTaxReturnRequest.parse(base)).toMatchObject({ allowDuplicate: false });
    expect(
      CreateWorkspaceTaxReturnRequest.safeParse({ ...base, amendsReturnId: ID2 }).success,
    ).toBe(false);
    expect(
      CreateWorkspaceTaxReturnRequest.safeParse({
        ...base,
        amendsReturnId: ID2,
        amendReason: 'Missed a 1099',
      }).success,
    ).toBe(true);
    expect(
      CreateWorkspaceTaxReturnRequest.safeParse({
        ...base,
        filingType: 'BUSINESS',
        filingStatus: 'SINGLE',
      }).success,
    ).toBe(false);
    expect(CreateWorkspaceTaxReturnRequest.safeParse({ ...base, states: ['ny'] }).success).toBe(
      false,
    );
  });

  it('details need a change; a status move takes an optional reason', () => {
    expect(UpdateTaxReturnDetailsRequest.safeParse({}).success).toBe(false);
    expect(
      ChangeTaxReturnStatusRequest.parse({ workflowStatus: 'READY_FOR_REVIEW' }),
    ).toMatchObject({ workflowStatus: 'READY_FOR_REVIEW' });
    expect(ChangeTaxReturnStatusRequest.safeParse({ workflowStatus: 'FILED' }).success).toBe(false);
  });

  it('filings, transmissions and authorizations follow the database rules', () => {
    expect(
      SetTaxReturnFilingsRequest.parse({
        filings: [{ jurisdiction: 'US' }, { jurisdiction: 'NY' }],
      }).filings[0],
    ).toEqual({ jurisdiction: 'US', filingMethod: 'EFILE', required: true });
    expect(
      SetTaxReturnFilingsRequest.safeParse({ filings: [{ jurisdiction: 'USA' }] }).success,
    ).toBe(false);
    expect(
      UpdateTaxFilingAttemptRequest.safeParse({
        ackStatus: 'REJECTED',
        acknowledgedAt: AT,
        rejectCode: 'IND-031',
      }).success,
    ).toBe(true);
    expect(UpdateTaxFilingAttemptRequest.safeParse({ ackStatus: 'PENDING' }).success).toBe(false);
    expect(
      SetTaxAuthorizationsRequest.safeParse({ items: [{ kind: 'STATE_EFILE' }] }).success,
    ).toBe(false);
    expect(
      SetTaxAuthorizationsRequest.safeParse({
        items: [{ kind: 'FEDERAL_EFILE' }, { kind: 'STATE_EFILE', jurisdiction: 'NY' }],
      }).success,
    ).toBe(true);
  });
});

describe('api.taxReturnWorkspace', () => {
  it('calls the workspace routes', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    await client(fn).filings(ID);
    expect(calls[0]?.url).toBe(`/api/v1/business/tax-returns/${ID}/filings`);
    await client(fn).returnToPreparer(ID, ID2, { note: 'Check Schedule C' });
    expect(calls[1]).toMatchObject({
      url: `/api/v1/business/tax-returns/${ID}/approvals/${ID2}/return`,
      init: { method: 'POST' },
    });
    await client(fn).removeChecklistItem(ID, ID2);
    expect(calls[2]?.init.method).toBe('DELETE');
  });

  it('refuses bad input before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).get('nope')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client(fn).updateDetails(ID, {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
