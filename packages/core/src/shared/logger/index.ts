import pino from 'pino';
import pinoLoki from 'pino-loki';

export type Logger = pino.Logger;

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
// start writing to Loki without needing to be recreated.
// ─────────────────────────────────────────────────────────────────────────────

let _root: pino.Logger = buildLogger({});

function buildLogger(opts: LoggerOptions): pino.Logger {
  const level = opts.level ?? 'info';
  const name = opts.name ?? 'junando';
  const lokiUrl = process.env['LOKI_URL'];

  if (lokiUrl) {
    const parsed = new URL(lokiUrl);
    const username = parsed.username;
    const password = parsed.password;
    const host = `${parsed.protocol}//${parsed.hostname}`;

    const transport = pinoLoki({
      host,
      basicAuth: { username, password },
      labels: {
        service: name,
        environment: process.env['NODE_ENV'] ?? 'production',
      },
      silenceErrors: false,
      replaceTimestamp: false,
      // Disable batching in Lambda — the process exits before the 5s interval fires
      // and worker_threads are killed without flushing the buffer.
      batching: false,
    });

    return pino(
      {
        level,
        base: { service: name },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      transport,
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
  return new Proxy({} as pino.Logger, {
    get(_target, prop) {
      const value = (_root as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return (value as Function).bind(_root);
      }
      return value;
    },
    set(_target, prop, value) {
      (_root as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
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
