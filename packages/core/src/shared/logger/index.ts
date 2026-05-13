import pino from 'pino';
import pinoLoki from 'pino-loki';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level?: string;
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy singleton: the root logger is created on first use (or after reinit).
// This is critical for Lambda: module-level code runs before loadConfig() sets
// LOKI_URL. Callers that create loggers at module level get a stdout logger
// until reinitLogger() is called inside the handler after loadConfig().
// ─────────────────────────────────────────────────────────────────────────────

let _root: Logger | null = null;

function buildLogger(opts: LoggerOptions): Logger {
  const level = opts.level ?? 'info';
  const name = opts.name ?? 'junando';
  const lokiUrl = process.env['LOKI_URL'];

  if (lokiUrl) {
    const parsed = new URL(lokiUrl);
    const username = parsed.username;
    const password = parsed.password;
    const host = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

    const transport = pinoLoki({
      host,
      basicAuth: { username, password },
      labels: {
        service: name,
        environment: process.env['NODE_ENV'] ?? 'production',
      },
      silenceErrors: false,
      replaceTimestamp: false,
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
 * Returns the shared root logger, creating it on first call.
 * Module-level `const logger = createLogger()` calls hit this path — they get
 * a stdout logger if LOKI_URL isn't set yet. Call `reinitLogger()` after
 * `loadConfig()` to swap in the Loki transport for subsequent log calls.
 */
export function createLogger(levelOrOptions?: string | LoggerOptions): Logger {
  const opts: LoggerOptions =
    typeof levelOrOptions === 'string'
      ? { level: levelOrOptions }
      : (levelOrOptions ?? {});

  // Non-default options (explicit level/name) always create a fresh logger
  if (opts.level !== undefined || opts.name !== undefined) {
    return buildLogger(opts);
  }

  if (!_root) {
    _root = buildLogger(opts);
  }
  return _root;
}

/**
 * Re-creates the root logger singleton with current env vars.
 * Call this inside your Lambda handler immediately after `loadConfig()` so
 * LOKI_URL is available before any log calls happen.
 *
 * @example
 * const config = await loadConfig();
 * reinitLogger(); // now all module-level loggers use Loki transport
 */
export function reinitLogger(opts?: LoggerOptions): void {
  _root = buildLogger(opts ?? {});
}
