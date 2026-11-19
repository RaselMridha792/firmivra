// The API's HTTP server outlasts the load balancer's 120-second idle timeout, so the load balancer
// never reuses a connection the server has closed (the 502s on dev, Nov 19).
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_MS,
  keepAliveBehindLoadBalancer,
} from '../../src/common/keep-alive.js';

const ALB_IDLE_TIMEOUT_MS = 120_000;

describe('keepAliveBehindLoadBalancer', () => {
  it('keeps idle connections longer than the load balancer, and headers longer still', () => {
    const server = createServer();
    expect(server.keepAliveTimeout).toBeLessThan(ALB_IDLE_TIMEOUT_MS);
    keepAliveBehindLoadBalancer(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(ALB_IDLE_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
