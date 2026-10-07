import {
  ApiRequestError,
  CalculatorKey,
  type CalculatorsClient,
  FirmCalculator,
  type MyCalculatorsClient,
  parseInput,
  type TaxReturnConfig,
  UpdateCalculatorRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

/**
 * Mock data for `api.calculators` and `api.myCalculators(slug)` (R12): the Tax Return
 * Calculator. Its figures are PLACEHOLDERS (`config.placeholder: true`) until Octavia sends the
 * list; never present them as real tax figures. Run the estimate with `estimateTaxReturn`.
 */
const status = (
  key: TaxReturnConfig['filingStatuses'][number]['status'],
  label: string,
  standardDeduction: number,
  tops: number[],
) => {
  const rates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  return {
    status: key,
    label,
    standardDeduction,
    brackets: rates.map((rate, i) => ({ rate, upTo: tops[i] ?? null })),
  };
};

let fixture: FirmCalculator | undefined;

/** Built on first use: importing this file runs nothing. */
export function taxReturnCalculatorFixture(): FirmCalculator {
  // Parsed, so a fixture that breaks the contract fails on first use.
  fixture ??= FirmCalculator.parse({
    key: 'tax_return',
    title: 'Tax Return Calculator',
    disclaimer:
      'This calculator gives an estimate only and is not tax advice. Your actual tax may differ. Contact LVP Accounting & Taxes for help with your return.',
    enabled: true,
    sortOrder: 0,
    config: {
      taxYear: 2025,
      placeholder: true,
      filingStatuses: [
        status('SINGLE', 'Single', 15_750, [11_925, 48_475, 103_350, 197_300, 250_525, 626_350]),
        status(
          'MARRIED_JOINT',
          'Married filing jointly',
          31_500,
          [23_850, 96_950, 206_700, 394_600, 501_050, 751_600],
        ),
        status(
          'MARRIED_SEPARATE',
          'Married filing separately',
          15_750,
          [11_925, 48_475, 103_350, 197_300, 250_525, 375_800],
        ),
        status(
          'HEAD_OF_HOUSEHOLD',
          'Head of household',
          23_625,
          [17_000, 64_850, 103_350, 197_300, 250_500, 626_350],
        ),
      ],
    },
  });
  return fixture;
}

const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Not found');

/** One store per page load, so turning it off shows in the portal mock. */
let rows: FirmCalculator[] | undefined;
const store = () => (rows ??= [copy(taxReturnCalculatorFixture())]);

/** An in-memory `api.calculators`; `role: 'STAFF'` gets 403 on changes. */
export function createCalculatorsMock(options: { role?: MockFirmRole } = {}): CalculatorsClient {
  return {
    list: async () => {
      await mockDelay();
      return copy(store());
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
    store()
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
