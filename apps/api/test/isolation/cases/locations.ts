// Settings > Locations (R1). A write case runs in a fresh world, so one record serves them all.
// The location keeps a fixed updatedAt, so Save Changes' expectedUpdatedAt can be in the body.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/locations';
const tag = () => randomUUID().slice(0, 8);
const PLACEHOLDER = randomUUID();
/** The location record's updatedAt, sent back as expectedUpdatedAt. */
const UPDATED_AT = '2026-01-02T03:04:05.000Z';
const DAY = 24 * 60 * 60_000;
const later = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const details = () => ({
  name: `Fake location ${tag()}`,
  addressLine1: `${tag()} Fake Street`,
  city: 'Fake City',
  state: 'CA',
  postalCode: '95603',
  phone: '+15305550100',
  email: 'office@example.test',
  hours: [{ weekday: 1, opensAt: '09:00', closesAt: '17:00' }],
});

export const records: CaseModule['records'] = {
  /** A Staff member who manages the location. */
  locationManagerUser: {
    async create({ tx, businessId, person }) {
      const login = await person('location-manager', 'STAFF');
      await tx.membership.create({
        data: { businessId, userId: login.id, role: 'STAFF', status: 'ACTIVE' },
      });
      return login.id;
    },
  },
  /** An ACTIVE location (not the primary one) with a manager and a fixed updatedAt. */
  location: {
    async create({ tx, businessId, get }) {
      const row = await tx.firmOffice.create({
        data: {
          businessId,
          name: `Fake location ${tag()}`,
          addressLine1: `${tag()} Fake Road`,
          city: 'Fake City',
          state: 'CA',
          postalCode: '95603',
          phone: '+15305550100',
          email: 'office@example.test',
          managerUserId: await get('locationManagerUser'),
          updatedAt: new Date(UPDATED_AT),
        },
      });
      return row.id;
    },
  },
  /** A pending Reassign Manager of the location, a month ahead. */
  locationAction: {
    async create({ tx, businessId, get, owner }) {
      const row = await tx.firmOfficeAction.create({
        data: {
          businessId,
          kind: 'REASSIGN_MANAGER',
          officeId: await get('location'),
          managerUserId: await get('locationManagerUser'),
          newManagerUserId: await get('adminUser'),
          effectiveAt: new Date(Date.now() + 30 * DAY),
          createdByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}`]: {
    params: {},
    bodyIds: {
      managerUserId: 'adminUser',
      staffUserIds: 'staffUser',
      serviceIds: 'catalogPackageService',
    },
    body: () => ({
      ...details(),
      managerUserId: PLACEHOLDER,
      staffUserIds: [PLACEHOLDER],
      serviceIds: [PLACEHOLDER],
    }),
  },
  [`GET ${BASE}/:id`]: { params: { id: 'location' } },
  [`PATCH ${BASE}/:id`]: {
    params: { id: 'location' },
    bodyIds: { staffUserIds: 'staffUser', serviceIds: 'catalogPackageService' },
    body: () => ({
      ...details(),
      staffUserIds: [PLACEHOLDER],
      serviceIds: [PLACEHOLDER],
      expectedUpdatedAt: UPDATED_AT,
    }),
  },
  [`POST ${BASE}/:id/primary`]: { params: { id: 'location' } },
  // Already ACTIVE: nothing to do.
  [`POST ${BASE}/:id/activate`]: { params: { id: 'location' } },
  // Now: the location becomes INACTIVE.
  [`POST ${BASE}/:id/deactivate`]: { params: { id: 'location' }, body: {} },
  [`POST ${BASE}/:id/manager`]: {
    params: { id: 'location' },
    bodyIds: { managerUserId: 'adminUser' },
    body: { managerUserId: PLACEHOLDER },
  },
  [`PUT ${BASE}/:id/staff`]: {
    params: { id: 'location' },
    bodyIds: { staffUserIds: 'staffUser' },
    body: { staffUserIds: [PLACEHOLDER] },
  },
  [`POST ${BASE}/:id/photo/uploads`]: {
    params: { id: 'location' },
    body: {
      fileName: 'Fake photo.png',
      contentType: 'image/png',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  // Found, but the ticket is not one the API sealed: 410 UPLOAD_EXPIRED.
  [`POST ${BASE}/:id/photo/uploads/confirm`]: {
    params: { id: 'location' },
    body: { uploadToken: 'fake-upload-token' },
    expect: 410,
  },
  // No photo yet: removing is harmless.
  [`DELETE ${BASE}/:id/photo`]: { params: { id: 'location' } },
  [`POST ${BASE}/managers/:userId/deactivate`]: {
    params: { userId: 'locationManagerUser' },
    bodyIds: { replacementUserId: 'adminUser' },
    body: { replacementUserId: PLACEHOLDER },
  },
  [`PATCH ${BASE}/actions/:id`]: {
    params: { id: 'locationAction' },
    bodyIds: { newManagerUserId: 'adminUser' },
    body: () => ({ effectiveAt: later(40), newManagerUserId: PLACEHOLDER }),
  },
  [`POST ${BASE}/actions/:id/cancel`]: { params: { id: 'locationAction' } },
};
