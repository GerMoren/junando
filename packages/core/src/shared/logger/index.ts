import pino from 'pino';
import pinoLoki from 'pino-loki';

export type Logger = pino.Logger;

export function createLogger(name?: string): Logger {
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
        service: name ?? 'junando',
        environment: process.env['NODE_ENV'] ?? 'production',
      },
      silenceErrors: false,
      replaceTimestamp: false,
    });

    return pino(
      {
        level: 'info',
        base: { service: name ?? 'junando' },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      transport,
    );
  }

  return pino({
    level: 'info',
    base: { service: name ?? 'junando' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
