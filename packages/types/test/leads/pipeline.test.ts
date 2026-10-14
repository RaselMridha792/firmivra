import { describe, expect, it } from 'vitest';
import {
  ConvertLeadToClientRequest,
  CreateLeadRequest,
  createLeadPipelineClient,
  createRequest,
  LeadBulkRequest,
  LeadPipelineQuery,
  UpdateLeadRequest,
} from '../../src/index.js';

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

const id = '0199c0c0-0a00-7000-8000-000000000001';
const staff = '0199c0a0-0b00-7000-8000-000000000001';
const service = '0199c0c0-0e00-7000-8000-000000000001';
const client = (fn: typeof fetch) =>
  createLeadPipelineClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('api.leadPipeline', () => {
  it('lists with filters and reads the overdue flag from a query string', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 8 });
    await client(fn).list({ stage: 'IN_FOLLOW_UP', source: 'FACEBOOK_AD', overdue: true });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/leads/pipeline?source=FACEBOOK_AD&stage=IN_FOLLOW_UP&overdue=true&page=1&pageSize=8',
    );
    expect(LeadPipelineQuery.parse({ overdue: 'false' }).overdue).toBe(false);
    expect(LeadPipelineQuery.parse({ overdue: 'true' }).overdue).toBe(true);
  });

  it('fills the Add New Lead defaults and refuses a business id', () => {
    const lead = {
      firstName: 'Pat',
      lastName: 'Sample',
      email: 'PAT@example.test',
      source: 'REFERRAL' as const,
    };
    expect(CreateLeadRequest.parse(lead)).toMatchObject({
      email: 'pat@example.test',
      priority: 'WARM',
      stage: 'NEW',
      serviceIds: [],
    });
    expect(CreateLeadRequest.safeParse({ ...lead, businessId: id }).success).toBe(false);
    expect(CreateLeadRequest.safeParse({ ...lead, stage: 'CONVERTED' }).success).toBe(false);
  });

  it('needs a real change to update', () => {
    expect(UpdateLeadRequest.safeParse({ version: 'v1' }).success).toBe(false);
    expect(UpdateLeadRequest.safeParse({ version: 'v1', priority: 'HOT' }).success).toBe(true);
  });

  it('checks each bulk action', () => {
    expect(
      LeadBulkRequest.safeParse({ action: 'TAGS', ids: [id], add: ['Back Taxes'] }).success,
    ).toBe(true);
    expect(
      LeadBulkRequest.safeParse({ action: 'STAGE', ids: [id], stage: 'CONVERTED' }).success,
    ).toBe(false);
    expect(LeadBulkRequest.safeParse({ action: 'ARCHIVE', ids: [] }).success).toBe(false);
  });

  it('converts with every carry-over on by default and at least one service', async () => {
    const body = {
      idempotencyKey: '0199c0c0-1111-7000-8000-000000000001',
      fullName: 'Pat Sample',
      email: 'pat@example.test',
      phone: '(555) 010-0000',
      serviceIds: [service],
      primaryStaffUserId: staff,
    };
    const parsed = ConvertLeadToClientRequest.parse(body);
    expect(parsed.carryOver).toMatchObject({ notes: true, documents: true, attribution: true });
    expect(parsed.sendPortalInvite).toBe(true);
    expect(ConvertLeadToClientRequest.safeParse({ ...body, serviceIds: [] }).success).toBe(false);
    const { fn, calls } = fakeFetch(200, {
      clientId: id,
      engagementIds: [],
      inviteSent: true,
      carried: {
        notes: 0,
        communications: 0,
        appointments: 0,
        tasks: 0,
        documents: 0,
        intakeForms: 0,
      },
    });
    await client(fn).convertToClient(id, body);
    expect(calls[0]?.url).toBe(`/api/v1/business/leads/${id}/convert-to-client`);
  });
});
