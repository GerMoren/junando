import pino from 'pino';
import pinoLoki from 'pino-loki';

export type Logger = pino.Logger;

export interface LoggerOptions {
  level?: string;
  name?: string;
}

export function createLogger(levelOrOptions?: string | LoggerOptions): Logger {
  const opts: LoggerOptions =
    typeof levelOrOptions === 'string'
      ? { level: levelOrOptions }
      : (levelOrOptions ?? {});

  const level = opts.level ?? 'info';
  const name = opts.name ?? 'junando';
  const lokiUrl = process.env['LOKI_URL'];

  if (lokiUrl) {
    const parsed = new URL(lokiUrl);
    const username = parsed.username;
    const password = parsed.password;
    // Host without credentials: reconstruct from protocol + host + pathname
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
