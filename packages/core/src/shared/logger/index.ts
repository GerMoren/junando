import pino from 'pino';
import { createLokiDestination, initLokiBuffer } from './loki-transport.js';

export type Logger = pino.Logger;

// Wide events: canonical one-line-per-processing-unit logging.
export { WideEventBuilder } from './wide-event-builder.js';
export type {
  WideEvent,
  ClusterSection,
  DedupSection,
  RuleSection,
  LlmSection,
  NotifySection,
  RollbackSection,
  ErrorSection,
} from './wide-event-builder.js';
export { shouldSample, SLOW_EVENT_THRESHOLD_MS, NORMAL_SAMPLE_RATE } from './sampling.js';
export { redact, REDACTED, MAX_STRING_CHARS, TRUNCATION_SUFFIX } from './redaction.js';
export { Component, Stage, Outcome, SamplingDecision } from './enums.js';

export interface LoggerOptions {
  level?: string;
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Logger — solves the Lambda cold-start problem.
//
// Module-level code runs BEFORE loadConfig() sets LOKI_URL. If we create pino
// loggers at import time, they always get stdout (no Loki).
//
// Solution: every createLogger() call returns a Proxy that forwards all method
// calls to the *current* root logger. When reinitLogger() is called after
// loadConfig(), it swaps the root — and ALL existing proxy instances instantly
// start writing to both stdout and Loki without needing to be recreated.
// ─────────────────────────────────────────────────────────────────────────────

let _root: pino.Logger = buildLogger({});

function buildLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level ?? 'info';
  const name = opts.name ?? 'junando';
  const lokiUrl = process.env['LOKI_URL'];

  if (lokiUrl) {
    const parsed = new URL(lokiUrl);

    // Initialize the in-process Loki buffer.
    // flushLoki() must be called at the end of every Lambda handler invocation.
    initLokiBuffer({
      host: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username,
      password: parsed.password,
      labels: {
        service_name: name,
        environment: process.env['NODE_ENV'] ?? 'production',
      },
    });

    const lokiDest = createLokiDestination();

    // multistream: stdout (CloudWatch) always reliable; Loki via in-process buffer.
    return pino(
      {
        level,
        base: { service: name },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.multistream([{ stream: process.stdout }, { stream: lokiDest }]),
    );
  }

  return pino({
    level,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Returns a Proxy logger that always delegates to the current root logger.
 * Module-level callers get a proxy that automatically starts writing to Loki
 * once reinitLogger() is called inside the handler after loadConfig().
 */
export function createLogger(levelOrOptions?: string | LoggerOptions): Logger {
  const opts: LoggerOptions =
    typeof levelOrOptions === 'string'
      ? { level: levelOrOptions }
      : (levelOrOptions ?? {});

  // Non-default options create a dedicated logger (not proxied to root)
  if (opts.level !== undefined || opts.name !== undefined) {
    return buildLogger(opts);
  }

  // Return a Proxy that always reads from the CURRENT _root at call time.
  // This means reinitLogger() affects all existing module-level loggers instantly.
  // Note: read-only by design. pino loggers must not be mutated externally;
  // a `set` trap here would silently propagate writes to the global root and
  // affect every other proxy instance.
  return new Proxy({} as pino.Logger, {
    get(_target, prop) {
      const value = (_root as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return (value as Function).bind(_root);
      }
      return value;
    },
  });
}

/**
 * Re-creates the root logger with current env vars (including LOKI_URL).
 * Call this inside your Lambda handler immediately after loadConfig():
 *
 * @example
 * const config = await loadConfig();
 * reinitLogger(); // all module-level proxy loggers now write to Loki
 */
export function reinitLogger(opts?: LoggerOptions): void {
  _root = buildLogger(opts ?? {});
}
