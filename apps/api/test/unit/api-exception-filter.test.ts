// Unit test: the API's error filter answers a busy database with 503 and Retry-After (#70 re-review).
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';

function host() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
  return { res, host: { switchToHttp: () => ({ getResponse: () => res }) } as never };
}

describe('ApiExceptionFilter', () => {
  it('answers 503 SERVICE_BUSY with Retry-After when the pool or a transaction start times out', () => {
    for (const code of ['P2024', 'P2028']) {
      const { res, host: h } = host();
      new ApiExceptionFilter().catch(Object.assign(new Error('busy'), { code }), h);
      expect([code, res.statusCode, res.headers['Retry-After']]).toEqual([code, 503, '5']);
      expect(res.body).toMatchObject({ error: { code: 'SERVICE_BUSY' } });
    }
  });

  it("keeps the body parser's refusals: 413 for a body too large, 400 for one not JSON (#109 review)", () => {
    const parserError = (status: number, type: string) =>
      Object.assign(new Error('refused by the body parser'), {
        status,
        statusCode: status,
        expose: true,
        type,
      });
    const large = host();
    new ApiExceptionFilter().catch(parserError(413, 'entity.too.large'), large.host);
    expect(large.res.statusCode).toBe(413);
    expect(large.res.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    const broken = host();
    new ApiExceptionFilter().catch(parserError(400, 'entity.parse.failed'), broken.host);
    expect(broken.res.statusCode).toBe(400);
    expect(broken.res.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    // Not exposed, or not a client error: still 500.
    const hidden = host();
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ApiExceptionFilter().catch(
      Object.assign(new Error('internal'), { status: 500, expose: false }),
      hidden.host,
    );
    spy.mockRestore();
    expect(hidden.res.statusCode).toBe(500);
  });

  it('still answers 500 for anything else', () => {
    const { res, host: h } = host();
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ApiExceptionFilter().catch(new Error('boom'), h);
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});
