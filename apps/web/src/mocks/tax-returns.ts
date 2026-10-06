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
import { clientFixtures } from './clients';

/**
 * Mock data for `api.taxReturns` and `api.myTaxReturns(slug)` (R10), shaped like the Taxes tab
 * mockup. Synthetic data only. Same input checks, rules and error codes as the API.
 */
const at = '2026-10-01T09:00:00.000Z';
const client = clientFixtures[0]!.id;
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

export const taxReturnFixtures: readonly TaxReturn[] = [
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

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
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

/** An in-memory `api.taxReturns`. */
export function createTaxReturnsMock(): TaxReturnsClient {
  let rows: TaxReturn[] = taxReturnFixtures.map((r) => structuredClone(r));
  let nextId = 100;
  const find = (id: string) => {
    const row = rows.find((r) => r.id === parseInput(TaxReturnId, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const save = (row: TaxReturn) => {
    checkFiled(row);
    rows = [...rows.filter((r) => r.id !== row.id), row];
    return structuredClone(row);
  };

  return {
    listForClient: async (clientId) => {
      await pause();
      const id = parseInput(ClientId, clientId);
      return rows
        .filter((r) => r.clientId === id)
        .sort(order)
        .map((r) => structuredClone(r));
    },
    create: async (body) => {
      await pause();
      const { documentId, ...data } = parseInput(CreateTaxReturnRequest, body);
      return save(
        fixture(nextId++, {
          formType: null,
          ...data,
          document: documentRef(documentId, null),
          createdAt: now(),
          updatedAt: now(),
        }),
      );
    },
    update: async (id, body) => {
      await pause();
      const { documentId, ...data } = parseInput(UpdateTaxReturnRequest, body);
      const row = find(id);
      return save({
        ...row,
        ...data,
        document: documentRef(documentId, row.document),
        updatedAt: now(),
      });
    },
    remove: async (id) => {
      await pause();
      const row = find(id);
      if (row.status !== 'IN_PROGRESS') {
        throw fail(409, 'RETURN_LOCKED', 'Only a return in progress can be deleted');
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
      return taxReturnFixtures
        .filter((r) => r.clientId === client)
        .filter((r) => q.taxYear === undefined || r.taxYear === q.taxYear)
        .filter((r) => !q.kind || (q.kind === 'quarterly') === (r.quarter !== null))
        .filter((r) => !q.filingType || r.filingType === q.filingType)
        .sort(order)
        .map((r): MyTaxReturn => ({
          id: r.id,
          taxYear: r.taxYear,
          filingType: r.filingType,
          quarter: r.quarter,
          formType: r.formType,
          status: r.status,
          filedOn: r.filedOn,
          document: r.document && { ...r.document },
        }));
    },
  };
}
