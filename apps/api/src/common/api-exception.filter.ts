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
      res.status(status).json({ error });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId },
    });
  }
}
