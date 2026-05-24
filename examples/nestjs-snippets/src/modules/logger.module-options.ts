/**
 * LoggerModule configuration for nestjs-pino.
 *
 * The customProps callback pulls correlationId off the request (populated by
 * CorrelationIdInterceptor) so every log line emitted during the request
 * lifecycle includes it. This is what makes a single incident greppable from
 * the app logs all the way to the Junando incident summary in Slack.
 *
 * Use in your AppModule:
 *
 *   @Module({ imports: [LoggerModule.forRoot(pinoLoggerOptions)] })
 *   export class AppModule {}
 */
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
