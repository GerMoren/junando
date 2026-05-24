/**
 * AllExceptionsFilter
 *
 * Catches every unhandled exception, logs it with the request correlationId,
 * increments http_errors_total, and returns a structured 500 response that
 * also surfaces the correlationId to the caller.
 *
 * Activate globally in main.ts:
 *
 *   app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)));
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { Request, Response } from "express";
import { httpErrors } from "../modules/metrics.controller";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof Error ? exception.message : "unknown_error";

    if (status >= 500) {
      httpErrors.inc({ route: req.route?.path ?? req.path });
      this.logger.error(
        {
          correlationId: req.correlationId,
          route: req.path,
          method: req.method,
          err: exception instanceof Error ? exception : undefined,
        },
        message,
      );
    }

    res.status(status).json({
      error: message,
      correlationId: req.correlationId,
    });
  }
}
