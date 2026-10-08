import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ApiRequestError,
  CREDENTIAL_TYPES,
  createFirmApplicationsClient,
  createRequest,
  FirmApplicationId,
  FirmApplicationListItem,
  FirmApplicationRecord,
  FIRM_SERVICES,
  PRACTICE_TYPES,
  PracticeType,
  REQUIRED_CREDENTIALS,
  SubmitFirmApplicationRequest,
  websiteHost,
  type CredentialType,
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
const client = (fn: typeof fetch) =>
  createFirmApplicationsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

/** A complete, synthetic application as the apply form sends it. */
const application = (): SubmitFirmApplicationRequest => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: ' Sample Tax Partners LLC ',
    dbaName: '',
    entityType: 'LLC',
    ein: '00-1234567',
    email: 'Office@Sample-Tax.example.test',
    phone: '+1 (404) 555-0100',
    website: 'sample-tax.example.test',
    address: { line1: '1 Example Way', city: 'Atlanta', state: 'ga', postalCode: '30301' },
    services: ['TAX_PREPARATION', 'BOOKKEEPING', 'TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: 'Jordan Sample',
    email: 'jordan@sample-tax.example.test',
    phone: '+1 404 555 0101',
  },
  account: { requestedPlan: 'PROFESSIONAL', teamSize: 3, clientVolume: 'FROM_500' },
  agreement: { acceptedTerms: true, certifiedAccurate: true },
});

