// Dashboard Review Two V8: the firm workspace's first calls start together, as early as they can,
// instead of one after another (the user, then the firm, then each widget). Two steps:
//  - the page's HTML carries a small script (`pageCallsScript`, written out by the workspace
//    layout) that sends the first GETs while the page's code is still downloading; `sessionFetch`
//    hands each response, once, to the API client's own request for the same URL;
//  - as the workspace code loads, `startEarly` calls the API client for each (picking up those
//    responses), and the code that needs a result takes it with `takeEarly`.
// A call that failed (a session renewed in between, say) or is older than a few seconds is called
// again instead, so nothing changes for the code that asks: it gets what its own call would give.

/** An early call older than this is not handed out: it is called again. */
const MAX_AGE_MS = 15_000;

const early = new Map<string, { at: number; promise: Promise<unknown> }>();

/** Starts `run` now under `key`, unless a recent call under that key is still waiting. */
export function startEarly(key: string, run: () => Promise<unknown>): void {
  const waiting = early.get(key);
  if (waiting && Date.now() - waiting.at < MAX_AGE_MS) return;
  const promise = run();
  // Nobody may ever take it (the page changed first): never an unhandled rejection.
  promise.catch(() => undefined);
  early.set(key, { at: Date.now(), promise });
}

/** The call started early under `key` (handed out once), else `run()`; a failed one runs again. */
export function takeEarly<T>(key: string, run: () => Promise<T>): Promise<T> {
  const waiting = early.get(key);
  early.delete(key);
  if (!waiting || Date.now() - waiting.at >= MAX_AGE_MS) return run();
  return (waiting.promise as Promise<T>).catch(() => run());
}

/** What the page's first script leaves: when it ran, and each GET it sent. */
interface PageCalls {
  at: number;
  calls: { url: string; response: Promise<Response> }[];
}
type PageWindow = Window & { __fvEarly?: PageCalls };

/** The GETs the page's first script sends: always, and on a plain `/` (the dashboard). */
export interface PageCallUrls {
  always: string[];
  dashboard: string[];
  /** Upcoming Appointments: its path, asked for `upcomingDays` from this minute. */
  upcoming: string;
  upcomingDays: number;
}

/**
 * The page's first script, as source: plain JavaScript with no imports, so it runs while the
 * page's code is still loading. The same text on the server and in the browser.
 */
export function pageCallsScript(urls: PageCallUrls): string {
  return `(function (u) {
  try {
    var at = Date.now();
    var list = u.always.slice();
    if (location.pathname === '/' && location.search === '') {
      list = list.concat(u.dashboard);
      var from = Math.floor(at / 60000) * 60000;
      list.push(u.upcoming + '?from=' + encodeURIComponent(new Date(from).toISOString()) +
        '&to=' + encodeURIComponent(new Date(from + u.upcomingDays * 86400000).toISOString()));
    }
    window.__fvEarly = { at: at, calls: list.map(function (url) {
      var response = fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      response.catch(function () {});
      return { url: url, response: response };
    }) };
  } catch (e) {}
})(${JSON.stringify(urls)});`;
}

/** A request's path and its query in key order, so the same GET matches in any order. */
export function sameRequest(url: string): string {
  const parsed = new URL(url, 'https://firmivra.invalid');
  const query = [...parsed.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${parsed.pathname}?${new URLSearchParams(query).toString()}`;
}

/** The response the page's first script started for this GET, handed out once while recent. */
export function takePageCall(url: string): Promise<Response> | undefined {
  if (typeof window === 'undefined') return undefined;
  const page = (window as PageWindow).__fvEarly;
  if (!page || Date.now() - page.at >= MAX_AGE_MS) return undefined;
  const wanted = sameRequest(url);
  const i = page.calls.findIndex((c) => sameRequest(c.url) === wanted);
  if (i < 0) return undefined;
  const [call] = page.calls.splice(i, 1);
  return call?.response;
}

/** Sign-out: nothing started for the last person is handed to whoever signs in next. */
export function dropEarly(): void {
  early.clear();
  if (typeof window !== 'undefined') delete (window as PageWindow).__fvEarly;
}
