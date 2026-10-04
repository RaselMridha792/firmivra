import { describe, expect, it } from 'vitest';
import { ApiRequestError, createApiClient } from '../src/index.js';

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
