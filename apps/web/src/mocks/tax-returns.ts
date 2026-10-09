import {
  ApiRequestError,
  ClientId,
  CreateTaxReturnRequest,
  type MyTaxReturn,
  MyTaxReturnsQuery,
  type MyTaxReturnsClient,
  parseInput,
  TaxReturn,
  TaxReturnId,
  type TaxReturnsClient,
  UpdateTaxReturnRequest,
} from '@firmivra/types';
import { clientFixtures, firstClientId, mockStaff, type MockFirmRole } from './clients';

/**
 * Mock data for `api.taxReturns` and `api.myTaxReturns(slug)` (R10), shaped like the Taxes tab
 * mockup. Synthetic data only. Same input checks, rules and error codes as the API.
 */
const at = '2026-10-01T09:00:00.000Z';
const client = firstClientId;
const fixture = (n: number, data: Partial<TaxReturn> & { taxYear: number }): TaxReturn =>
  TaxReturn.parse({
    id: `0199b6a3-0000-7000-8000-${String(n).padStart(12, '0')}`,
    clientId: client,
    engagementId: null,
    filingType: 'INDIVIDUAL',
    quarter: null,
    formType: '1040',
    status: 'COMPLETED',
    filedOn: null,
    document: null,
    createdAt: at,
    updatedAt: at,
    ...data,
  });
const pdf = (n: number, taxYear: number) => ({
  id: `0199b6a3-0000-7000-8000-${String(900 + n).padStart(12, '0')}`,
  fileName: `${taxYear} Tax Return.pdf`,
});

let fixtures: readonly TaxReturn[] | undefined;

/** The first portal client's returns. Built on first use: importing this file runs nothing. */
export function taxReturnFixtures(): readonly TaxReturn[] {
  fixtures ??= [
    fixture(1, { taxYear: 2025, status: 'IN_PROGRESS' }),
    fixture(2, {
      taxYear: 2025,
      quarter: 3,
      formType: '1040-ES',
      status: 'FILED',
      filedOn: '2025-09-15',
    }),
    ...(
      [
        [2024, '2025-04-12'],
        [2023, '2024-04-10'],
        [2022, '2023-03-28'],
        [2021, '2022-03-15'],
        [2020, '2021-03-20'],
      ] as const
    ).map(([taxYear, filedOn], i) =>
      fixture(10 + i, { taxYear, filedOn, document: pdf(i, taxYear) }),
    ),
  ];
  return fixtures;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const now = () => new Date().toISOString();
/** Newest year first; within a year, the annual return before the quarters. */
const order = (a: TaxReturn, b: TaxReturn) =>
  b.taxYear - a.taxYear || (a.quarter ?? 0) - (b.quarter ?? 0);
const checkFiled = (row: TaxReturn) => {
  if ((row.status === 'FILED' || row.status === 'ACCEPTED') && !row.filedOn) {
    throw fail(400, 'VALIDATION_FAILED', 'Enter the date it was filed');
  }
};
/** In the mock any document id is accepted; the API checks it is the client's own and shared. */
const documentRef = (documentId: string | null | undefined, current: TaxReturn['document']) =>
  documentId === undefined
    ? current
    : documentId === null
      ? null
      : { id: documentId, fileName: 'Tax Return.pdf' };

/** An in-memory `api.taxReturns`. `role: 'STAFF'` reaches only Sam Staff's clients. */
export function createTaxReturnsMock(options: { role?: MockFirmRole } = {}): TaxReturnsClient {
  const clients = new Set(
    clientFixtures()
      .filter((c) => options.role !== 'STAFF' || c.assignedTo?.userId === mockStaff.userId)
      .map((c) => c.id),
  );
  let rows: TaxReturn[] = taxReturnFixtures().map((r) => structuredClone(r));
  /** Returns that ever left IN_PROGRESS (the database's first_filed_at). */
  const everFiled = new Set(rows.filter((r) => r.status !== 'IN_PROGRESS').map((r) => r.id));
  let nextId = 100;
  /** The id is already checked. */
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id && clients.has(r.clientId));
    if (!row) throw notFound();
    return row;
  };
  const save = (row: TaxReturn) => {
    checkFiled(row);
    if (row.status !== 'IN_PROGRESS') everFiled.add(row.id);
    rows = [...rows.filter((r) => r.id !== row.id), row];
    return structuredClone(row);
  };

  return {
    listForClient: async (clientId) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      if (!clients.has(id)) throw notFound();
      return rows
        .filter((r) => r.clientId === id)
        .sort(order)
        .map((r) => structuredClone(r));
    },
    create: async (clientId, body) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      const { documentId, ...data } = parseInput(CreateTaxReturnRequest, body);
      if (!clients.has(id)) throw notFound();
      return save(
        fixture(nextId++, {
          formType: null,
          ...data,
          clientId: id,
          document: documentRef(documentId, null),
          createdAt: now(),
          updatedAt: now(),
        }),
      );
    },
    update: async (id, body) => {
      await pause();
      const rid = parseInput(TaxReturnId, id);
      const { documentId, ...data } = parseInput(UpdateTaxReturnRequest, body);
      const row = find(rid);
      if (
        data.status === 'IN_PROGRESS' &&
        (row.status === 'FILED' || row.status === 'ACCEPTED' || row.status === 'COMPLETED')
      ) {
        throw fail(409, 'INVALID_STATUS', 'A filed return cannot go back to in progress');
      }
      const changes = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      return save({
        ...row,
        ...changes,
        document: documentRef(documentId, row.document),
        updatedAt: now(),
      });
    },
    remove: async (id) => {
      await pause();
      const row = find(parseInput(TaxReturnId, id));
      if (row.status !== 'IN_PROGRESS' || everFiled.has(row.id)) {
        throw fail(409, 'RETURN_LOCKED', 'A return that was filed is never deleted');
      }
      rows = rows.filter((r) => r.id !== row.id);
      return { ok: true };
    },
  };
}

/** An in-memory `api.myTaxReturns(slug)` for the first fixture client. */
export function createMyTaxReturnsMock(): MyTaxReturnsClient {
  return {
    list: async (query = {}) => {
      await pause();
      const q = parseInput(MyTaxReturnsQuery, query);
      return taxReturnFixtures()
        .filter((r) => r.clientId === client)
        .filter((r) => q.taxYear === undefined || r.taxYear === q.taxYear)
        .filter((r) => !q.kind || (q.kind === 'quarterly') === (r.quarter !== null))
        .filter((r) => !q.filingType || r.filingType === q.filingType)
        .sort(order)
        .map((r): MyTaxReturn =>
          structuredClone({
            id: r.id,
            taxYear: r.taxYear,
            filingType: r.filingType,
            quarter: r.quarter,
            formType: r.formType,
            status: r.status,
            filedOn: r.filedOn,
            document: r.document,
          }),
        );
    },
  };
}

/** `api.myTaxReturns(slug)` in mock mode (read-only, so one client serves every firm). */
export function myTaxReturnsMock(_firmSlug: string): MyTaxReturnsClient {
  return createMyTaxReturnsMock();
}
