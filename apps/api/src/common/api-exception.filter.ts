import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@firmivra/types';
import { requestContext } from './request-context.js';

/**
 * What an error without its own code and message says: only our own HttpExceptions (with a
 * `code`) choose their words, so no library text (a path, a query, a stack) reaches a response.
 */
const MESSAGES: Partial<Record<number, string>> = {
  400: 'The request is not valid',
  401: 'Sign in to continue',
  403: 'You do not have access to this',
  404: 'Not found',
  405: 'This method is not allowed here',
  409: 'This conflicts with the current state',
  413: 'The request is too large',
  415: 'Send the body as JSON',
  422: 'The request could not be processed',
  429: 'Too many requests. Please try again in a moment.',
};

const CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

/**
 * Prisma's "timed out waiting for a pooled connection" (P2024) and "unable to start a transaction
 * in time" (P2028): the database is busy, not broken. 503 with Retry-After (#70 re-review).
 */
const BUSY_CODES = new Set(['P2024', 'P2028']);
const RETRY_AFTER_SECONDS = 5;

/** Every error leaves the API as { error: { code, message, requestId, details? } }. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext.getStore()?.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const fields =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const ours = typeof fields['code'] === 'string';
      const error: ApiError['error'] = {
        code: ours ? (fields['code'] as string) : (CODES[status] ?? `HTTP_${status}`),
        message:
          ours && typeof fields['message'] === 'string'
            ? fields['message']
            : (MESSAGES[status] ?? (status >= 500 ? 'Something went wrong' : 'Request failed')),
        requestId,
      };
      // Only our own errors carry details; a library's response object stays inside.
      if (ours && fields['details'] !== undefined) error.details = fields['details'];
      if (!ours && status >= 500) {
        this.logger.error(
          `HTTP ${status} without a code: ${describe(exception)} (request ${requestId ?? 'none'})`,
        );
      }
      // A route that knows how long to wait says so: `retryAfter` seconds, sent as Retry-After.
      const retryAfter = fields['retryAfter'];
      if (typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0) {
        res.setHeader('Retry-After', String(Math.min(retryAfter, 3_600)));
      }
      res.status(status).json({ error });
      return;
    }

    // Express's body parser refuses a body before any route runs: too large (413) or not valid
    // JSON (400). Its errors are not HttpExceptions but say their status and that it is safe to
    // show (`expose`); without this they were 500 (#109 review).
    const parser = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      type?: unknown;
    } | null;
    const parserStatus = Number(parser?.status ?? parser?.statusCode);
    if (parser?.expose === true && parserStatus >= 400 && parserStatus < 500) {
      const tooLarge = parser.type === 'entity.too.large' || parserStatus === 413;
      res.status(tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : parserStatus).json({
        error: tooLarge
          ? { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large', requestId }
          : {
              code: CODES[parserStatus] ?? `HTTP_${parserStatus}`,
              message: 'The request body could not be read',
              requestId,
            },
      });
      return;
    }

    const prismaCode = (exception as { code?: unknown } | null)?.code;
    if (typeof prismaCode === 'string' && BUSY_CODES.has(prismaCode)) {
      this.logger.warn(`Database busy (${prismaCode}); answered 503`);
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: {
          code: 'SERVICE_BUSY',
          message: 'The service is busy. Please try again in a moment.',
          requestId,
        },
      });
      return;
    }

    // By request id, with the error's kind and where it was thrown, never its message: a database
    // or library message can quote the query and the values in it (CLAUDE.md rule 4).
    this.logger.error(`Unhandled ${describe(exception)} (request ${requestId ?? 'none'})`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
    });
  }
}

/** An error's name, code and stack frames, without its message (which may quote data). */
function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return typeof exception;
  const code = (exception as { code?: unknown }).code;
  // The stack starts with "Name: message", and a message can span lines (even ones that look
  // like frames): drop it before reading frames. A stack that doesn't start that way (rewritten
  // by a library) may hold the message anywhere, so it gives no frames at all.
  const stack = exception.stack ?? '';
  const head = exception.toString();
  const frames = (stack.startsWith(head) ? stack.slice(head.length) : '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  return `${exception.name}${typeof code === 'string' ? ` ${code}` : ''}\n${frames}`;
}
