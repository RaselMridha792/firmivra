import { describe, expect, it } from 'vitest';
import { ApiRequestError, createApiClient, retryWhenUnavailable } from '../src/index.js';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('createApiClient', () => {
  it('sends the token and firm, and parses the response', async () => {
    const { fn, calls } = fakeFetch(200, { status: 'ok', db: 'ok' });
    const api = createApiClient({ baseUrl: '/api/v1', token: 't0k', businessId: 'b1', fetch: fn });
    await expect(api.health()).resolves.toEqual({ status: 'ok', db: 'ok' });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe('/api/v1/health');
    expect(headers['authorization']).toBe('Bearer t0k');
    expect(headers['x-business-id']).toBe('b1');
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('turns API errors into ApiRequestError with the error code', async () => {
    const { fn } = fakeFetch(404, {
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r1' },
    });
    const api = createApiClient({ baseUrl: '', fetch: fn });
    await expect(api.me()).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'r1',
    });
    await expect(api.me()).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('rejects a response that does not match the contract', async () => {
    const { fn } = fakeFetch(200, { status: 'great' });
    await expect(createApiClient({ baseUrl: '', fetch: fn }).health()).rejects.toThrow();
  });

  it('lower-cases the email for dev sign-in', async () => {
    const { fn, calls } = fakeFetch(200, {
      token: 'x',
      expiresIn: 3600,
      user: {
        id: '00000000-0000-4000-a000-000000000011',
        email: 'owner@lvp.test',
        name: 'O',
        pool: 'STAFF',
      },
    });
    await createApiClient({ baseUrl: '', fetch: fn }).devToken({ email: 'Owner@LVP.test' });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ email: 'owner@lvp.test' });
  });
});

describe('Retry-After on ApiRequestError', () => {
  const busy = { error: { code: 'SERVICE_UNAVAILABLE', message: 'Busy', requestId: 'r2' } };

  it('carries whole seconds from the header', async () => {
    const { fn } = fakeFetch(503, busy, { 'retry-after': '5' });
    await expect(createApiClient({ baseUrl: '', fetch: fn }).me()).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      retryAfter: 5,
    });
  });

  it.each([
    ['no header', {}],
    ['zero', { 'retry-after': '0' }],
    ['an HTTP date', { 'retry-after': 'Thu, 08 Oct 2026 14:00:00 GMT' }],
    ['a fraction', { 'retry-after': '1.5' }],
    ['too many digits', { 'retry-after': '36000' }],
  ])('leaves it undefined for %s', async (_name, headers: Record<string, string>) => {
    const { fn } = fakeFetch(503, busy, headers);
    const error: unknown = await createApiClient({ baseUrl: '', fetch: fn })
      .me()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).retryAfter).toBeUndefined();
  });
});

describe('retryWhenUnavailable', () => {
  const unavailable = (retryAfter?: number) =>
    new ApiRequestError(503, 'SERVICE_UNAVAILABLE', 'Busy', undefined, retryAfter);

  /** A call that fails with the given errors in turn, then resolves with 'saved'. */
  function failing(...errors: unknown[]) {
    let calls = 0;
    const call = () => {
      const error = errors[calls++];
      return error === undefined ? Promise.resolve('saved') : Promise.reject(error);
    };
    return { call, count: () => calls };
  }
  function waits() {
    const log: number[] = [];
    const wait = (ms: number) => {
      log.push(ms);
      return Promise.resolve();
    };
    return { log, wait };
  }

  it("calls again after each 503's Retry-After, 5 seconds without one", async () => {
    const { call, count } = failing(unavailable(7), unavailable());
    const { log, wait } = waits();
    await expect(retryWhenUnavailable(call, { wait })).resolves.toBe('saved');
    expect(count()).toBe(3);
    expect(log).toEqual([7_000, 5_000]);
  });

  it('waits at most 30 seconds', async () => {
    const { call } = failing(unavailable(3_600));
    const { log, wait } = waits();
    await retryWhenUnavailable(call, { wait });
    expect(log).toEqual([30_000]);
  });

  it('gives up after 3 retries with the last error', async () => {
    const last = unavailable(1);
    const { call, count } = failing(unavailable(), unavailable(), unavailable(), last, undefined);
    const { log, wait } = waits();
    await expect(retryWhenUnavailable(call, { wait })).rejects.toBe(last);
    expect(count()).toBe(4);
    expect(log).toHaveLength(3);
  });

  it.each([
    ['a 500', new ApiRequestError(500, 'INTERNAL', 'Broken')],
    ['a 429', new ApiRequestError(429, 'RATE_LIMITED', 'Slow down', undefined, 5)],
    ['a 409', new ApiRequestError(409, 'CONFLICT', 'Already done')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('rejects %s at once', async (_name, error) => {
    const { call, count } = failing(error);
    const { log, wait } = waits();
    await expect(retryWhenUnavailable(call, { wait })).rejects.toBe(error);
    expect(count()).toBe(1);
    expect(log).toEqual([]);
  });

  it('ends the real wait at once on cancel, without calling again', async () => {
    const { call, count } = failing(unavailable(30));
    const controller = new AbortController();
    const started = Date.now();
    const result = retryWhenUnavailable(call, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(count()).toBe(1);
  });

  it('does not wait when the signal is already cancelled', async () => {
    const { call, count } = failing(unavailable());
    const controller = new AbortController();
    controller.abort();
    await expect(retryWhenUnavailable(call, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(count()).toBe(1);
  });
});
