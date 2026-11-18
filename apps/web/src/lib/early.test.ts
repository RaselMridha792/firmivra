import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropEarly, sameRequest, startEarly, takeEarly, takePageCall } from './early';

// Dashboard Review Two V8: a call started early is handed out once; a failed or old one, or none,
// means the caller's own call runs, so the caller always gets what its call would have given.

afterEach(() => {
  dropEarly();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What the page's first script leaves on the window (pageCallsScript). */
function pageCalls(urls: string[], at = Date.now()) {
  vi.stubGlobal('window', globalThis);
  const responses = urls.map((url) => ({ url, response: Promise.resolve(new Response(url)) }));
  (globalThis as { __fvEarly?: unknown }).__fvEarly = { at, calls: responses };
}

describe('early calls', () => {
  it('hands the started call to the first taker only, without calling again', async () => {
    const early = vi.fn(() => Promise.resolve('early'));
    const own = vi.fn(() => Promise.resolve('own'));
    startEarly('k', early);
    await expect(takeEarly('k', own)).resolves.toBe('early');
    await expect(takeEarly('k', own)).resolves.toBe('own');
    expect(early).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('does not start a second call while one is waiting', () => {
    const early = vi.fn(() => Promise.resolve(1));
    startEarly('k', early);
    startEarly('k', early);
    expect(early).toHaveBeenCalledTimes(1);
  });

  it("runs the taker's own call when the early one failed, and never leaves a rejection unhandled", async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      startEarly('k', () => Promise.reject(new Error('401 before the session was renewed')));
      startEarly('nobody-takes-it', () => Promise.reject(new Error('the page changed')));
      await expect(takeEarly('k', () => Promise.resolve('own'))).resolves.toBe('own');
      await new Promise((done) => setTimeout(done, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('calls again when the early call is older than 15 seconds', async () => {
    vi.useFakeTimers();
    startEarly('k', () => Promise.resolve('stale'));
    vi.advanceTimersByTime(15_000);
    await expect(takeEarly('k', () => Promise.resolve('fresh'))).resolves.toBe('fresh');
  });

  it('forgets every early call on sign-out', async () => {
    startEarly('k', () => Promise.resolve("the last person's"));
    dropEarly();
    await expect(takeEarly('k', () => Promise.resolve('mine'))).resolves.toBe('mine');
  });

  it('with nothing started, runs the own call', async () => {
    await expect(takeEarly('none', () => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe("the page's first script's responses (V8)", () => {
  it('hands each to the first request for the same GET, in any query order, and only once', async () => {
    pageCalls(['/api/v1/business/message-threads?limit=5&b=2', '/api/v1/me']);
    const first = takePageCall('/api/v1/business/message-threads?b=2&limit=5');
    await expect(first?.then((r) => r.text())).resolves.toBe(
      '/api/v1/business/message-threads?limit=5&b=2',
    );
    expect(takePageCall('/api/v1/business/message-threads?b=2&limit=5')).toBeUndefined();
    expect(takePageCall('/api/v1/business/message-threads?limit=6&b=2')).toBeUndefined();
    expect(takePageCall('/api/v1/me')).toBeDefined();
  });

  it('hands out none older than 15 seconds, none after sign-out, and none outside a browser', () => {
    pageCalls(['/api/v1/me'], Date.now() - 15_000);
    expect(takePageCall('/api/v1/me')).toBeUndefined();
    pageCalls(['/api/v1/me']);
    dropEarly();
    expect(takePageCall('/api/v1/me')).toBeUndefined();
    vi.unstubAllGlobals();
    expect(takePageCall('/api/v1/me')).toBeUndefined();
  });

  it('compares a path and its query, decoded, whatever the order', () => {
    expect(sameRequest('/a?to=2026-12-03T14%3A30%3A00.000Z&from=x')).toBe(
      sameRequest('/a?from=x&to=2026-12-03T14:30:00.000Z'),
    );
    expect(sameRequest('/a?x=1')).not.toBe(sameRequest('/b?x=1'));
  });
});
