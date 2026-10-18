// Reports (R55): saved reports, scheduled reports, runs and the ids a report request names (a saved
// report to run, export or schedule, a client or service in the quick filters, people to share with
// or send to). A write case runs in a fresh world, so one record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a PATCH case can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();
const PLACEHOLDER = randomUUID();

const definition = {
  category: 'CLIENT',
  dataSource: 'clients',
  columns: ['name', 'status'],
  date: { rule: 'ROLLING', preset: 'this_year' },
};

export const records: CaseModule['records'] = {
  reportSaved: {
    async create({ tx, businessId, owner }) {
      const row = await tx.reportDefinition.create({
        data: {
          businessId,
          name: `Fake report ${tag()}`,
          category: 'CLIENT',
          dataSource: 'clients',
          columns: ['name', 'status'],
          filters: [],
          dateRule: 'ROLLING',
          datePreset: 'this_year',
          chartType: 'auto',
          visibility: 'COMPANY',
          ownerUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      return row.id;
    },
  },
  reportSchedule: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.reportSchedule.create({
        data: {
          businessId,
          definitionId: await get('reportSaved'),
          name: `Fake schedule ${tag()}`,
          frequency: 'DAILY',
          runTime: new Date('1970-01-01T08:00:00.000Z'),
          timezone: 'America/New_York',
          datePreset: 'last_month',
          formats: ['CSV'],
          deliverEmail: true,
          ownerUserId: owner.id,
          nextRunAt: new Date(Date.now() + 86_400_000),
        },
      });
      await tx.reportScheduleRecipient.create({
        data: { businessId, scheduleId: row.id, userId: owner.id },
      });
      return row.id;
    },
  },
  reportRun: {
    async create({ tx, businessId, owner, get }) {
      const now = new Date();
      const row = await tx.reportRun.create({
        data: {
          businessId,
          definitionId: await get('reportSaved'),
          kind: 'EXPORT',
          status: 'SUCCEEDED',
          format: 'CSV',
          requestedByUserId: owner.id,
          s3Key: `tenant/${businessId}/reports/${randomUUID()}.csv`,
          rowCount: 0,
          sensitive: true,
          definitionSnapshot: { title: 'Fake report', fileName: 'fake.csv' },
          startedAt: now,
          finishedAt: now,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/reports/saved/:id`]: { params: { id: 'reportSaved' } },
  [`PATCH ${BASE}/reports/saved/:id`]: {
    params: { id: 'reportSaved' },
    bodyIds: { sharedWithUserIds: 'adminUser' },
    body: { etag: ETAG, description: 'Fake description', visibility: 'SELECTED' },
  },
  [`POST ${BASE}/reports/saved/:id/duplicate`]: { params: { id: 'reportSaved' }, body: {} },
  [`POST ${BASE}/reports/saved/:id/archive`]: { params: { id: 'reportSaved' } },
  [`POST ${BASE}/reports/saved/:id/restore`]: { params: { id: 'reportSaved' } },
  [`PUT ${BASE}/reports/saved/:id/favorite`]: { params: { id: 'reportSaved' } },
  [`DELETE ${BASE}/reports/saved/:id/favorite`]: { params: { id: 'reportSaved' } },
  [`POST ${BASE}/reports/saved`]: {
    params: {},
    bodyIds: { sharedWithUserIds: 'adminUser' },
    body: () => ({ name: `Fake new report ${tag()}`, visibility: 'SELECTED', definition }),
  },
  [`POST ${BASE}/reports/run`]: {
    params: {},
    bodyIds: {
      'target.id': 'reportSaved',
      'quick.clientId': 'client',
      'quick.serviceId': 'service',
      'quick.serviceCategoryId': 'catalogCategory',
      'quick.staffUserId': 'adminUser',
    },
    body: {
      target: { kind: 'SAVED', id: PLACEHOLDER },
      quick: {
        clientId: PLACEHOLDER,
        serviceId: PLACEHOLDER,
        serviceCategoryId: PLACEHOLDER,
        staffUserId: PLACEHOLDER,
      },
    },
  },
  // No file store in tests: the export's file cannot be written, so the run is refused after it is found.
  [`POST ${BASE}/reports/exports`]: {
    params: {},
    bodyIds: {
      'run.target.id': 'reportSaved',
      'run.quick.clientId': 'client',
      'run.quick.serviceId': 'service',
      'run.quick.serviceCategoryId': 'catalogCategory',
      'run.quick.staffUserId': 'adminUser',
    },
    body: {
      run: {
        target: { kind: 'SAVED', id: PLACEHOLDER },
        quick: {
          clientId: PLACEHOLDER,
          serviceId: PLACEHOLDER,
          serviceCategoryId: PLACEHOLDER,
          staffUserId: PLACEHOLDER,
        },
      },
      format: 'CSV',
    },
    expect: 409,
  },
  [`GET ${BASE}/reports/runs/:id`]: { params: { id: 'reportRun' } },
  [`GET ${BASE}/reports/runs/:id/download`]: { params: { id: 'reportRun' } },
  [`POST ${BASE}/reports/schedules`]: {
    params: {},
    bodyIds: { 'target.id': 'reportSaved', recipientUserIds: 'adminUser' },
    body: () => ({
      target: { kind: 'SAVED', id: PLACEHOLDER },
      name: `Fake new schedule ${tag()}`,
      frequency: 'DAILY',
      runTime: '08:00',
      datePreset: 'last_month',
      formats: ['CSV'],
      recipientUserIds: [PLACEHOLDER],
    }),
  },
  [`GET ${BASE}/reports/schedules/:id`]: { params: { id: 'reportSchedule' } },
  [`PATCH ${BASE}/reports/schedules/:id`]: {
    params: { id: 'reportSchedule' },
    bodyIds: { recipientUserIds: 'adminUser' },
    body: { name: 'Fake renamed schedule', recipientUserIds: [PLACEHOLDER] },
  },
  [`DELETE ${BASE}/reports/schedules/:id`]: { params: { id: 'reportSchedule' } },
  [`POST ${BASE}/reports/schedules/:id/pause`]: { params: { id: 'reportSchedule' } },
  [`POST ${BASE}/reports/schedules/:id/resume`]: { params: { id: 'reportSchedule' } },
  [`POST ${BASE}/reports/schedules/:id/duplicate`]: { params: { id: 'reportSchedule' } },
  // No file store in tests: the run's file cannot be written.
  [`POST ${BASE}/reports/schedules/:id/run-now`]: { params: { id: 'reportSchedule' }, expect: 409 },
};
