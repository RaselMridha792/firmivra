import type { Server } from 'node:http';

/**
 * Behind the load balancer (AWS ALB, idle timeout 120 seconds) a connection to a task stays open
 * while idle for up to 120 seconds, but Node ends an idle keep-alive connection after 5 seconds by
 * default. The load balancer could then send a request on a connection the server had just
 * closed, and the visitor got a 502 (dev, Nov 19: 37 in four hours with no deploy). The server
 * keeps idle connections longer than the load balancer does, and waits for a request's headers a
 * little longer still, so the load balancer is always the side that closes first.
 */
export const KEEP_ALIVE_MS = 125_000;
export const HEADERS_TIMEOUT_MS = 126_000;

export function keepAliveBehindLoadBalancer(
  server: Pick<Server, 'keepAliveTimeout' | 'headersTimeout'>,
): void {
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
