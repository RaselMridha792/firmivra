// Staff Management (R55): one member by id, and the changes (Create and Edit Staff, the account
// actions, permissions, notes, pay and drafts). A write case runs in a fresh world, so one record
// serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/staff';
const tag = () => randomUUID().slice(0, 8);
const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /** An open session of staffMembership (Active Sessions). */
  staffSession: {
    async create({ tx, businessId, get }) {
      const row = await tx.staffSession.create({
        data: {
          businessId,
          membershipId: await get('staffMembership'),
          tokenHash: randomUUID().replace(/-/g, '').repeat(2),
          device: 'Fake browser',
        },
        select: { id: true },
      });
      return row.id;
    },
  },
  /** A file kept for staffMembership, still waiting for its scan. */
  staffDocument: {
    async create({ tx, businessId, get }) {
      const membershipId = await get('staffMembership');
      const row = await tx.staffDocument.create({
        data: {
          businessId,
          membershipId,
          type: 'W4',
          fileName: 'Fake W-4.pdf',
          contentType: 'application/pdf',
          sizeBytes: 9,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${businessId}/staff/${membershipId}/${randomUUID()}`,
        },
        select: { id: true },
      });
      return row.id;
    },
  },
  /** Another active member: a supervisor, or the grid to copy from. */
  staffSupervisor: {
    async create({ tx, businessId, person }) {
      const login = await person('supervisor', 'STAFF');
      const m = await tx.membership.create({
        data: { businessId, userId: login.id, role: 'MANAGER', status: 'ACTIVE' },
        select: { id: true },
      });
      return m.id;
    },
  },
  /** A second active team, for Backup Team. */
  staffTeamBackup: {
    async create({ tx, businessId, get }) {
      const row = await tx.team.create({
        data: {
          businessId,
          departmentId: await get('staffDepartment'),
          name: `Fake backup team ${tag()}`,
        },
        select: { id: true },
      });
      return row.id;
    },
  },
  /** A saved Create Staff form (no account, no invite). */
  staffDraft: {
    async create({ tx, businessId, get }) {
      const owner = await tx.membership.findFirstOrThrow({
        where: { businessId, role: 'OWNER' },
        select: { id: true },
      });
      await get('staffDepartment');
      const row = await tx.staffDraft.create({
        data: { businessId, createdById: owner.id, step: 1, data: {} },
        select: { id: true },
      });
      return row.id;
    },
  },
};

const details = {
  supervisorId: PLACEHOLDER,
  primaryTeamId: PLACEHOLDER,
  backupTeamId: PLACEHOLDER,
};
const detailIds = {
  'account.departmentIds': 'staffDepartment',
  'account.customRoleId': 'customRole',
  'details.supervisorId': 'staffSupervisor',
  'details.primaryTeamId': 'staffTeam',
  'details.backupTeamId': 'staffTeamBackup',
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/:id`]: { params: { id: 'staffMembership' } },
  [`GET ${BASE}/:id/permissions`]: { params: { id: 'staffMembership' } },
  [`POST ${BASE}`]: {
    params: {},
    bodyIds: { ...detailIds, draftId: 'staffDraft' },
    body: () => ({
      idempotencyKey: randomUUID(),
      account: {
        firstName: 'Fake',
        lastName: `Hire ${tag()}`,
        email: `fake-hire-${tag()}@isolation.test`,
        departmentIds: [PLACEHOLDER],
        jobTitle: 'Tax Preparer',
        role: 'TAX_PREPARER',
        customRoleId: PLACEHOLDER,
      },
      details,
      draftId: PLACEHOLDER,
      sendWelcomeEmail: false,
    }),
  },
  // GET's version is not known here: firm P's own people get 409 SAVE_CONFLICT, after the ids.
  [`PATCH ${BASE}/:id`]: {
    params: { id: 'staffMembership' },
    bodyIds: detailIds,
    body: {
      version: 'stale',
      account: { departmentIds: [PLACEHOLDER], customRoleId: PLACEHOLDER },
      details,
    },
    expect: 409,
  },
  [`POST ${BASE}/:id/lock`]: {
    params: { id: 'staffMembership' },
    body: { reason: 'Fake reason', confirm: true },
  },
  [`POST ${BASE}/:id/unlock`]: { params: { id: 'staffMembership' } },
  [`POST ${BASE}/:id/deactivate`]: {
    params: { id: 'staffMembership' },
    body: { confirm: true },
  },
  [`POST ${BASE}/:id/reactivate`]: { params: { id: 'staffMembership' } },
  // Found, but an active member has no open invite.
  [`POST ${BASE}/:id/invite/resend`]: { params: { id: 'staffMembership' }, expect: 409 },
  [`POST ${BASE}/:id/invite/revoke`]: { params: { id: 'staffMembership' }, expect: 409 },
  [`PUT ${BASE}/:id/permissions`]: { params: { id: 'staffMembership' }, body: { grants: [] } },
  [`PATCH ${BASE}/:id/permissions`]: {
    params: { id: 'staffMembership' },
    body: { overrides: [{ module: 'REPORTS', capability: 'VIEW', mode: 'INHERIT' }] },
  },
  [`POST ${BASE}/:id/permissions/copy-from/:fromId`]: {
    params: { id: 'staffMembership', fromId: 'staffSupervisor' },
  },
  [`GET ${BASE}/:id/notes`]: { params: { id: 'staffMembership' } },
  [`PUT ${BASE}/:id/notes`]: { params: { id: 'staffMembership' }, body: { text: 'Fake note' } },
  [`GET ${BASE}/:id/compensation`]: { params: { id: 'staffMembership' } },
  [`PUT ${BASE}/:id/compensation`]: {
    params: { id: 'staffMembership' },
    body: { payType: 'HOURLY', rateCents: 2500 },
  },
  [`GET ${BASE}/:id/security`]: { params: { id: 'staffMembership' } },
  [`PUT ${BASE}/:id/security`]: {
    params: { id: 'staffMembership' },
    body: { autoLogoutMinutes: 30 },
  },
  [`GET ${BASE}/:id/sessions`]: { params: { id: 'staffMembership' } },
  [`POST ${BASE}/:id/sessions/:sessionId/revoke`]: {
    params: { id: 'staffMembership', sessionId: 'staffSession' },
  },
  [`POST ${BASE}/:id/sessions/revoke-all`]: {
    params: { id: 'staffMembership' },
    body: { confirm: true },
  },
  [`GET ${BASE}/:id/login-history`]: { params: { id: 'staffMembership' } },
  [`GET ${BASE}/:id/activity`]: { params: { id: 'staffMembership' } },
  [`POST ${BASE}/:id/reset-password`]: {
    params: { id: 'staffMembership' },
    body: { confirm: true },
  },
  [`POST ${BASE}/:id/reset-mfa`]: { params: { id: 'staffMembership' }, body: { confirm: true } },
  [`GET ${BASE}/:id/documents`]: { params: { id: 'staffMembership' } },
  [`POST ${BASE}/:id/documents/uploads`]: {
    params: { id: 'staffMembership' },
    bodyIds: { replacesId: 'staffDocument' },
    body: {
      type: 'W4',
      fileName: 'Fake W-4.pdf',
      contentType: 'application/pdf',
      sizeBytes: 9,
      sha256: 'b'.repeat(64),
      replacesId: PLACEHOLDER,
    },
  },
  // Found, but the token opens nothing: 410 UPLOAD_EXPIRED.
  [`POST ${BASE}/:id/documents/uploads/confirm`]: {
    params: { id: 'staffMembership' },
    body: { uploadToken: 'fake-upload-token' },
    expect: 410,
  },
  // Found, but still being scanned.
  [`GET ${BASE}/:id/documents/:docId/download`]: {
    params: { id: 'staffMembership', docId: 'staffDocument' },
    expect: 409,
  },
  [`PATCH ${BASE}/:id/documents/:docId`]: {
    params: { id: 'staffMembership', docId: 'staffDocument' },
    body: { type: 'NDA' },
  },
  [`POST ${BASE}/:id/documents/:docId/archive`]: {
    params: { id: 'staffMembership', docId: 'staffDocument' },
  },
  ['GET /api/v1/business/staff-drafts/:id']: { params: { id: 'staffDraft' } },
  ['PUT /api/v1/business/staff-drafts/:id']: {
    params: { id: 'staffDraft' },
    body: { step: 2, data: {} },
  },
  ['DELETE /api/v1/business/staff-drafts/:id']: { params: { id: 'staffDraft' } },
};
