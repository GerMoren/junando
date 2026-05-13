import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── pino-loki mock ────────────────────────────────────────────────────────
const mockLokiTransport = vi.hoisted(() => vi.fn().mockReturnValue({ on: vi.fn() }));

vi.mock('pino-loki', () => ({
  default: mockLokiTransport,
}));

import { createLogger } from '../index.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['LOKI_URL'];
  });

  afterEach(() => {
    delete process.env['LOKI_URL'];
    vi.unstubAllEnvs();
  });

  describe('without LOKI_URL', () => {
    it('returns a pino logger instance with expected methods', () => {
      const log = createLogger();
      expect(typeof log.info).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.debug).toBe('function');
    });

    it('does NOT call pino-loki transport when LOKI_URL is absent', () => {
      createLogger();
      expect(mockLokiTransport).not.toHaveBeenCalled();
    });

    it('accepts an optional name argument and still returns a valid logger', () => {
      const log = createLogger({ name: 'my-service' });
      expect(typeof log.info).toBe('function');
      expect(mockLokiTransport).not.toHaveBeenCalled();
    });

    it('accepts a string level for backwards compatibility', () => {
      const log = createLogger('debug');
      expect(typeof log.info).toBe('function');
      expect(log.level).toBe('debug');
    });
  });

  describe('with LOKI_URL', () => {
    const LOKI_URL = 'https://myuser:mytoken@logs-prod-024.grafana.net/loki/api/v1/push';

    it('calls pino-loki when LOKI_URL env var is set', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);

      createLogger();

      expect(mockLokiTransport).toHaveBeenCalled();
    });

    it('passes correct host (without credentials) to pino-loki', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);

      createLogger();

      const [opts] = mockLokiTransport.mock.calls[0] as [Record<string, unknown>];
      expect(opts['host']).toBe('https://logs-prod-024.grafana.net/loki/api/v1/push');
    });

    it('passes basicAuth credentials extracted from the URL', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);

      createLogger();

      const [opts] = mockLokiTransport.mock.calls[0] as [Record<string, unknown>];
      expect(opts['basicAuth']).toEqual({ username: 'myuser', password: 'mytoken' });
    });

    it('sets Loki labels with service=junando and environment from NODE_ENV', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      vi.stubEnv('NODE_ENV', 'staging');

      createLogger();

      const [opts] = mockLokiTransport.mock.calls[0] as [Record<string, unknown>];
      expect(opts['labels']).toMatchObject({ service: 'junando', environment: 'staging' });
    });

    it('defaults environment to production when NODE_ENV is unset', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);
      delete process.env['NODE_ENV'];

      createLogger();

      const [opts] = mockLokiTransport.mock.calls[0] as [Record<string, unknown>];
      expect((opts['labels'] as Record<string, string>)['environment']).toBe('production');
    });

    it('returns a logger with expected methods when Loki is configured', () => {
      vi.stubEnv('LOKI_URL', LOKI_URL);

      const log = createLogger();
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
    });
  });
});
