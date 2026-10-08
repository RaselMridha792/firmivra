import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  ClientRecord,
  CreateClientRequest,
  createClientsClient,
  createMyProfileClient,
  createRequest,
  FirmSlug,
  TaxYear,
  toQuery,
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
  ssnLast4: '0001',
  einLast4: null,
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

  it('calls the record, archive, restore and tax year routes', async () => {
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
    await clients(year.fn).setTaxYear(id, 2025, { taxStatusId: id, clientNote: '' });
    expect(year.calls[0]).toMatchObject({
      url: `/api/v1/business/clients/${id}/tax-years/2025`,
      method: 'PUT',
      body: { taxStatusId: id, clientNote: null },
    });
  });

  it('rejects bad input before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, record);
    const api = clients(fn);
    for (const call of [
      () => api.get('not-a-uuid'),
      () => api.create({ displayName: ' ' }),
      () => api.create({ displayName: 'Tab\tin a name' }),
      () => api.update(id, {}),
      () => api.updateProfile(id, { ssn: '900-00-001' }),
      () => api.updateProfile(id, { dateOfBirth: '2999-01-01' }),
      () => api.updateProfile(id, { additionalInfo: 'bell \u0007' }),
      // Format characters and separators that disguise text (right-to-left override, zero width).
      () => api.create({ displayName: 'Evil\u202Egnp.exe' }),
      () => api.create({ displayName: 'Zero\u200Bwidth' }),
      () => api.create({ displayName: 'Line\u2028separator' }),
      () => api.updateProfile(id, { additionalInfo: 'hidden\u2066text' }),
      () => api.setTaxYear(id, 1999, { taxStatusId: id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });

  it('takes a tax year as a number or exactly four digits, 2000 to 2100', () => {
    expect(TaxYear.parse(2026)).toBe(2026);
    expect(TaxYear.parse('2026')).toBe(2026);
    for (const bad of ['02026', '2026.0', '0x7EA', '2.026e3', ' 2026', '1999', 2101, 2025.5]) {
      expect(TaxYear.safeParse(bad).success).toBe(false);
    }
  });

  it('text: one line refuses control characters, notes keep line breaks, "" clears a field', () => {
    expect(
      UpdateClientProfileRequest.parse({
        additionalInfo: 'Line one\nLine two',
        referralSource: '',
        ssn: '900-00-0001',
        ein: '90-0000001',
      }),
    ).toEqual({
      additionalInfo: 'Line one\nLine two',
      referralSource: null,
      ssn: '900000001',
      ein: '900000001',
    });
  });

  it('text: hidden and direction-changing characters are refused; joiners and marks are kept', () => {
    const oneLine = (displayName: string) => CreateClientRequest.safeParse({ displayName }).success;
    const lines = (additionalInfo: string) =>
      UpdateClientProfileRequest.safeParse({ additionalInfo }).success;
    // A right-to-left override, a zero-width space, a bidi isolate, and the rest of the set: the
    // Arabic letter mark, the embeddings and overrides, the word joiner, the isolates, U+FEFF.
    const hidden = [...'\u061C\u202A\u202B\u202C\u202D\u2060\u2067\u2068\u2069\uFEFF'].map(
      (c) => `a${c}b`,
    );
    for (const bad of ['Evil\u202Egnp.exe', 'Zero\u200Bwidth', 'hidden\u2066text', ...hidden]) {
      expect([bad, oneLine(bad), lines(bad)]).toEqual([bad, false, false]);
    }
    // A line separator: refused on one line, a line break in notes.
    expect(oneLine('Line\u2028separator')).toBe(false);
    expect(lines('Line\u2028separator')).toBe(true);
    // Kept: a family emoji (three people joined by ZWJ), a Persian surname with a ZWNJ, a soft
    // hyphen, and a right-to-left mark after a Hebrew name.
    for (const good of [
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
      '\u0639\u0644\u06CC\u200C\u0632\u0627\u062F\u0647',
      'Hyphen\u00ADated',
      '\u05E9\u05E8\u05D4\u200F (Sarah)',
    ]) {
      expect([good, oneLine(good), lines(good)]).toEqual([good, true, true]);
    }
  });

  it('a response never carries more than the last 4 of the SSN or EIN', () => {
    // Responses drop unknown fields, so a full SSN would never reach the screen.
    const parsed = ClientRecord.parse({
      ...record,
      profile: { ...profile, ssn: '900000001', ein: '900000001' },
    });
    expect(parsed.profile).not.toHaveProperty('ssn');
    expect(parsed.profile).not.toHaveProperty('ein');
    expect(() =>
      ClientRecord.parse({ ...record, profile: { ...profile, ssnLast4: '900000001' } }),
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
    for (const body of [{ fullName: 'New' }, { dateOfBirth: '1990-01-01' }]) {
      await expect(
        me.update(body as unknown as Parameters<typeof me.update>[0]),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('refuses a firm slug that is not one, before building a path', async () => {
    const { fn, calls } = fakeFetch(200, {});
    for (const slug of ['..', 'lvp/../admin', 'a b', '-lvp']) {
      const me = createMyProfileClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), slug);
      await expect(me.get()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
    expect(FirmSlug.parse(' LVP ')).toBe('lvp');
  });
});

describe('toQuery', () => {
  it('keeps defined values only', () => {
    expect(toQuery({ a: 1, b: undefined, c: 'x y' })).toBe('?a=1&c=x+y');
    expect(toQuery({ a: undefined })).toBe('');
  });
});
