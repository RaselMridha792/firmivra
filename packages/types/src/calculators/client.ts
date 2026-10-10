import { type ApiRequest, parseInput } from '../client.js';
import { portalMe } from '../clients/client.js';
import {
  Calculator,
  CalculatorKey,
  CalculatorList,
  FirmCalculator,
  FirmCalculatorList,
  UpdateCalculatorRequest,
} from './schemas.js';

const BASE = '/business/calculators';

/**
 * `api.calculators`: the firm's calculators. Everyone at the firm reads; Owner and Admin turn them
 * on or off and edit the title and disclaimer (403 FORBIDDEN for Staff).
 */
export function createCalculatorsClient(request: ApiRequest) {
  return {
    list: async (): Promise<FirmCalculatorList['items']> =>
      (await request(FirmCalculatorList, BASE)).items,
    update: async (key: string, body: UpdateCalculatorRequest): Promise<FirmCalculator> =>
      request(FirmCalculator, `${BASE}/${parseInput(CalculatorKey, key)}`, {
        method: 'PATCH',
        body: parseInput(UpdateCalculatorRequest, body),
      }),
  };
}
export type CalculatorsClient = ReturnType<typeof createCalculatorsClient>;

/**
 * `api.myCalculators(slug)`: the calculators this firm offers its clients (enabled ones). A key
 * the firm turned off is 404 NOT_FOUND. Estimates run in the browser (`estimateTaxBracket`).
 */
export function createMyCalculatorsClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/calculators`;
  return {
    list: async (): Promise<CalculatorList['items']> =>
      (await request(CalculatorList, base())).items,
    get: async (key: string): Promise<Calculator> =>
      request(Calculator, `${base()}/${parseInput(CalculatorKey, key)}`),
  };
}
export type MyCalculatorsClient = ReturnType<typeof createMyCalculatorsClient>;
