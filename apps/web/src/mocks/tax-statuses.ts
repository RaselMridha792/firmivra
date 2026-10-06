import {
  ApiRequestError,
  CreateTaxStatusRequest,
  OrderTaxStatusesRequest,
  parseInput,
  RenameTaxStatusRequest,
  TaxStatus,
  TaxStatusId,
  type TaxStatusesClient,
} from '@firmivra/types';

/**
 * Mock data for `api.taxStatuses`. The web kit's mock mode (NEXT_PUBLIC_API_MOCK) swaps the real
 * client for `createTaxStatusesMock()`. Synthetic data only. It checks input with the same
 * schemas and returns the API's error codes, so a screen built on it works unchanged against
 * the real API.
 */
const at = '2026-10-06T09:00:00.000Z';
const fixture = (n: number, name: string, archived = false): TaxStatus =>
  // Parsed, so a fixture that breaks the contract fails as soon as the mock loads.
  TaxStatus.parse({
    id: `0199b6a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    name,
    sortOrder: n - 1,
    archivedAt: archived ? at : null,
    createdAt: at,
    updatedAt: at,
  });

export const taxStatusFixtures: readonly TaxStatus[] = [
  fixture(1, 'Waiting for documents'),
  fixture(2, 'Documents received'),
  fixture(3, 'In preparation'),
  fixture(4, 'Ready for review'),
  fixture(5, 'Filed'),
  fixture(6, 'Accepted'),
  fixture(7, 'Extension filed', true),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const byOrder = (a: TaxStatus, b: TaxStatus) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

/**
 * An in-memory `api.taxStatuses` with the same functions, rules and errors as the API.
 * `role: 'STAFF'` lets a screen try its read-only state: changes get 403 FORBIDDEN.
 */
export function createTaxStatusesMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): TaxStatusesClient {
  // Rows are replaced, never edited, and callers always get copies, like a real API response.
  let rows: TaxStatus[] = taxStatusFixtures.map((row) => ({ ...row }));
  let nextId = 100;
  const now = () => new Date().toISOString();
  const active = () => rows.filter((row) => !row.archivedAt).sort(byOrder);
  const replace = (row: TaxStatus) => {
    rows = rows.map((r) => (r.id === row.id ? row : r));
    return { ...row };
  };
  const canChange = () => {
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const find = (id: string) => {
    const row = rows.find((r) => r.id === parseInput(TaxStatusId, id));
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const unique = (name: string, exceptId?: string) => {
    const lower = name.toLowerCase();
    if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === lower)) {
      throw fail(409, 'DUPLICATE_NAME', 'A tax status with this name already exists');
    }
  };

  return {
    list: async ({ includeArchived = false } = {}) => {
      await pause();
      return rows
        .filter((row) => includeArchived || !row.archivedAt)
        .sort(byOrder)
        .map((row) => ({ ...row }));
    },
    create: async (body) => {
      await pause();
      canChange();
      const { name } = parseInput(CreateTaxStatusRequest, body);
      unique(name);
      if (rows.length >= 500) {
        throw fail(
          409,
          'CONFIGURATION_LIMIT',
          'The maximum number of status definitions has been reached',
        );
      }
      const last = Math.max(-1, ...active().map((row) => row.sortOrder));
      const row: TaxStatus = {
        id: `0199b6a0-0000-7000-8000-${String(nextId++).padStart(12, '0')}`,
        name,
        sortOrder: last + 1,
        archivedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      rows = [...rows, row];
      return { ...row };
    },
    rename: async (id, body) => {
      await pause();
      canChange();
      const { name } = parseInput(RenameTaxStatusRequest, body);
      const row = find(id);
      unique(name, row.id);
      return replace({ ...row, name, updatedAt: now() });
    },
    reorder: async (ids) => {
      await pause();
      canChange();
      const order = parseInput(OrderTaxStatusesRequest, { ids }).ids;
      order.forEach(find); // an unknown id is 404 before anything else, as in the API
      const current = active();
      if (order.length !== current.length || current.some((row) => !order.includes(row.id))) {
        throw fail(409, 'CONFLICT', 'Order must contain every active status exactly once');
      }
      const stamp = now();
      order.forEach((id, index) => replace({ ...find(id), sortOrder: index, updatedAt: stamp }));
      return active().map((row) => ({ ...row }));
    },
    archive: async (id) => {
      await pause();
      canChange();
      const row = find(id);
      return row.archivedAt ? { ...row } : replace({ ...row, archivedAt: now(), updatedAt: now() });
    },
  };
}
