/**
 * Local development only: the browser calls /api/v1 on its own host (so each site keeps its own
 * HttpOnly session cookie) and this forwards the call to the API at API_BASE_URL. In AWS,
 * CloudFront routes /api/* to the API and never reaches this.
 *
 * A route handler instead of a Next.js rewrite: the rewrite's proxy turned a request the browser
 * aborted (a page navigated away mid-call) into a logged 500 although the API had no error. Here
 * the browser's abort cancels the API call and ends quietly with 499 (client closed request).
 */

/** Hop-by-hop headers and the ones fetch sets itself; never passed on. */
const REQUEST_SKIP = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
/** fetch has already decoded the body, so its encoding and length no longer hold. */
const RESPONSE_SKIP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
]);
/** Statuses whose response has no body. */
const NO_BODY = new Set([101, 204, 205, 304]);

/** Nginx's "client closed request": the browser went away before the answer. */
export const CLIENT_CLOSED = 499;

export async function forwardToApi(
  request: Request,
  apiBase: string | undefined,
): Promise<Response> {
  if (!apiBase) return new Response(null, { status: 404 });
  const from = new URL(request.url);
  const target = new URL(`${from.pathname}${from.search}`, apiBase);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!REQUEST_SKIP.has(key)) headers.set(key, value);
  });
  // The API reads the site from the forwarded host (trust proxy), as the rewrite sent it.
  headers.set('x-forwarded-host', request.headers.get('host') ?? from.host);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      // Streams the request body through as it arrives (required by fetch for a stream body).
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
    } as RequestInit);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
    // The API is down or unreachable: the screens show their "unreachable" state for any 5xx.
    console.error(`API unreachable at ${apiBase}:`, (error as Error).message);
    return new Response(null, { status: 502 });
  }
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!RESPONSE_SKIP.has(key)) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(NO_BODY.has(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}
