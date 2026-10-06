import { ApiRequestError, type TaxStatus, type TaxStatusesClient } from '@firmivra/types';

/**
 * Mock data for `api.taxStatuses` (mock mode: NEXT_PUBLIC_API_MOCK=tax-statuses). Synthetic only.
 * The fixtures follow the API's rules and error codes, so a screen built on them works unchanged
 * against the real API.
 */
const at = '2026-10-06T09:00:00.000Z';
const status = (id: string, name: string, sortOrder: number, archived = false): TaxStatus => ({
  id,
  name,
  sortOrder,
  archivedAt: archived ? at : null,
  createdAt: at,
  updatedAt: at,
});

export const taxStatusFixtures: readonly TaxStatus[] = [
  status('0199b6a0-0000-7000-8000-000000000001', 'Waiting for documents', 0),
  status('0199b6a0-0000-7000-8000-000000000002', 'Documents received', 1),
  status('0199b6a0-0000-7000-8000-000000000003', 'In preparation', 2),
  status('0199b6a0-0000-7000-8000-000000000004', 'Ready for review', 3),
  status('0199b6a0-0000-7000-8000-000000000005', 'Filed', 4),
  status('0199b6a0-0000-7000-8000-000000000006', 'Accepted', 5),
  status('0199b6a0-0000-7000-8000-000000000007', 'Extension filed', 6, true),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/** An in-memory `api.taxStatuses` with the same functions, rules and errors as the API. */
export function createTaxStatusesMock(): TaxStatusesClient {
  let rows = taxStatusFixtures.map((row) => ({ ...row }));
  const active = () =>
    rows.filter((row) => !row.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  const find = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const checkName = (name: string, exceptId?: string) => {
    const clean = name.trim();
    if (!clean || clean.length > 120) throw fail(400, 'VALIDATION_FAILED', 'Enter a name');
    if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === clean.toLowerCase())) {
      throw fail(409, 'DUPLICATE_NAME', 'A tax status with this name already exists');
    }
    return clean;
  };

  return {
    list: async ({ includeArchived = false } = {}) => {
      await pause();
      const shown = includeArchived ? rows : rows.filter((row) => !row.archivedAt);
      return [...shown].sort((a, b) => a.sortOrder - b.sortOrder);
    },
    create: async ({ name }) => {
      await pause();
      const clean = checkName(name);
      if (rows.length >= 500) throw fail(409, 'CONFIGURATION_LIMIT', 'Too many statuses');
      const now = new Date().toISOString();
      const row: TaxStatus = {
        id: crypto.randomUUID(),
        name: clean,
        sortOrder: active().length,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows = [...rows, row];
      return row;
    },
    rename: async (id, { name }) => {
      await pause();
      const row = find(id);
      row.name = checkName(name, id);
      row.updatedAt = new Date().toISOString();
      return { ...row };
    },
    reorder: async (ids) => {
      await pause();
      const current = active();
      const same =
        ids.length === current.length &&
        new Set(ids).size === ids.length &&
        current.every((row) => ids.includes(row.id));
      if (!same) throw fail(409, 'CONFLICT', 'Order must contain every active status exactly once');
      ids.forEach((id, index) => {
        find(id).sortOrder = index;
      });
      return active().map((row) => ({ ...row }));
    },
    archive: async (id) => {
      await pause();
      const row = find(id);
      row.archivedAt ??= new Date().toISOString();
      return { ...row };
    },
  };
}
