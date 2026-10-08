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
      const error: ApiError['error'] = {
        code:
          typeof fields['code'] === 'string' ? fields['code'] : (CODES[status] ?? `HTTP_${status}`),
        message:
          typeof fields['message'] === 'string'
            ? fields['message']
            : typeof body === 'string'
              ? body
              : exception.message,
        requestId,
      };
      if (fields['details'] !== undefined) error.details = fields['details'];
      // A route that knows how long to wait says so: `retryAfter` seconds, sent as Retry-After.
      const retryAfter = fields['retryAfter'];
      if (typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0) {
        res.setHeader('Retry-After', String(Math.min(retryAfter, 3_600)));
      }
      res.status(status).json({ error });
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

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
    });
  }
}