const record = {
  id,
  status: 'PENDING_REVIEW',
  submittedAt: at,
  legalName: 'Sample Tax Partners LLC',
  dbaName: null,
  contactName: 'Jordan Sample',
  contactEmail: 'jordan@sample-tax.example.test',
  contactPhone: '+14045550101',
  formReadable: true,
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: 'Sample Tax Partners LLC',
    dbaName: null,
    entityType: 'LLC',
    einLast4: '4567',
    email: null,
    phone: null,
    website: null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: 'Jordan Sample',
    email: 'jordan@sample-tax.example.test',
    phone: '+14045550101',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: 3,
    clientVolume: 'FROM_500',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
  documents: [],
  checks: [{ key: 'DUPLICATE_EIN', result: 'PASS', note: 'No other application has this EIN' }],
  internalNotes: null,
  decision: null,
  suggestedSlug: 'sample-tax-partners',
  firm: null,
  ownerInvite: null,
  history: [{ type: 'SUBMITTED', at, by: null, message: null }],
};

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('api.firmApplications: submit', () => {
  it('sends the cleaned-up form to the public route', async () => {
    const { fn, calls } = fakeFetch(201, { received: true });
    await expect(client(fn).submit(application())).resolves.toEqual({ received: true });
    expect(calls[0]).toMatchObject({ url: '/api/v1/firm-applications', method: 'POST' });
    expect(calls[0]?.body).toMatchObject({
      business: {
        legalName: 'Sample Tax Partners LLC',
        dbaName: null,
        ein: '001234567',
        email: 'office@sample-tax.example.test',
        phone: '+14045550100',
        website: 'https://sample-tax.example.test',
        address: { state: 'GA' },
        services: ['TAX_PREPARATION', 'BOOKKEEPING'],
      },
      primaryAdmin: { phone: '+14045550101', preferredContact: 'EMAIL' },
      account: { teamSize: 3 },
      credentials: [],
    });
  });

  it('accepts its own output again (the API parses what the client sent)', () => {
    const once = SubmitFirmApplicationRequest.parse(application());
    expect(SubmitFirmApplicationRequest.parse(once)).toEqual(once);
  });

  it('sends the bot trap as it is, any length, so the API can drop a filled one quietly', async () => {
    const { fn, calls } = fakeFetch(201, { received: true });
    await client(fn).submit({ ...application(), honeypot: 'http://spam.example.test' });
    await client(fn).submit({ ...application(), honeypot: 'x'.repeat(5000) });
    expect(calls[0]?.body).toMatchObject({ honeypot: 'http://spam.example.test' });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['an unticked agreement', { agreement: { acceptedTerms: false, certifiedAccurate: true } }],
    ['a short EIN', { business: { ...application().business, ein: '00-123' } }],
    [
      'a script as website',
      { business: { ...application().business, website: 'javascript:alert(1)' } },
    ],
    ['no service', { business: { ...application().business, services: [] } }],
    ['an unknown plan', { account: { ...application().account, requestedPlan: 'GOLD' } }],
    ['a team size of 0', { account: { ...application().account, teamSize: 0 } }],
    ['a team size that is not a number', { account: { ...application().account, teamSize: true } }],
    ['an unknown field', { businessId: id }],
    // The owner invite's name rule (#52's invites_name), so approve never fails on it.
    [
      'an administrator name over 120 characters',
      { primaryAdmin: { ...application().primaryAdmin, fullName: 'J'.repeat(121) } },
    ],
    [
      'a control character in the administrator name',
      { primaryAdmin: { ...application().primaryAdmin, fullName: 'Jordan\u0007Sample' } },
    ],
    [
      'a line break in the legal name',
      { business: { ...application().business, legalName: 'Sample\nTax' } },
    ],
  ])('refuses %s before sending', async (_, change) => {
    const { fn, calls } = fakeFetch(201, { received: true });
    const body = { ...application(), ...change } as SubmitFirmApplicationRequest;
    expect((await rejection(client(fn).submit(body))).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  describe('required credentials per practice type', () => {
    const map = REQUIRED_CREDENTIALS as Record<PracticeType, CredentialType[]>;
    afterEach(() => {
      map.TAX_ACCOUNTING = [];
    });

    it('needs each credential the practice type requires', () => {
      map.TAX_ACCOUNTING = ['PTIN'];
      const missing = SubmitFirmApplicationRequest.safeParse(application());
      expect(missing.error?.issues[0]).toMatchObject({
        path: ['credentials'],
        message: 'Add your PTIN',
      });
      const given = { ...application(), credentials: [{ type: 'PTIN', number: 'P00000001' }] };
      expect(SubmitFirmApplicationRequest.safeParse(given).success).toBe(true);
    });
  });

  describe('websiteHost: a stored website, read as this form reads it', () => {
    const takes = (website: string) =>
      SubmitFirmApplicationRequest.safeParse({
        ...application(),
        business: { ...application().business, website },
      }).success;

    it('gives the host of a website the form takes', () => {
      for (const [website, host] of [
        ['sample-tax.example.test', 'sample-tax.example.test'],
        [' https://www.sample-tax.example.test/about ', 'www.sample-tax.example.test'],
        ['HTTP://Sample-Tax.Example.Test', 'sample-tax.example.test'],
      ] as const) {
        expect([websiteHost(website), takes(website)], website).toEqual([host, true]);
      }
    });

    it('gives null for one the form refuses, also when it reads as a URL', () => {
      for (const website of [
        'N/A',
        'none',
        '-',
        'not a website',
        'javascript:',
        'javascript:alert(1)',
        'mailto:',
        'ftp://sample.example.test',
        'http:/sample.example.test',
        'localhost',
        'https://192.0.2.1',
        'https://',
      ]) {
        expect([websiteHost(website), takes(website)], website).toEqual([null, false]);
      }
    });
  });

  it('keeps one label per code in every choice list', () => {
    expect(PracticeType.options).toEqual(Object.keys(PRACTICE_TYPES));
    expect(Object.keys(REQUIRED_CREDENTIALS)).toEqual(Object.keys(PRACTICE_TYPES));
    expect(Object.values(FIRM_SERVICES).every(Boolean)).toBe(true);
    expect(Object.values(CREDENTIAL_TYPES).every(Boolean)).toBe(true);
  });
});

describe('api.firmApplications: Super Admin', () => {
  it('lists with the query in the URL and the defaults filled in', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 2, pageSize: 20 });
    await client(fn).list({ status: 'PENDING_REVIEW', search: ' sample ', page: 2 });
    expect(calls[0]?.url).toBe(
      '/api/v1/admin/firm-applications?status=PENDING_REVIEW&search=sample&order=newest&page=2&pageSize=20',
    );
  });

  it('calls every review route with its method and body', async () => {
    const { fn, calls } = fakeFetch(200, record);
    const api = client(fn);
    await api.get(id);
    await api.approve(id);
    await api.approve(id, { slug: 'Sample-Tax' });
    await api.requestInfo(id, { message: 'Please send your PTIN.' });
    await api.decline(id, { reason: 'Not a tax practice.' });
    await api.saveNotes(id, { notes: '  ' });
    await api.resendOwnerInvite(id);
    const base = `/api/v1/admin/firm-applications/${id}`;
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual([
      [`GET ${base}`, undefined],
      [`POST ${base}/approve`, {}],
      [`POST ${base}/approve`, { slug: 'sample-tax' }],
      [`POST ${base}/request-info`, { message: 'Please send your PTIN.' }],
      [`POST ${base}/decline`, { reason: 'Not a tax practice.' }],
      [`PUT ${base}/notes`, { notes: null }],
      [`POST ${base}/owner-invite`, {}],
    ]);
  });

  it('calls the counts, firms and dashboard routes', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = client(fn);
    for (const call of [
      () => api.counts(),
      () => api.listFirms({ status: 'INACTIVE' }),
      () => api.firmCounts(),
      () => api.getFirm(id),
      () => api.dashboard(),
    ]) {
      await call().catch(() => undefined);
    }
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/admin/firm-applications/counts',
      '/api/v1/admin/firms?status=INACTIVE&page=1&pageSize=20',
      '/api/v1/admin/firms/counts',
      `/api/v1/admin/firms/${id}`,
      '/api/v1/admin/dashboard',
    ]);
  });

  it('refuses a bad id, slug, message or reason before sending', async () => {
    const { fn, calls } = fakeFetch(200, record);
    const api = client(fn);
    for (const call of [
      () => api.get('../business'),
      () => api.getFirm('1'),
      () => api.approve(id, { slug: 'no/slash' }),
      () => api.approve(id, { slug: 'double--hyphen' }),
      () => api.approve(id, { slug: '-edge' }),
      () => api.approve(id, { slug: 'a'.repeat(64) }),
      () => api.approve(id, { slug: 'Sign-In' }),
      () => api.list({ from: '2026-10-07T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
      () => api.requestInfo(id, { message: ' ' }),
      () => api.decline(id, { reason: '' }),
    ]) {
      expect((await rejection(call())).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it('passes the API error code through', async () => {
    const { fn } = fakeFetch(409, {
      error: { code: 'APPLICATION_DECIDED', message: 'This application is already decided' },
    });
    const error = await rejection(client(fn).approve(id));
    expect([error.status, error.code]).toEqual([409, 'APPLICATION_DECIDED']);
  });

  it('drops response fields it does not know, so an open page keeps working', () => {
    const parsed = FirmApplicationRecord.parse({ ...record, addedLater: true });
    expect(parsed).not.toHaveProperty('addedLater');
  });
});

describe('api.firmApplications: a stored form the API could not read', () => {
  const unreadable = {
    ...record,
    status: 'APPROVED',
    contactPhone: null,
    formReadable: false,
    business: null,
    primaryAdmin: null,
    account: null,
    credentials: [],
  };
  const row = {
    id,
    status: 'APPROVED',
    legalName: 'Sample Tax Partners LLC',
    dbaName: null,
    formReadable: false,
    practiceType: null,
    entityType: null,
    services: [],
    requestedPlan: null,
    contactName: 'Jordan Sample',
    contactEmail: 'jordan@sample-tax.example.test',
    contactPhone: null,
    submittedAt: at,
    decidedAt: at,
  };
  const firm = {
    id,
    slug: 'sample-tax-partners',
    name: 'Sample Tax Partners LLC',
    status: 'PENDING_SETUP',
    owner: null,
    plan: null,
    approvedAt: at,
    createdAt: at,
    application: unreadable,
  };

  it('opens the review page with the columns only: the form groups are null', async () => {
    const { fn } = fakeFetch(200, unreadable);
    await expect(client(fn).get(id)).resolves.toMatchObject({
      legalName: 'Sample Tax Partners LLC',
      contactName: 'Jordan Sample',
      contactEmail: 'jordan@sample-tax.example.test',
      contactPhone: null,
      formReadable: false,
      business: null,
      primaryAdmin: null,
      account: null,
      credentials: [],
    });
  });

  it('lists it without the details only the form has', async () => {
    const { fn } = fakeFetch(200, { items: [row], total: 1, page: 1, pageSize: 20 });
    const { items } = await client(fn).list();
    expect(items).toEqual([row]);
    expect(FirmApplicationListItem.safeParse({ ...row, formReadable: undefined }).success).toBe(
      false,
    );
  });

  it("opens its firm's page without the owner and plan the form would give", async () => {
    const { fn } = fakeFetch(200, firm);
    await expect(client(fn).getFirm(id)).resolves.toMatchObject({
      owner: null,
      plan: null,
      application: { id, formReadable: false, business: null },
    });
  });

  it("lists and opens LVP's seeded application and its firm; ids are RFC 9562 only", async () => {
    // The seed's id since R0's #89 (before it, the variant digit was 5).
    const seeded = '00000000-0000-4005-8000-000000000001';
    expect(z.uuid().safeParse(seeded).success).toBe(true);
    const answering = (body: unknown) => client(fakeFetch(200, body).fn);
    const listed = { items: [{ ...row, id: seeded }], total: 1, page: 1, pageSize: 20 };
    await expect(answering(listed).list()).resolves.toMatchObject({ items: [{ id: seeded }] });
    const opened = { ...unreadable, id: seeded };
    await expect(answering(opened).get(seeded)).resolves.toMatchObject({ id: seeded });
    await expect(answering(opened).saveNotes(seeded, { notes: 'Called.' })).resolves.toMatchObject({
      id: seeded,
    });
    await expect(answering({ ...firm, application: opened }).getFirm(id)).resolves.toMatchObject({
      application: { id: seeded },
    });
    for (const bad of [
      // The seed's old id: variant digit 5, not RFC 9562.
      '00000000-0000-4000-5000-000000000001',
      '00000000-0000-4005-8000-00000000000g',
      '00000000000040058000000000000001',
    ]) {
      expect(FirmApplicationId.safeParse(bad).success, bad).toBe(false);
    }
  });
});
