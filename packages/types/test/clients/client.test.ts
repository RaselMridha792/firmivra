import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  ClientRecord,
  createClientsClient,
  createMyProfileClient,
  createRequest,
  UpdateClientProfileRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const at = '2026-10-07T09:00:00.000Z';
const profile = {
  firstName: 'Jamie',
  middleName: null,
  lastName: 'Sample',
  preferredName: null,
  businessName: null,
  entityType: null,
  dateOfBirth: '1985-04-12',
  ssnLast4: '6789',
  address: { line1: null, line2: null, city: null, state: null, postalCode: null, country: 'US' },
  preferredContactMethod: 'EMAIL',
  referralSource: null,
  additionalInfo: null,
  updatedAt: at,
};
const record = {
  id,
  accountType: 'INDIVIDUAL',
  displayName: 'Jamie Sample',
  email: 'jamie@example.test',
  phone: null,
  assignedTo: null,
  portalStatus: null,
  archivedAt: null,
  createdAt: at,
  profile,
  portalLogins: [],
  updatedAt: at,
};
const clients = (fn: typeof fetch) =>
  createClientsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('api.clients', () => {
  it('lists with the query in the URL and the defaults filled in', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], nextCursor: null });
    await clients(fn).list({ search: ' Sample ', limit: 10 });
    expect(calls[0]).toMatchObject({
      url: '/api/v1/business/clients?search=Sample&status=active&limit=10',
      method: 'GET',
    });
  });

  it('calls the record, archive, profile and tax year routes', async () => {
    const { fn, calls } = fakeFetch(200, record);
    const api = clients(fn);
    await api.get(id);
    await api.archive(id);
    await api.restore(id);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET /api/v1/business/clients/${id}`,
      `POST /api/v1/business/clients/${id}/archive`,
      `POST /api/v1/business/clients/${id}/restore`,
    ]);

    const year = fakeFetch(200, {
      taxYear: 2025,
      status: { id, name: 'Filed' },
      clientNote: null,
      updatedBy: null,
      updatedAt: at,
    });
    await clients(year.fn).setTaxYear(id, 2025, { taxStatusId: id });
    expect(year.calls[0]).toMatchObject({
      url: `/api/v1/business/clients/${id}/tax-years/2025`,
      method: 'PUT',
      body: { taxStatusId: id },
    });
  });

  it('rejects bad input before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, record);
    const api = clients(fn);
    for (const call of [
      () => api.get('not-a-uuid'),
      () => api.create({ displayName: ' ' }),
      () => api.update(id, {}),
      () => api.updateProfile(id, { ssn: '123-45-678' }),
      () => api.setTaxYear(id, 1999, { taxStatusId: id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });

  it('sends the SSN as 9 digits; the response never has more than the last 4', async () => {
    expect(UpdateClientProfileRequest.parse({ ssn: '123-45-6789' })).toEqual({
      ssn: '123456789',
    });
    expect(() =>
      ClientRecord.parse({ ...record, profile: { ...profile, ssn: '123456789' } }),
    ).toThrow();
    expect(() =>
      ClientRecord.parse({ ...record, profile: { ...profile, ssnLast4: '123456789' } }),
    ).toThrow();
  });

  it('turns an API error into ApiRequestError', async () => {
    const { fn } = fakeFetch(404, {
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r1' },
    });
    const error = await clients(fn)
      .get(id)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('api.myProfile(firmSlug)', () => {
  it("uses the firm's portal routes; name and date of birth cannot be sent", async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    const me = createMyProfileClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), 'LVP');
    await me.requestNameChange({ newName: 'Jamie Q. Sample' });
    expect(calls[0]).toMatchObject({
      url: '/api/v1/portal/lvp/me/profile/name-change',
      method: 'POST',
    });
    await expect(
      me.update({ fullName: 'New' } as unknown as Parameters<typeof me.update>[0]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      me.update({ dateOfBirth: '1990-01-01' } as unknown as Parameters<typeof me.update>[0]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
