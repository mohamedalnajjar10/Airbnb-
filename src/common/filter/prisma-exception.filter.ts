import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { PrismaClientKnownRequestError, PrismaClientValidationError } from '@prisma/client/runtime/library';

const CONFLICT_STATUS = HttpStatus.CONFLICT;
const BAD_REQUEST_STATUS = HttpStatus.BAD_REQUEST;
const NOT_FOUND_STATUS = HttpStatus.NOT_FOUND;
const INTERNAL_ERROR_STATUS = HttpStatus.INTERNAL_SERVER_ERROR;

interface ErrorResponseBody {
  readonly statusCode: number;
  readonly message: string;
  readonly code?: string;
  readonly path?: string;
}

@Catch(PrismaClientKnownRequestError, PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const path: string = request?.url ?? '';

    if (exception instanceof PrismaClientKnownRequestError) {
      const body = this.buildKnownRequestErrorBody(exception, path);
      response.status(body.statusCode).json(body);
      return;
    }

    if (exception instanceof PrismaClientValidationError) {
      const body: ErrorResponseBody = {
        statusCode: BAD_REQUEST_STATUS,
        message: 'Invalid request data',
        code: 'VALIDATION_ERROR',
        path,
      };
      response.status(body.statusCode).json(body);
      return;
    }

    const body: ErrorResponseBody = {
      statusCode: INTERNAL_ERROR_STATUS,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      path,
    };
    response.status(body.statusCode).json(body);
  }

  private buildKnownRequestErrorBody(
    error: PrismaClientKnownRequestError,
    path: string,
  ): ErrorResponseBody {
    switch (error.code) {
      case 'P2002':
        return {
          statusCode: CONFLICT_STATUS,
          message: 'Unique constraint violation',
          code: error.code,
          path,
        };
      case 'P2003':
        return {
          statusCode: CONFLICT_STATUS,
          message: 'Foreign key constraint failed',
          code: error.code,
          path,
        };
      case 'P2025':
        return {
          statusCode: NOT_FOUND_STATUS,
          message: 'Record not found',
          code: error.code,
          path,
        };
      default:
        return {
          statusCode: BAD_REQUEST_STATUS,
          message: 'Database request error',
          code: error.code,
          path,
        };
    }
  }
}
