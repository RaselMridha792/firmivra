import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createRequest,
  createTaxStatusesClient,
  parseInput,
  TaxStatusName,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const bodyOf = (init: RequestInit | undefined): unknown =>
  init?.body === undefined ? undefined : JSON.parse(init.body as string);

const id = '0199b6a0-0000-7000-8000-000000000001';
const row = {
  id,
  name: 'Filed',
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z',
};
const client = (fn: typeof fetch) =>
  createTaxStatusesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('parseInput', () => {
  it('returns the parsed value, or throws ApiRequestError 400 with the first message', () => {
    expect(parseInput(TaxStatusName, '  Filed ')).toBe('Filed');
    const error = (() => {
      try {
        parseInput(TaxStatusName, '');
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Enter a name',
    });
  });
});

describe('api.taxStatuses', () => {
  it('lists active statuses, or all with includeArchived, and returns the rows', async () => {
    const { fn, calls } = fakeFetch(200, { items: [row] });
    await expect(client(fn).list()).resolves.toEqual([row]);
    await client(fn).list({ includeArchived: true });
    expect(calls[0]?.url).toBe('/api/v1/business/tax-statuses');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.credentials).toBe('include');
    expect(calls[1]?.url).toBe('/api/v1/business/tax-statuses?includeArchived=true');
  });

  it('creates, renames, reorders and archives with the right method, path and body', async () => {
    const { fn, calls } = fakeFetch(200, row);
    await client(fn).create({ name: '  Filed ' });
    await client(fn).rename(id, { name: 'Filed' });
    await client(fn).archive(id);
    const list = fakeFetch(200, { items: [row] });
    await expect(client(list.fn).reorder([id])).resolves.toEqual([row]);

    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST /api/v1/business/tax-statuses',
      `PATCH /api/v1/business/tax-statuses/${id}`,
      `POST /api/v1/business/tax-statuses/${id}/archive`,
    ]);
    expect(bodyOf(calls[0]?.init)).toEqual({ name: 'Filed' });
    expect(calls[2]?.init.body).toBeUndefined();
    expect(`${list.calls[0]?.init.method} ${list.calls[0]?.url}`).toBe(
      'PUT /api/v1/business/tax-statuses/order',
    );
    expect(bodyOf(list.calls[0]?.init)).toEqual({ ids: [id] });
  });

  it('rejects bad input before any request, with the same error as the API', async () => {
    const { fn, calls } = fakeFetch(200, row);
    for (const attempt of [
      client(fn).create({ name: '   ' }),
      client(fn).rename(id, { name: 'x'.repeat(121) }),
      client(fn).reorder([id, id]),
      client(fn).reorder(['not-an-id']),
    ]) {
      const error = await attempt.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(400);
      expect((error as ApiRequestError).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it('sends the cleaned rename body and encodes the id in the path', async () => {
    const { fn, calls } = fakeFetch(200, row);
    await client(fn).rename(id, { name: '  In review  ' });
    expect(bodyOf(calls[0]?.init)).toEqual({ name: 'In review' });
    await client(fn)
      .archive('a/b?c')
      .catch(() => undefined);
    expect(calls[1]?.url).toBe('/api/v1/business/tax-statuses/a%2Fb%3Fc/archive');
  });

  it('turns API errors into ApiRequestError with the code', async () => {
    const { fn } = fakeFetch(409, {
      error: { code: 'DUPLICATE_NAME', message: 'A tax status with this name already exists' },
    });
    const error = await client(fn)
      .create({ name: 'Filed' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(409);
    expect((error as ApiRequestError).code).toBe('DUPLICATE_NAME');
  });
});
