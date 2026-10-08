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

  it('still answers 500 for anything else', () => {
    const { res, host: h } = host();
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ApiExceptionFilter().catch(new Error('boom'), h);
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});
