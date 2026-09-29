import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorBody {
  code: string;
  message: string;
}

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  503: 'UNAVAILABLE',
};

/**
 * Global exception filter. Always answers with the `Error` shape of contracts/api.openapi.yaml.
 * It never includes stack traces, upstream (GitHub) error text or internal messages for
 * unexpected errors. HttpExceptions may carry `{ code, message }` for intentional codes such as
 * REAUTH_REQUIRED and ROLE_UNVERIFIABLE.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const body: ErrorBody = {
        code: CODES[status] ?? 'ERROR',
        message: status >= 500 ? 'The service is temporarily unavailable.' : exception.message,
      };
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as Record<string, unknown>;
        if (typeof r.code === 'string') body.code = r.code;
        if (typeof r.message === 'string' && status < 500) body.message = r.message;
      }
      response.status(status).json(body);
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    } satisfies ErrorBody);
  }
}
