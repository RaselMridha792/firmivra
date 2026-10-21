// Settings > Locations contract (R1, Oct 21): the form's rules, the client's paths and the
// Overview's new optional fields. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  CreateLocationRequest,
  createLocationsClient,
  createRequest,
  createSettingsOverviewClient,
  DeactivateManagerRequest,
  LOCATION_DUPLICATE_MESSAGE,
  LocationHours,
  LocationsQuery,
  SetLocationStaffRequest,
  UpdateLocationActionRequest,
  UpdateLocationRequest,
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
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });

const ID = '0199f0a0-0000-7000-8000-000000000001';
const USER = '0199f0a0-0000-7000-8000-000000000002';
const office = {
  name: 'Auburn Office',
  addressLine1: '100 Example Street',
  city: 'Auburn',
  state: 'GA',
  postalCode: '30011',
  phone: '+15555550100',
  email: 'Auburn@LVP.test',
  managerUserId: USER,
  serviceIds: [],
  hours: [{ weekday: 1, opensAt: '09:00', closesAt: '17:00' }],
  staffUserIds: [],
};

describe('Locations form rules', () => {
  it('takes an office with its address, lower-cases the email and defaults to an active office', () => {
    const parsed = CreateLocationRequest.parse(office);
    expect(parsed).toMatchObject({
      kind: 'OFFICE',
      status: 'ACTIVE',
      isMain: false,
      email: 'auburn@lvp.test',
    });
  });

  it('needs a street address for an office and none for a virtual location', () => {
    expect(CreateLocationRequest.safeParse({ ...office, city: null }).success).toBe(false);
    const virtual = {
      ...office,
      kind: 'VIRTUAL',
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    };
    expect(CreateLocationRequest.safeParse(virtual).success).toBe(true);
    expect(
      CreateLocationRequest.safeParse({ ...virtual, addressLine1: '1 Cloud Way' }).success,
    ).toBe(false);
  });

  it('refuses a local phone, a bad ZIP, repeats, and a primary that is not active', () => {
    for (const change of [
      { phone: '(555) 555-0100' },
      { postalCode: '3001' },
      { serviceIds: [ID, ID] },
      { staffUserIds: [USER, USER] },
      { isMain: true, status: 'INACTIVE' },
      { businessId: ID },
    ]) {
      expect(CreateLocationRequest.safeParse({ ...office, ...change }).success).toBe(false);
    }
  });

  it('keeps a day free of overlapping hours, allows touching ones and refuses close before open', () => {
    expect(
      LocationHours.safeParse([
        { weekday: 1, opensAt: '09:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '12:00', closesAt: '17:00' },
        { weekday: 2, opensAt: '11:00', closesAt: '13:00' },
      ]).success,
    ).toBe(true);
    expect(
      LocationHours.safeParse([
        { weekday: 1, opensAt: '09:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '11:00', closesAt: '13:00' },
      ]).success,
    ).toBe(false);
    expect(
      LocationHours.safeParse([{ weekday: 3, opensAt: '17:00', closesAt: '09:00' }]).success,
    ).toBe(false);
    expect(
      LocationHours.safeParse([{ weekday: 7, opensAt: '09:00', closesAt: '17:00' }]).success,
    ).toBe(false);
  });

  it('needs the version on save, something to change on a schedule, and no repeated staff', () => {
    const { managerUserId: _, ...fields } = office;
    expect(UpdateLocationRequest.safeParse(fields).success).toBe(false);
    expect(
      UpdateLocationRequest.safeParse({ ...fields, expectedUpdatedAt: '2026-10-21T10:00:00.000Z' })
        .success,
    ).toBe(true);
    expect(UpdateLocationActionRequest.safeParse({}).success).toBe(false);
    expect(DeactivateManagerRequest.safeParse({ replacementUserId: null }).success).toBe(true);
    expect(SetLocationStaffRequest.safeParse({ staffUserIds: [USER, USER] }).success).toBe(false);
  });

  it('keeps the exact duplicate message', () => {
    expect(LOCATION_DUPLICATE_MESSAGE).toBe(
      'This location already exists. Please review the existing location before continuing.',
    );
  });
});

describe('api.locations', () => {
  it('lists with filters and pages, and refuses a bad query before sending', async () => {
    const { fn, calls } = fakeFetch(200, {
      items: [],
      total: 0,
      kpis: { total: 0, active: 0, subscription: { used: 0, allowed: null } },
    });
    const api = createLocationsClient(request(fn));
    await api.list({ status: 'ACTIVE', search: 'Auburn', page: 2 });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/locations?search=Auburn&status=ACTIVE&sort=name&order=asc&page=2&limit=25',
    );
    await expect(api.list({ status: 'GONE' } as unknown as LocationsQuery)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(api.get('not-a-uuid')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(1);
  });

  it('posts the actions to their own paths', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createLocationsClient(request(fn));
    for (const call of [
      () => api.setPrimary(ID),
      () => api.activate(ID),
      () => api.deactivate(ID, { effectiveAt: '2026-11-01T14:00:00.000Z' }),
      () => api.reassignManager(ID, { managerUserId: USER }),
      () => api.deactivateManager(USER, { replacementUserId: null }),
      () => api.cancelAction(ID),
    ]) {
      await call().catch(() => undefined);
    }
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', `/api/v1/business/locations/${ID}/primary`],
      ['POST', `/api/v1/business/locations/${ID}/activate`],
      ['POST', `/api/v1/business/locations/${ID}/deactivate`],
      ['POST', `/api/v1/business/locations/${ID}/manager`],
      ['POST', `/api/v1/business/locations/managers/${USER}/deactivate`],
      ['POST', `/api/v1/business/locations/actions/${ID}/cancel`],
    ]);
  });
});

describe('api.settingsOverview with Locations', () => {
  it('reads the new optional location fields', async () => {
    const { fn } = fakeFetch(200, {
      staffUsers: { value: 3, addedThisMonth: 1 },
      securityAlerts: 0,
      recentActivity: [],
      activeLocations: { value: 2, addedThisMonth: 0 },
      locationAllowance: { used: 2, allowed: 5 },
      locations: [],
    });
    const overview = await createSettingsOverviewClient(request(fn)).get();
    expect(overview.locationAllowance).toEqual({ used: 2, allowed: 5 });
  });
});
