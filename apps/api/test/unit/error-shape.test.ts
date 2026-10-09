// Unit test: R8 step 3, errors that leak nothing. Only our own HttpExceptions (with a code)
// choose their words; a 500 says "Something went wrong" with its request id, and the log names
// the request and the error's kind, never its message (which can quote a query and its values).
import { BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { requestContext } from '../../src/common/request-context.js';

function host() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader() {},
    json(body: unknown) {
      this.body = body;
    },
  };
  return { res, host: { switchToHttp: () => ({ getResponse: () => res }) } as never };
}

const caught = (exception: unknown) => {
  const { res, host: h } = host();
  requestContext.run({ requestId: 'req-1' }, () => new ApiExceptionFilter().catch(exception, h));
  return res;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('one error shape', () => {
  it('a 500 is { code, message, requestId } only, and its log never has the message', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const leaky = Object.assign(
      new Error(
        "Invalid `tx.client.create()`: SELECT * FROM clients WHERE ssn = '123456789' at /srv/app/src/x.ts",
      ),
      { code: 'P2010' },
    );
    const res = caught(leaky);
    expect([res.statusCode, res.body]).toEqual([
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-1' } },
    ]);
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('request req-1');
    expect(logged).toContain('Error P2010');
    expect(logged).not.toContain('123456789');
    expect(logged).not.toContain('SELECT');
  });

  it("a library's or Nest's own error text never reaches the response", () => {
    const route = caught(new NotFoundException('Cannot GET /api/v1/secret/path'));
    expect(route.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' },
    });
    const pipe = caught(new BadRequestException('Validation failed (uuid is expected) at x.ts:1'));
    expect(pipe.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'The request is not valid', requestId: 'req-1' },
    });
    const odd = caught(new HttpException('teapot internals', 418));
    expect(odd.body).toEqual({
      error: { code: 'HTTP_418', message: 'Request failed', requestId: 'req-1' },
    });
  });

  it('our own errors keep their code, message and details', () => {
    const res = caught(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid',
        details: [{ path: 'email', message: 'Enter an email' }],
      }),
    );
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid',
        requestId: 'req-1',
        details: [{ path: 'email', message: 'Enter an email' }],
      },
    });
  });

  it('a multi-line message never reaches the log, even lines that look like frames', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    caught(new Error('Failed for client 123-45-6789\n    at secret-value-in-message'));
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('request req-1');
    expect(logged).not.toContain('secret-value-in-message');
    expect(logged).not.toContain('123-45-6789');
  });

  it("a library's details stay inside, and a code-less 5xx is logged by kind", () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const res = caught(
      new HttpException({ details: ['internal'], message: 'pool exhausted' }, 502),
    );
    expect(res.body).toEqual({
      error: { code: 'HTTP_502', message: 'Something went wrong', requestId: 'req-1' },
    });
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('HTTP 502 without a code');
    expect(logged).not.toContain('pool exhausted');
  });
});
