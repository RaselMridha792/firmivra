import { describe, expect, it } from 'vitest';
import {
  Calculator,
  CALCULATOR_DEFAULT_TEXT,
  CALCULATOR_SLUGS,
  CalculatorKey,
  CalculatorMoney,
  calculatorKeyFromSlug,
  createCalculatorsClient,
  createMyCalculatorsClient,
  createRequest,
  FILING_STATUS_LABELS,
  FilingStatus,
  FirmCalculator,
  UpdateCalculatorRequest,
} from '../../src/index.js';

function fakeFetch(body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('keys, slugs and filing statuses', () => {
  it('has the three calculators and their URL segments', () => {
    expect(CalculatorKey.options).toEqual(['tax_return', 'quarterly_estimate', 'tax_bracket']);
    expect(CALCULATOR_SLUGS).toEqual({
      tax_return: 'tax-return',
      quarterly_estimate: 'quarterly-estimate',
      tax_bracket: 'tax-bracket',
    });
    for (const key of CalculatorKey.options) {
      expect(calculatorKeyFromSlug(CALCULATOR_SLUGS[key])).toBe(key);
    }
    for (const bad of ['tax_bracket', 'Tax-Bracket', 'tax-bracket/', '', 'mortgage', '__proto__']) {
      expect(calculatorKeyFromSlug(bad), bad).toBeNull();
    }
  });

  it('has all five filing statuses, QSS included, with the guides’ labels', () => {
    expect(FilingStatus.options).toEqual([
      'SINGLE',
      'MARRIED_JOINT',
      'MARRIED_SEPARATE',
      'HEAD_OF_HOUSEHOLD',
      'QUALIFYING_SURVIVING_SPOUSE',
    ]);
    expect(FILING_STATUS_LABELS.QUALIFYING_SURVIVING_SPOUSE).toBe('Qualifying Surviving Spouse');
  });
});

describe('the calculator on the wire', () => {
  const calc = {
    key: 'tax_bracket',
    title: 'Federal Tax Bracket Calculator',
    disclaimer: 'x',
    taxYear: 2026,
  };

  it('is key, title, disclaimer and tax year, with no figures', () => {
    expect(Calculator.parse(calc)).toEqual(calc);
    expect(FirmCalculator.parse({ ...calc, enabled: true, sortOrder: 2 })).toMatchObject(calc);
    expect(Calculator.safeParse({ ...calc, taxYear: 2025 }).success).toBe(false);
    expect(Calculator.safeParse({ ...calc, key: 'mortgage' }).success).toBe(false);
    expect(Calculator.safeParse({ key: 'tax_bracket', title: 't', disclaimer: 'd' }).success).toBe(
      false,
    );
    expect(FirmCalculator.safeParse(calc).success).toBe(false);
  });

  it('has a default title and Octavia’s disclaimer for every key, in list order', () => {
    expect(Object.keys(CALCULATOR_DEFAULT_TEXT)).toEqual(CalculatorKey.options);
    expect(CalculatorKey.options.map((k) => CALCULATOR_DEFAULT_TEXT[k].sortOrder)).toEqual([
      0, 1, 2,
    ]);
    for (const key of CalculatorKey.options) {
      const d = CALCULATOR_DEFAULT_TEXT[key];
      // The defaults fit what an Owner could send back.
      expect(UpdateCalculatorRequest.parse({ title: d.title, disclaimer: d.disclaimer })).toEqual({
        title: d.title,
        disclaimer: d.disclaimer,
      });
      expect(d.disclaimer.startsWith('This calculator provides an estimate')).toBe(true);
      expect(d.title).not.toMatch(/2026/); // the screen prefixes the tax year
    }
  });

  it('the update request is unchanged: strict, at least one field, no figures', () => {
    for (const bad of [{}, { config: {} }, { taxYear: 2027 }, { title: '' }, { enabled: 'no' }]) {
      expect(UpdateCalculatorRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('CalculatorMoney', () => {
  it('takes 0 to $100,000,000 with at most 2 decimals', () => {
    for (const ok of [0, 0.01, 0.1 + 0.2, 12_400.5, 99_999_999.99, 100_000_000]) {
      expect(CalculatorMoney.safeParse(ok).success, String(ok)).toBe(true);
    }
    for (const bad of [-0.01, -1, 100_000_000.01, 1.005, 0.001, NaN, Infinity, '100', null]) {
      expect(CalculatorMoney.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe('calculator clients', () => {
  it("reads the firm's calculators in the portal", async () => {
    const { fn, calls } = fakeFetch({ items: [] });
    const client = createMyCalculatorsClient(createRequest({ baseUrl: '', fetch: fn }), 'lvp');
    await client.list();
    expect(calls.map((c) => c.url)).toEqual(['/portal/lvp/me/calculators']);
  });

  it('gets one by key and refuses an unknown key before any call', async () => {
    const one = { key: 'tax_bracket', title: 't', disclaimer: 'd', taxYear: 2026 };
    const { fn, calls } = fakeFetch(one);
    const client = createMyCalculatorsClient(createRequest({ baseUrl: '', fetch: fn }), 'lvp');
    expect(await client.get('tax_bracket')).toEqual(one);
    await expect(client.get('tax-bracket')).rejects.toThrow();
    expect(calls.map((c) => c.url)).toEqual(['/portal/lvp/me/calculators/tax_bracket']);
  });

  it('patches the new keys on the firm route', async () => {
    const firm = {
      key: 'quarterly_estimate',
      title: 't',
      disclaimer: 'd',
      taxYear: 2026,
      enabled: false,
      sortOrder: 1,
    };
    const { fn, calls } = fakeFetch(firm);
    const client = createCalculatorsClient(createRequest({ baseUrl: '', fetch: fn }));
    expect(await client.update('quarterly_estimate', { enabled: false })).toEqual(firm);
    expect(calls).toEqual([
      {
        url: '/business/calculators/quarterly_estimate',
        method: 'PATCH',
        body: { enabled: false },
      },
    ]);
  });
});
