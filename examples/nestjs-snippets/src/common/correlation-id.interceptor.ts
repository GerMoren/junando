/**
 * CorrelationIdInterceptor
 *
 * Reads x-correlation-id from the incoming request or generates a UUID.
 * Attaches it to the request object and the response header so it is visible
 * downstream (logs, errors, alerts).
 *
 * Apply globally in main.ts:
 *
 *   app.useGlobalInterceptors(new CorrelationIdInterceptor());
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

export const CORRELATION_HEADER = "x-correlation-id";

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const id = req.header(CORRELATION_HEADER) ?? randomUUID();
    req.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);

    return next.handle();
  }
}
