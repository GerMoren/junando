# NestJS integration guide

This guide is a **delta** on top of [`examples/express-end-to-end/`](../../examples/express-end-to-end/). Read that example first if you have not. It explains the full pipeline (app → Prometheus → Alertmanager → Junando → Slack) and the role of `correlationId`. Here we only show how to wire the same behaviour into a NestJS application.

Every snippet below comes from [`examples/nestjs-snippets/`](../../examples/nestjs-snippets/) and is type-checked in CI. If a snippet stops compiling, CI fails and the guide is updated.

---

## What you need to add

| Concern                             | Component                                   |
|-------------------------------------|---------------------------------------------|
| Propagate `x-correlation-id`        | `CorrelationIdInterceptor` (global)         |
| Structured logs with `correlationId`| `nestjs-pino` configured with `customProps` |
| Prometheus metrics endpoint         | `MetricsController` + `prom-client` registry|
| Map errors to alerts and 500s       | `AllExceptionsFilter` (global)              |

You do **not** import `@junando/core` from your NestJS app. Junando consumes your alerts over HTTP via Alertmanager — exactly like in the Express example. The Nest-specific work is purely about emitting clean signals.

---

## 1. Install dependencies

```bash
pnpm add nestjs-pino pino pino-http prom-client
```

You probably already have `@nestjs/common` and `@nestjs/core` from your scaffolding.

---

## 2. CorrelationIdInterceptor

Reads `x-correlation-id` from the request or generates a UUID. Attaches it to `req.correlationId` and echoes it back as a response header so downstream callers can pivot.

```ts
// src/common/correlation-id.interceptor.ts
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
```

You also need a one-line ambient declaration so TypeScript knows `req.correlationId` exists on `Request`:

```ts
// src/types/express.d.ts
import "express";

declare module "express" {
  interface Request {
    correlationId?: string;
  }
}
```

---

## 3. nestjs-pino with correlationId

`customProps` runs per request and reads `req.correlationId` (set by the interceptor) so every log line carries it.

```ts
// src/modules/logger.module-options.ts
import { Params } from "nestjs-pino";
import type { Request } from "express";

export const pinoLoggerOptions: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? "info",
    customProps: (req) => ({
      correlationId: (req as Request).correlationId,
    }),
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[REDACTED]",
    },
  },
};
```

---

## 4. Prometheus metrics

A shared `Registry` collected from `prom-client`. Default Node.js process metrics are added automatically. Your domain counters (here `http_errors_total`) attach to the same registry so a single `/metrics` scrape returns everything.

```ts
// src/modules/metrics.controller.ts
import { Controller, Get, Header } from "@nestjs/common";
import { Registry, collectDefaultMetrics, Counter } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpErrors = new Counter({
  name: "http_errors_total",
  help: "Total HTTP 5xx responses returned by this service",
  labelNames: ["route"],
  registers: [registry],
});

@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", registry.contentType)
  async getMetrics(): Promise<string> {
    return registry.metrics();
  }
}
```

The Prometheus scrape config in the [Express example](../../examples/express-end-to-end/docker/prometheus/prometheus.yml) works as-is — just change the `targets` to point at your Nest service.

---

## 5. Global exception filter

Logs every unhandled exception with the request `correlationId`, increments `http_errors_total`, and returns a structured 500 that surfaces the `correlationId` to the client.

```ts
// src/filters/all-exceptions.filter.ts
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
```

---

## 6. Wire everything in main.ts

Order matters: interceptor first, then logger, then filter (filter depends on the logger).

```ts
// src/main.ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, LoggerModule } from "nestjs-pino";
import { Module } from "@nestjs/common";

import { CorrelationIdInterceptor } from "./common/correlation-id.interceptor";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter";
import { pinoLoggerOptions } from "./modules/logger.module-options";
import { MetricsController } from "./modules/metrics.controller";

@Module({
  imports: [LoggerModule.forRoot(pinoLoggerOptions)],
  controllers: [MetricsController],
})
class AppModule {}

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)));

  await app.listen(Number(process.env.PORT ?? 3000));
}
```

---

## 7. Point Alertmanager at Junando

This is identical to the Express example — see [`examples/express-end-to-end/docker/alertmanager/alertmanager.yml`](../../examples/express-end-to-end/docker/alertmanager/alertmanager.yml). The Junando webhook does not care which framework produced the alert; it only cares that the payload follows the Alertmanager webhook contract.

---

## ESM / CJS notes

NestJS officially supports both, but the typical app generated by `nest new` is **CommonJS** (`"module": "commonjs"` in `tsconfig.json`). The snippets above work in both modes because they do not import anything from `@junando/core`.

If you eventually want to import from `@junando/core` for advanced scenarios:

- `@junando/core` is **ESM only** (`"type": "module"`).
- In a CJS NestJS app, use a dynamic import: `const core = await import("@junando/core")`.
- Or migrate your Nest project to ESM (`"type": "module"` + `"module": "node16"` in tsconfig, plus `--experimental-specifier-resolution=node` or `.js` extensions on relative imports).
- `@junando/ingest` ships dual ESM + CJS, so it works either way.

See [`docs/compatibility.md`](../compatibility.md) for the canonical matrix.

---

## Troubleshooting

**`req.correlationId` is `undefined` inside a controller.**
The interceptor is not applied. Check that `app.useGlobalInterceptors(new CorrelationIdInterceptor())` runs in `main.ts` *before* `app.listen()`. Per-controller `@UseInterceptors` decorators also work but are noisier.

**Logs do not include `correlationId`.**
Either the interceptor is not running yet for that log line (e.g. logs emitted before the request enters the pipeline) or `customProps` is reading the wrong field. Confirm `req.correlationId` is set by adding a `console.log` inside the interceptor temporarily.

**`Cannot find module '@junando/core'` in a CJS Nest app.**
Use `await import("@junando/core")` instead of `import { ... } from "@junando/core"`. See ESM / CJS notes above.

**`@types/express` types do not include `correlationId`.**
You forgot the ambient declaration in step 2. Make sure `src/types/express.d.ts` exists and is included in `tsconfig.json` (`include: ["src/**/*.ts"]` covers `.d.ts` files too).

**Prometheus scrapes 404 on `/metrics`.**
The `MetricsController` is not registered. Add it to `AppModule.controllers` (or to a feature module that AppModule imports). Routes in NestJS are not auto-discovered.
