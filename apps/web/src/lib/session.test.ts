import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionFetch, setSession } from './session';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A signed-in page: its refresh, its API sign-out and where the browser went. */
function signedIn() {
  const replace = vi.fn();
  vi.stubGlobal('window', { location: { replace } });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);
  setSession({ refresh, end, signInPath: '/sign-in' });
  return { replace, refresh, end };
}

describe('sessionFetch (SM4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSession(null);
  });

  it('signs out at once on 401 SESSION_REVOKED: no refresh, the API sign-out, then sign-in', async () => {
    const page = signedIn();
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(answer(401, { error: { code: 'SESSION_REVOKED', message: 'Signed out' } })),
      );
    vi.stubGlobal('fetch', fetch);
    // Two requests at once: one sign-out.
    const [a, b] = await Promise.all([
      sessionFetch('/api/v1/business/clients'),
      sessionFetch('/api/v1/business/tasks'),
    ]);
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(page.refresh).not.toHaveBeenCalled();
    expect(page.end).toHaveBeenCalledTimes(1);
    expect(page.replace).toHaveBeenCalledWith('/sign-in');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes once on any other 401 and sends the request again', async () => {
    const page = signedIn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(answer(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    const res = await sessionFetch('/api/v1/business/clients');
    expect(res.status).toBe(200);
    expect(page.refresh).toHaveBeenCalledTimes(1);
    expect(page.end).not.toHaveBeenCalled();
    expect(page.replace).not.toHaveBeenCalled();
  });

  it('signs out when the request sent again after a refresh is SESSION_REVOKED', async () => {
    const page = signedIn();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(answer(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
        .mockResolvedValueOnce(answer(401, { error: { code: 'SESSION_REVOKED', message: 'x' } })),
    );
    await sessionFetch('/api/v1/business/clients');
    expect(page.end).toHaveBeenCalledTimes(1);
    expect(page.replace).toHaveBeenCalledWith('/sign-in');
  });
});
