import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropEarly, startEarly, takeEarly } from './early';

// Dashboard Review Two V8: a call started early is handed out once; a failed or old one, or none,
// means the caller's own call runs, so the caller always gets what its call would have given.

afterEach(() => {
  dropEarly();
  vi.useRealTimers();
});

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
