/**
 * main.ts wiring (reference snippet — not executed in CI).
 *
 * Shows the order things must be applied:
 *   1. CorrelationIdInterceptor first — every later log line depends on it
 *   2. nestjs-pino logger
 *   3. AllExceptionsFilter — uses the logger from step 2
 */
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
