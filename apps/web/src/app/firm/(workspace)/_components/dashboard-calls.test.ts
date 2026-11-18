import {
  createApiClient,
  createAppointmentsClient,
  createAvailabilityClient,
  createDashboardClient,
  createMessagesClient,
  createRequest,
} from '@firmivra/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageCallsScript, sameRequest } from '../../../../lib/early';
import { pageCallUrls, summaryQueryOf, upcomingWindow } from './dashboard-calls';
import { DEFAULT_PLACE } from './dashboard-place';

// Dashboard Review Two V8: the page's first script sends exactly the GETs the API client sends
// for the user, the firm and each dashboard widget, so every one of them is taken, not sent twice.

const AT = Date.parse('2026-11-18T14:30:42.123Z');

/** The URLs the page's first script sends at `AT` on `pathname` with `search`. */
function scriptUrls(pathname: string, search = ''): string[] {
  const sent: string[] = [];
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { pathname, search });
  vi.stubGlobal('fetch', (url: string) => {
    sent.push(url);
    return Promise.resolve(new Response('{}'));
  });
  new Function(pageCallsScript(pageCallUrls()))();
  return sent;
}

/** The URLs the API client sends for the same calls (its own query building and defaults). */
async function clientUrls(): Promise<string[]> {
  const sent: string[] = [];
  const options = {
    baseUrl: '/api/v1',
    fetch: (input: RequestInfo | URL) => {
      sent.push(String(input));
      return Promise.reject(new Error('not sent in this test'));
    },
  };
  const request = createRequest(options);
  const calls: Promise<unknown>[] = [
    createApiClient(options).me(),
    createApiClient(options).currentBusiness(),
    createDashboardClient(request).summary(summaryQueryOf(DEFAULT_PLACE)),
    createAvailabilityClient(request).get(),
    createMessagesClient(request).inbox({ limit: 5 }),
    createAppointmentsClient(request).list(upcomingWindow(AT)),
  ];
  await Promise.allSettled(calls);
  return sent;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as { __fvEarly?: unknown }).__fvEarly;
});

describe("the page's first script (V8)", () => {
  it('sends, on a plain /, the very GETs the API client sends for the user, the firm and each widget', async () => {
    const page = scriptUrls('/').map(sameRequest).sort();
    const client = (await clientUrls()).map(sameRequest).sort();
    expect(page).toEqual(client);
    expect(page).toHaveLength(6);
  });

  it('sends only the user and the firm on any other page, or on / with periods in the address', () => {
    expect(scriptUrls('/clients')).toEqual(['/api/v1/me', '/api/v1/business']);
    expect(scriptUrls('/', '?period=LAST_MONTH')).toEqual(['/api/v1/me', '/api/v1/business']);
  });

  it('asks Upcoming Appointments for 15 days from the start of the minute, as the screen does', () => {
    expect(upcomingWindow(AT)).toEqual({
      from: '2026-11-18T14:30:00.000Z',
      to: '2026-12-03T14:30:00.000Z',
    });
    expect(upcomingWindow(AT + 17_000)).toEqual(upcomingWindow(AT));
  });
});
