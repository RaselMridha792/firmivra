import { describe, expect, it } from 'vitest';
import {
  contentKindProblem,
  createContentClient,
  createMyContentClient,
  createRequest,
  CreateContentRequest,
  HttpsUrl,
  UpdateContentRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('content rules', () => {
  const link = {
    kind: 'EXTERNAL_LINK',
    category: 'IRS & Business Taxes',
    title: 'IRS Employer Identification Number (EIN)',
    url: 'https://www.irs.gov/ein',
    iconKey: 'irs',
  } as const;

  it('takes https links without a body, and resources with a page key and a body', () => {
    expect(CreateContentRequest.safeParse(link).success).toBe(true);
    for (const url of [
      'http://www.irs.gov/ein',
      'javascript:alert(1)',
      'https://user:pw@irs.gov',
    ]) {
      expect([url, CreateContentRequest.safeParse({ ...link, url }).success]).toEqual([url, false]);
    }
    expect(CreateContentRequest.safeParse({ ...link, body: 'text' }).success).toBe(false);

    const resource = {
      kind: 'RESOURCE',
      category: 'payroll',
      title: 'Payroll Forms',
      body: '- W-4',
    };
    expect(CreateContentRequest.safeParse(resource).success).toBe(true);
    expect(CreateContentRequest.safeParse({ ...resource, category: 'Payroll Forms' }).success).toBe(
      false,
    );
    expect(CreateContentRequest.safeParse({ ...resource, body: undefined }).success).toBe(false);
  });
});

describe('content links and text (#68 review)', () => {
  it('normalizes https links, and refuses credentials, IP addresses and localhost', () => {
    expect(HttpsUrl.parse('HTTPS://WWW.IRS.GOV/ein')).toBe('https://www.irs.gov/ein');
    expect(HttpsUrl.parse('https://irs.gov/a b')).toBe('https://irs.gov/a%20b');
    expect(HttpsUrl.parse(' https://irs.gov/x ')).toBe('https://irs.gov/x');
    for (const url of ['https://user:pw@irs.gov/', 'https://1.2.3.4/x', 'https://localhost/x']) {
      expect([url, HttpsUrl.safeParse(url).success]).toEqual([url, false]);
    }
  });

  it("reads '' as none, and takes only the four resource pages", () => {
    const tip = CreateContentRequest.parse({ kind: 'TIP', title: 'T', body: 'b', description: '' });
    expect(tip.description).toBeNull();
    expect(UpdateContentRequest.parse({ category: '' })).toEqual({ category: null });
    const page = { kind: 'RESOURCE', title: 'T', body: 'b' };
    expect(CreateContentRequest.safeParse({ ...page, category: 'payroll' }).success).toBe(true);
    expect(CreateContentRequest.safeParse({ ...page, category: 'payroll-2' }).success).toBe(false);
    expect(CreateContentRequest.safeParse({ ...page, category: 'payroll', body: '' }).success).toBe(
      false,
    );
  });

  it('checks an edited item against its kind', () => {
    expect(contentKindProblem({ kind: 'EXTERNAL_LINK', url: null })).toBe('Add the link');
    expect(contentKindProblem({ kind: 'TIP', body: 'b' })).toBeNull();
  });
});

describe('content clients', () => {
  it('lists and publishes on the firm side, and reads published items in the portal', async () => {
    const firm = fakeFetch(200, { items: [] });
    await createContentClient(createRequest({ baseUrl: '', fetch: firm.fn })).list({
      kind: 'EXTERNAL_LINK',
    });
    expect(firm.calls[0]?.url).toBe('/business/content?kind=EXTERNAL_LINK');

    const portal = fakeFetch(200, { items: [] });
    await createMyContentClient(createRequest({ baseUrl: '', fetch: portal.fn }), 'lvp').list({
      kind: 'RESOURCE',
      category: 'payroll',
    });
    expect(portal.calls[0]?.url).toBe('/portal/lvp/me/content?kind=RESOURCE&category=payroll');
  });
});
