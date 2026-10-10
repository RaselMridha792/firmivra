import {
  ApiRequestError,
  CALCULATOR_DEFAULT_TEXT,
  CalculatorKey,
  type CalculatorsClient,
  CURRENT_TAX_YEAR,
  FirmCalculator,
  type MyCalculatorsClient,
  parseInput,
  UpdateCalculatorRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

/**
 * Mock data for `api.calculators` and `api.myCalculators(slug)` (R12, then R14 K1): the three
 * calculators with the API's default titles and Octavia's disclaimers, all on. No figures: the
 * 2026 figures are in `@firmivra/types` and the screens run `estimateTaxBracket` in the browser.
 */
let fixtures: FirmCalculator[] | undefined;

/** Built on first use: importing this file runs nothing. */
export function calculatorFixtures(): FirmCalculator[] {
  // Parsed, so a fixture that breaks the contract fails on first use.
  fixtures ??= CalculatorKey.options.map((key) => {
    const { title, disclaimer, sortOrder } = CALCULATOR_DEFAULT_TEXT[key];
    return FirmCalculator.parse({
      key,
      title,
      disclaimer,
      taxYear: CURRENT_TAX_YEAR,
      enabled: true,
      sortOrder,
    });
  });
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Not found');

/** One store per page load, so turning one off shows in the portal mock. */
let rows: FirmCalculator[] | undefined;
const store = () => (rows ??= copy(calculatorFixtures()));
const ordered = (list: FirmCalculator[]) =>
  [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

/** An in-memory `api.calculators`; `role: 'STAFF'` gets 403 on changes. */
export function createCalculatorsMock(options: { role?: MockFirmRole } = {}): CalculatorsClient {
  return {
    list: async () => {
      await mockDelay();
      return copy(ordered(store()));
    },
    update: async (key, body) => {
      await mockDelay();
      const k = parseInput(CalculatorKey, key);
      const input = parseInput(UpdateCalculatorRequest, body);
      if (options.role === 'STAFF') {
        throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
      }
      const c = store().find((x) => x.key === k);
      if (!c) throw notFound();
      Object.assign(c, input);
      return copy(c);
    },
  };
}

/** An in-memory `api.myCalculators(slug)`: enabled calculators only. */
export function createMyCalculatorsMock(): MyCalculatorsClient {
  const visible = () =>
    ordered(store())
      .filter((c) => c.enabled)
      .map(({ enabled: _enabled, sortOrder: _sortOrder, ...rest }) => rest);
  return {
    list: async () => {
      await mockDelay();
      return copy(visible());
    },
    get: async (key) => {
      await mockDelay();
      const k = parseInput(CalculatorKey, key);
      const c = visible().find((x) => x.key === k);
      if (!c) throw notFound();
      return copy(c);
    },
  };
}

let myCalculatorsMocks: Map<string, MyCalculatorsClient> | undefined;

/** `api.myCalculators(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myCalculatorsMock(firmSlug: string): MyCalculatorsClient {
  myCalculatorsMocks ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = myCalculatorsMocks.get(key);
  if (found) return found;
  const created = createMyCalculatorsMock();
  myCalculatorsMocks.set(key, created);
  return created;
}
