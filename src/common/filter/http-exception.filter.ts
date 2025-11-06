import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

interface ErrorResponseBody {
  readonly statusCode: number;
  readonly message: string | string[];
  readonly code?: string;
  readonly path?: string;
}

/**
 * Global filter that normalizes all non-Prisma HTTP exceptions
 * into a consistent error response body.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const path: string = request?.url ?? '';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res: any = exception.getResponse();
      const message = Array.isArray(res?.message) ? res.message : (res?.message ?? exception.message);
      const body: ErrorResponseBody = {
        statusCode: status,
        message,
        path,
      };
      response.status(status).json(body);
      return;
    }

    const body: ErrorResponseBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      path,
    };
    response.status(body.statusCode).json(body);
  }
}
